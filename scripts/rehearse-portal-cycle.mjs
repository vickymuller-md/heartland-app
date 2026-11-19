// Run against an isolated local Supabase stack and a local build of the app.
// The exercise creates two synthetic identities in that disposable database.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';

const env = process.env;
const api = new URL(env.NEXT_PUBLIC_SUPABASE_URL);
const app = new URL(env.HEARTLAND_REHEARSAL_URL);
for (const host of [api.hostname, app.hostname, env.PGHOST]) {
  assert.ok(['localhost', '127.0.0.1'].includes(host), 'Local rehearsal hosts required');
}
assert.ok(env.HEARTLAND_REHEARSAL_OUT && path.isAbsolute(env.HEARTLAND_REHEARSAL_OUT));
const admin = createClient(api.origin, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const runId = randomUUID().slice(0, 8);
const steps = {};
function pass(step, value = true) {
  steps[step] = value;
  console.log('Verified', step);
}
function result(response, step) {
  if (response.error)
    throw new Error(step + ' failed: ' + (response.error.code || response.error.message));
  return response.data;
}
function sql(statement) {
  return execFileSync('psql', ['-XAtq', '-v', 'ON_ERROR_STOP=1', '-c', statement], {
    encoding: 'utf8',
  }).trim();
}
function currentCode(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...secret.replace(/=+$/, '').toUpperCase()]
    .map((c) => {
      const index = alphabet.indexOf(c);
      assert.ok(index >= 0);
      return index.toString(2).padStart(5, '0');
    })
    .join('');
  const key = Buffer.from(bits.match(/[01]{8}/g).map((octet) => parseInt(octet, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac('sha1', key).update(counter).digest();
  return String((digest.readUInt32BE(digest[19] & 15) & 0x7fffffff) % 1000000).padStart(6, '0');
}
async function makeActor(role) {
  const email = 'local-' + role + '-' + runId + '@example.invalid';
  const password = randomUUID() + 'Q9!';
  const created = result(
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: 'Rehearsal ' + role + ' ' + runId, consent_accepted: true },
    }),
    'create fictitious identity',
  );
  const id = created.user.id;
  assert.match(id, /^[a-f0-9-]{36}$/);
  if (role === 'provider') sql("UPDATE public.profiles SET role='provider' WHERE id='" + id + "'");
  else sql("UPDATE public.profiles SET onboarding_seen_at=now() WHERE id='" + id + "'");
  const jar = new Map();
  const client = createServerClient(api.origin, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => [...jar.values()],
      setAll: (entries) => entries.forEach((cookie) => jar.set(cookie.name, cookie)),
    },
  });
  result(await client.auth.signInWithPassword({ email, password }), 'sign in');
  if (role === 'provider') {
    const factor = result(
      await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Local rehearsal' }),
      'enroll MFA',
    );
    const challenge = result(await client.auth.mfa.challenge({ factorId: factor.id }), 'challenge MFA');
    result(
      await client.auth.mfa.verify({
        factorId: factor.id,
        challengeId: challenge.id,
        code: currentCode(factor.totp.secret),
      }),
      'verify MFA',
    );
    assert.equal(
      result(await client.auth.mfa.getAuthenticatorAssuranceLevel(), 'assurance level').currentLevel,
      'aal2',
    );
  }
  return {
    id,
    client,
    cookies: () =>
      [...jar.values()]
        .filter((c) => c.value)
        .map((c) => ({ name: c.name, value: c.value, url: app.origin })),
  };
}
const provider = await makeActor('provider');
const patient = await makeActor('patient');
sql(
  "INSERT INTO public.provider_patient_links(provider_id,patient_id,status,linked_at) VALUES('" +
    provider.id +
    "','" +
    patient.id +
    "','active',now())",
);
const [membership, organization] = sql(
  "SELECT id,organization_id FROM public.organization_memberships WHERE user_id='" +
    provider.id +
    "' AND status='active' AND is_default",
).split('|');
for (const id of [membership, organization]) assert.match(id, /^[a-f0-9-]{36}$/);
sql(
  "INSERT INTO public.organization_patient_assignments(organization_id,patient_id,assigned_by) VALUES('" +
    organization +
    "','" +
    patient.id +
    "','" +
    provider.id +
    "') ON CONFLICT DO NOTHING",
);
result(
  await provider.client.rpc('grant_member_capability', {
    p_membership_id: membership,
    p_capability: 'monitor',
    p_evidence_ref: null,
  }),
  'grant local monitoring assignment',
);
pass('two_consented_sessions_and_provider_mfa');
const browser = await chromium.launch({ headless: true });
try {
  const team = await browser.newContext();
  const portal = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await Promise.all([team.addCookies(provider.cookies()), portal.addCookies(patient.cookies())]);
  const inbox = await team.newPage();
  let receivedAlertEvents = 0;
  inbox.on('websocket', (socket) => {
    if (!new URL(socket.url()).pathname.startsWith('/realtime/')) return;
    socket.on('framereceived', ({ payload }) => {
      // Count the event type only. Never persist connection or record payloads.
      try {
        const frame = JSON.parse(String(payload));
        const event = Array.isArray(frame) ? frame[3] : frame.event;
        const data = Array.isArray(frame) ? frame[4] : frame.payload;
        if (event === 'postgres_changes' && data?.data?.table === 'alerts') receivedAlertEvents++;
      } catch {
        /* Binary transport frames carry no JSON event envelope. */
      }
    });
  });
  const details = await team.newPage();
  const today = await portal.newPage();
  const visible = { timeout: 90000 };
  await inbox.goto(app.origin + '/alerts', { timeout: 120000 });
  await expect(inbox.getByText(/Listening for updates/).first()).toBeVisible(visible);
  await today.goto(app.origin + '/today', { timeout: 120000 });
  await expect(today.getByText(/8 .*remaining|8 modules? to/i).first()).toBeVisible(visible);
  pass('new_patient_sees_eight_available_modules');
  await inbox.bringToFront();
  const rpc = async (client, name, args) => result(await client.rpc(name, args), name);
  const prepared = await rpc(provider.client, 'prepare_lab_submission', { p_patient_id: patient.id });
  const params = {
    p_patient_id: patient.id,
    p_request_id: prepared[0].request_id,
    p_collected_at: new Date().toISOString(),
    p_potassium: 6.1,
  };
  const [saved] = await rpc(provider.client, 'submit_lab_result', params);
  assert.equal(saved.status, 'pending');
  const [recovered] = await rpc(provider.client, 'get_lab_submission', {
    p_patient_id: patient.id,
    p_request_id: params.p_request_id,
  });
  assert.equal(recovered.lab_result_id, saved.lab_result_id);
  assert.equal(recovered.alert_status, 'pending');
  const [retry] = await rpc(provider.client, 'submit_lab_result', params);
  assert.equal(retry.lab_result_id, saved.lab_result_id);
  assert.equal(retry.event_id, saved.event_id);
  pass('pending_lab_recovered_after_interruption_and_repeated_without_duplicate');
  const [processed] = await rpc(admin, 'process_lab_alert_event', {
    p_lab_result_id: saved.lab_result_id,
  });
  assert.notEqual(processed.status, 'pending');
  const [repeated] = await rpc(admin, 'process_lab_alert_event', {
    p_lab_result_id: saved.lab_result_id,
  });
  assert.deepEqual(repeated, processed);
  await expect(inbox.getByTestId('acknowledge-btn').filter({ visible: true }).first()).toBeVisible(
    visible,
  );
  pass('new_alert_visible_in_open_team_inbox');
  pass('alert_event_frames_observed', receivedAlertEvents);
  const item = result(
    await provider.client
      .from('work_items')
      .select('id,assigned_to')
      .eq('patient_id', patient.id)
      .eq('source_type', 'alert')
      .single(),
    'assigned work item',
  );
  assert.equal(item.assigned_to, provider.id);
  await rpc(provider.client, 'accept_work_item', { p_work_item_id: item.id });
  pass('work_assigned_to_and_accepted_by_linked_provider');
  const alertStatus = async () =>
    result(
      await provider.client.from('alerts').select('status').eq('patient_id', patient.id).single(),
      'alert confirmation',
    ).status;
  await expect(async () => {
    if ((await alertStatus()) === 'open') {
      await inbox
        .getByTestId('acknowledge-btn')
        .filter({ visible: true })
        .first()
        .click({ timeout: 3000 });
    }
    await expect.poll(alertStatus, { timeout: 4000 }).toBe('acknowledged');
  }).toPass({ timeout: 45000 });
  await details.goto(app.origin + '/patients/' + patient.id, { timeout: 120000 });
  await expect(details.getByRole('tab', { name: 'Notes' })).toBeVisible(visible);
  const network = await team.newCDPSession(details);
  await network.send('Network.enable');
  await network.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 150,
    downloadThroughput: 1600000 / 8,
    uploadThroughput: 750000 / 8,
  });
  const started = performance.now();
  await details.reload({ waitUntil: 'load', timeout: 120000 });
  await expect(async () => {
    await details.getByRole('tab', { name: 'Notes' }).click({ timeout: 3000 });
    await expect(details.locator('textarea[name="content"]')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 90000 });
  pass('warm_patient_record_simulated_4g_ms', Math.round(performance.now() - started));
  await network.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  await network.detach();
  await details
    .locator('textarea[name="content"]')
    .fill('Synthetic follow-up reviewed and recorded for this rehearsal.');
  await details.getByRole('button', { name: 'Save Note' }).click();
  await expect(
    details
      .getByText('Synthetic follow-up reviewed and recorded for this rehearsal.', { exact: true })
      .first(),
  ).toBeVisible(visible);
  pass('human_action_saved_and_visible_in_patient_record');
  await details.locator('#template-type').selectOption('general');
  const subject = 'Rehearsal follow-up';
  const body = 'This message confirms receipt of the synthetic check-in.';
  await details.locator('#message-subject').fill(subject);
  await details.locator('#message-body').fill(body);
  await details.getByRole('button', { name: 'Send Message', exact: true }).click();
  await expect(details.getByTestId('messages-sent').getByText(subject)).toBeVisible(visible);
  const readMessage = async () =>
    result(
      await provider.client
        .from('provider_messages')
        .select('id,read_at')
        .eq('patient_id', patient.id)
        .single(),
      'message readback',
    );
  const message = await readMessage();
  await rpc(provider.client, 'record_portal_message', {
    p_expected_actor: provider.id,
    p_patient_id: patient.id,
    p_request_id: message.id,
    p_template: 'general',
    p_subject: subject,
    p_body: body,
  });
  await today.reload({ timeout: 120000 });
  await expect(today.getByText(subject, { exact: true })).toBeVisible(visible);
  assert.equal((await readMessage()).read_at, null);
  await today.getByRole('button', { name: 'Mark as read' }).click();
  await expect.poll(async () => (await readMessage()).read_at, { timeout: 30000 }).toBeTruthy();
  const firstRead = (await readMessage()).read_at;
  assert.equal(
    await rpc(patient.client, 'confirm_portal_message_read', {
      p_expected_patient: patient.id,
      p_message_id: message.id,
    }),
    firstRead,
  );
  pass('portal_send_is_idempotent_and_first_read_requires_patient_confirmation');
  await details.reload({ timeout: 120000 });
  await details.getByRole('tab', { name: 'Notes' }).click();
  await expect(
    details
      .getByTestId('messages-sent')
      .getByText(/^Read /i)
      .first(),
  ).toBeVisible(visible);
  const exported = await team.request.get(app.origin + '/api/patients/' + patient.id + '/fhir', {
    headers: { 'X-Heartland-Expected-Actor': provider.id },
  });
  assert.equal(exported.status(), 200);
  const bundle = await exported.json();
  const obs = bundle.entry
    .map((e) => e.resource)
    .filter((r) => r.resourceType === 'Observation' && r.valueQuantity?.value === 6.1);
  assert.equal(obs.length, 1);
  pass('provider_read_receipt_and_single_effective_result_in_fhir_report');
  if (env.HEARTLAND_RUN_REST_CONTRACT === '1') {
    const session = result(await provider.client.auth.getSession(), 'local contract session').session;
    assert.ok(session);
    execFileSync(
      process.execPath,
      [
        'node_modules/vitest/vitest.mjs',
        'run',
        'tests/contracts/postgrest-embeds.test.ts',
        '--maxWorkers=1',
      ],
      {
        env: {
          ...env,
          HEARTLAND_REST_CONTRACT: '1',
          HEARTLAND_REST_AUTH_ACCESS_TOKEN: session.access_token,
          HEARTLAND_REST_LAB_ID: saved.lab_result_id,
          HEARTLAND_REST_PATIENT_ID: patient.id,
          HEARTLAND_REST_LAB_COLLECTION: params.p_collected_at,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    pass('all_rest_contracts_including_authenticated_collection');
  }
  await team.setOffline(true);
  await expect(inbox.getByText(/Live updates interrupted/i).first()).toBeVisible(visible);
  await team.setOffline(false);
  await expect(inbox.getByText(/Listening for updates/i).first()).toBeVisible(visible);
  pass('team_inbox_reconnects_after_connection_loss');
  await details.goto(app.origin + '/risk-calculator');
  const search = details.getByRole('textbox', { name: 'Search linked patients' });
  await expect(search).toBeEnabled(visible);
  await search.fill(runId);
  await details.getByRole('button', { name: new RegExp('Rehearsal patient ' + runId, 'i') }).click();
  await expect(details.getByRole('button', { name: 'Clear selected patient' })).toBeVisible(visible);
  const factors = details.getByRole('radio', { name: 'Absent', exact: true });
  await expect(factors).toHaveCount(10);
  for (const input of await factors.all()) await input.check();
  for (const group of [/Age .*75/i, /Prior HF hospitalization/i]) {
    await details.getByRole('group', { name: group }).getByRole('radio', { name: 'Present' }).check();
  }
  await details.getByRole('button', { name: /Save assessment to/ }).click();
  await expect(details.getByText('Assessment saved to the patient record.')).toBeVisible(visible);
  const assessment = result(
    await provider.client
      .from('risk_assessments')
      .select('score,tier,factors,framework_version')
      .eq('patient_id', patient.id)
      .single(),
    'risk record',
  );
  assert.equal(assessment.score, 5);
  assert.equal(assessment.tier, 'moderate');
  assert.equal(assessment.framework_version, 'HEARTLAND-3.4.1-table-1');
  assert.equal(Object.values(assessment.factors).length, 10);
  assert.equal(Object.values(assessment.factors).filter(Boolean).length, 2);
  await details.goto(app.origin + '/patients/' + patient.id);
  await details.getByText(/Recorded assessment · 5\/18/).click();
  await expect(details.getByText(/HEARTLAND-3\.4\.1-table-1/)).toBeVisible(visible);
  pass('ten_explicit_risk_factors_and_version_visible_in_linked_record');
} finally {
  await browser.close();
  await writeFile(
    path.join(env.HEARTLAND_REHEARSAL_OUT, 'portal-cycle.json'),
    JSON.stringify(
      { time: new Date().toISOString(), environment: 'isolated local services', steps },
      null,
      2,
    ) + '\n',
    { mode: 0o600 },
  );
}
