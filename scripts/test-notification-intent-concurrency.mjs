/** Inert00054, committed synthetic two-connection races. Never hosted/TCP.
 * node scripts/test-notification-intent-concurrency.mjs SOCKET PORT DATABASE NEW_OUTPUT
 * Preserve the populated clone and exact input/wait/readback evidence.
 */
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
const run = promisify(execFile);
const [socket, port, database, output] = process.argv.slice(2);
assert.ok(socket?.startsWith('/private/tmp/hl-') && /^\d+$/.test(port ?? '')
  && /^n2p3j_concurrency_[a-z0-9_]+$/.test(database ?? '') && path.isAbsolute(output ?? ''), 'Explicit local clone and new output directory required');
const psql = '/opt/homebrew/bin/psql';
const args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-h', socket, '-p', port, '-U', 'postgres', '-d', database];
const sql = async (query) => (await run(psql, [...args, '-c', query], { maxBuffer: 8 * 1024 * 1024 })).stdout.trim();
assert.equal(await sql('SHOW listen_addresses'), '', 'TCP must be disabled');
assert.equal(await sql('SELECT count(*) FROM auth.users'), '0', 'new empty synthetic clone required');
await mkdir(output);
async function capture(label, query) {
  await writeFile(path.join(output, `${label}.sql`), query, { flag: 'wx' });
  const result = await run(psql, [...args, '-c', query], { maxBuffer: 8 * 1024 * 1024 });
  await writeFile(path.join(output, `${label}.stdout`), result.stdout, { flag: 'wx' });
  await writeFile(path.join(output, `${label}.stderr`), result.stderr, { flag: 'wx' });
  return result.stdout.trim();
}
const sourceFiles = ['scripts/test-notification-intent-concurrency.mjs', 'supabase/migrations/00054_transactional_notification_intents.sql'];
await writeFile(path.join(output, 'bindings.json'), JSON.stringify({ database, socket, port, started_at: new Date().toISOString(),
  files: Object.fromEntries(await Promise.all(sourceFiles.map(async (file) => [file, createHash('sha256').update(await readFile(file)).digest('hex')]))),
}, null, 2), { flag: 'wx' });
await capture('functions', `SELECT oid::regprocedure::text,md5(pg_get_functiondef(oid)) FROM pg_proc WHERE pronamespace='public'::regnamespace
 AND proname IN('sync_alert_work_items','capture_work_notification_change','capture_notification_intent','notification_capture_block_reason',
 'guard_notification_history','accept_work_item_transfer','purge_expired_tester_provenance') ORDER BY oid::regprocedure::text;`);
const names = ['close-first','repeat-first','warning-transfer-first','warning-escalate-first',
  'legacy-critical-transfer-first','legacy-critical-repeat-first','legacy-flag-transfer-first','legacy-flag-source-first',
  'resolve-first','transfer-resolve-first','two-coalescers','warning-close-first','revoke-first','process-before-erasure','erasure-before-process'];
const id = (n) => `54000000-5555-4000-8000-${String(n).padStart(12, '0')}`;
const fixtures = names.map((name, i) => ({ name, owner: id(i * 10 + 1), target: id(i * 10 + 2), patient: id(i * 10 + 3),
  org: id(i * 10 + 4), alert: id(i * 10 + 5), item: id(i * 10 + 6), tester: id(i * 10 + 7), lab: id(i * 10 + 8), request: id(i * 10 + 9),
  legacy: name.startsWith('legacy-') || name.startsWith('warning-') || name === 'revoke-first',
  warning: name.startsWith('warning-'), erasure: name.includes('erasure') }));
const auth = (user) => `SET ROLE authenticated; SELECT set_config('request.jwt.claims','{"sub":"${user}","role":"authenticated","aal":"aal2"}',false);`;
const service = `RESET ROLE; SET ROLE service_role; SELECT set_config('request.jwt.claims','{"role":"service_role"}',false);`;
await capture('setup', 'BEGIN;' + fixtures.map((f, i) => `
RESET ROLE; SELECT set_config('request.jwt.claims','{}',false);
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('${f.owner}','intent-race-${i}-owner@example.invalid','{"consent_accepted":true}'),
 ('${f.target}','intent-race-${i}-target@example.invalid','{"consent_accepted":true}'),
 ('${f.patient}','intent-race-${i}-patient@example.invalid','{"consent_accepted":true}');
UPDATE public.profiles SET role='provider' WHERE id IN('${f.owner}','${f.target}');
INSERT INTO public.organizations(id,name,created_by) VALUES('${f.org}','Synthetic intent race ${i}','${f.owner}');
INSERT INTO public.organization_memberships(organization_id,user_id,role,status,joined_at,created_by) VALUES
 ('${f.org}','${f.owner}','owner','active',now(),'${f.owner}'),('${f.org}','${f.target}','clinician','active',now(),'${f.owner}');
INSERT INTO public.organization_patient_assignments(organization_id,patient_id,assigned_by) VALUES('${f.org}','${f.patient}','${f.owner}');
INSERT INTO public.provider_patient_links(provider_id,patient_id,status,linked_at) VALUES
 ('${f.owner}','${f.patient}','active',now()),('${f.target}','${f.patient}','active',now());
UPDATE public.organization_patient_assignments SET status='revoked',revoked_at=now() WHERE patient_id='${f.patient}' AND organization_id<>'${f.org}';
INSERT INTO public.member_authorizations(membership_id,capability,granted_by)
 SELECT id,'monitor','${f.owner}' FROM public.organization_memberships WHERE organization_id='${f.org}';
INSERT INTO public.patient_accountability(organization_id,patient_id,accountable_id,designated_by) VALUES('${f.org}','${f.patient}','${f.owner}','${f.owner}');
${f.erasure ? `
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES('${f.tester}','intent-race-${i}-tester@example.invalid','{"signup_intent":"sandbox","consent_accepted":true}');
UPDATE public.profiles SET sandbox_expires_at=now()-interval '1 day' WHERE id='${f.tester}';
INSERT INTO public.lab_results(id,patient_id,collected_at,potassium) VALUES('${f.lab}','${f.patient}',now(),6.2);
UPDATE public.lab_alert_evaluations SET recorded_by='${f.tester}' WHERE lab_result_id='${f.lab}';
INSERT INTO public.lab_submission_receipts(actor_id,patient_id,request_id,payload,lab_result_id)
 VALUES('${f.tester}','${f.patient}','${f.request}','{"potassium":6.2}','${f.lab}');
` : `
${f.legacy ? 'ALTER TABLE public.alerts DISABLE TRIGGER sync_alert_work_items;' : ''}
INSERT INTO public.alerts(id,patient_id,severity,flags,first_seen_at,last_seen_at)
 VALUES('${f.alert}','${f.patient}','${f.warning ? 'warning' : 'critical'}',ARRAY['weight_gain'],now(),now());
${f.legacy ? `ALTER TABLE public.alerts ENABLE TRIGGER sync_alert_work_items;
INSERT INTO public.work_items(id,organization_id,patient_id,provider_id,assigned_to,source_type,source_id,title,reason,priority,severity,accountability_source)
 VALUES('${f.item}','${f.org}','${f.patient}','${f.owner}','${f.owner}','alert','${f.alert}','Synthetic legacy item','Legacy context','today','${f.warning ? 'warning' : 'critical'}','designated');` : ''}
`}`).join('') + 'RESET ROLE; COMMIT;');
for (const f of fixtures.filter((row) => !row.erasure)) {
  f.item = await sql(`SELECT id FROM public.work_items WHERE source_id='${f.alert}' AND organization_id='${f.org}'`);
  assert.match(f.item, /^[0-9a-f-]{36}$/);
  await capture(`${f.name}-offer`, `BEGIN; ${auth(f.owner)} SELECT public.offer_work_item_transfer('${f.item}','${f.target}','Synthetic handover fixture'); COMMIT;`);
}
const lockWork = (f) => `SELECT id FROM public.work_items WHERE id='${f.item}' FOR UPDATE;`;
const close = (f) => auth(f.owner) + `UPDATE public.work_items SET status='closed',outcome='Synthetic closure',outcome_code='clinical_action_taken' WHERE id='${f.item}';`;
const take = (f) => auth(f.target) + `SELECT public.accept_work_item_transfer('${f.item}');`;
const resolve = (f) => auth(f.owner) + `UPDATE public.alerts SET status='resolved',resolution_note='Synthetic source resolution' WHERE id='${f.alert}';`;
const coalesce = (f, flags = "ARRAY['weight_gain']") => service + `SELECT * FROM public.coalesce_patient_alert('${f.patient}',NULL,'critical',${flags});`;
const purge = (f) => service + `SELECT public.purge_expired_tester_provenance('${f.tester}'); RESET ROLE; DELETE FROM auth.users WHERE id='${f.tester}';`;
const processLab = (f) => service + `SELECT public.process_lab_alert_event('${f.lab}');`;
function actions(f) {
  switch (f.name) {
    case 'close-first': case 'warning-close-first': return [lockWork(f), coalesce(f), close(f)];
    case 'repeat-first': return [coalesce(f), close(f)];
    case 'warning-transfer-first': case 'legacy-critical-transfer-first': return [lockWork(f), coalesce(f), take(f)];
    case 'warning-escalate-first': case 'legacy-critical-repeat-first': return [coalesce(f), take(f)];
    case 'legacy-flag-transfer-first': return [lockWork(f), coalesce(f,"ARRAY['weight_gain','new_flag']"), take(f)];
    case 'legacy-flag-source-first': return [coalesce(f,"ARRAY['weight_gain','new_flag']"), take(f)];
    case 'resolve-first': return [resolve(f), take(f)];
    case 'transfer-resolve-first': return [lockWork(f), resolve(f), take(f)];
    case 'two-coalescers': return [coalesce(f,"ARRAY['weight_gain','flag_a']"),coalesce(f,"ARRAY['weight_gain','flag_b']")];
    case 'revoke-first': return [`UPDATE public.member_authorizations SET revoked_at=clock_timestamp() WHERE capability='monitor' AND membership_id IN
      (SELECT id FROM public.organization_memberships WHERE organization_id='${f.org}' AND user_id='${f.target}');`,take(f)];
    case 'process-before-erasure': return [processLab(f),purge(f)];
    case 'erasure-before-process': return [purge(f),processLab(f)];
    default: throw new Error('Unknown fixed scenario');
  }
}
function session(label) {
  const child = spawn(psql, args, { stdio: 'pipe' });
  const state = { input: '', stdout: '', stderr: '', ended: false };
  child.stdout.on('data', (value) => { state.stdout += value; });
  child.stderr.on('data', (value) => { state.stderr += value; });
  const done = new Promise((resolveDone, reject) => { child.on('error', reject); child.on('exit', (code) => { state.ended = true; resolveDone(code); }); });
  return { child, state, done,
    send(query, end = false) { state.input += query; if (end) child.stdin.end(query); else child.stdin.write(query); },
    async persist() { await Promise.all(['input', 'stdout', 'stderr'].map((kind) => writeFile(
      path.join(output, `${label}.${kind === 'input' ? 'sql' : kind}`), state[kind], { flag: 'wx' }))); },
  };
}
async function until(test, label) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) { if (await test()) return; await new Promise((done) => setTimeout(done, 25)); }
  throw new Error(`Timed out: ${label}`);
}
function verify(f, r) {
  const intents = r.intents;
  assert.equal(r.work_count, 1);
  assert.equal(r.source_count, 1);
  assert.ok(intents.every((row) => row.organization_id === f.org && row.patient_id === f.patient));
  if (f.erasure) {
    assert.equal(r.tester_exists, false); assert.equal(r.lab_status, 'recorded'); assert.equal(r.recorded_by, null);
    assert.equal(r.lab_sources, 1); assert.equal(r.actor_receipts, 0); assert.equal(r.erasure_audits, 1);
    assert.equal(intents.length, 1); assert.equal(intents[0].state, 'pending'); assert.equal(intents[0].recipient_id, f.owner);
    return;
  }
  if (f.name === 'revoke-first') {
    assert.equal(r.assigned, f.owner); assert.equal(r.source_revision, null); assert.equal(intents.length, 0); return;
  }
  const transferred = f.name.includes('transfer') || f.name.includes('source-first') || f.name === 'warning-escalate-first'
    || f.name === 'legacy-critical-repeat-first' || f.name === 'resolve-first';
  assert.equal(r.assigned, transferred ? f.target : f.owner);
  if (f.name.includes('close') || f.name === 'repeat-first') {
    assert.equal(r.status, 'closed'); assert.equal(r.outcome, 'clinical_action_taken');
    assert.equal(r.occurrences, 2); assert.equal(r.source_revision, f.legacy ? 1 : 2);
    assert.equal(r.exceptions.length, f.name === 'repeat-first' ? 0 : 1);
    assert.equal(intents.length, f.warning ? 0 : 1); assert.ok(intents.every((row) => row.state === 'cancelled'));
    return;
  }
  if (f.name.includes('resolve')) {
    assert.equal(r.source_status, 'resolved'); assert.equal(r.status, 'new'); assert.equal(r.resolved, true);
    assert.equal(intents.length, f.name === 'resolve-first' ? 1 : 2);
    assert.ok(intents.every((row) => row.state === 'cancelled')); return;
  }
  if (f.name === 'two-coalescers') {
    assert.equal(r.occurrences, 3); assert.equal(r.source_revision, 3); assert.equal(r.exceptions.length, 2);
    assert.equal(intents.length, 1); assert.equal(intents[0].state, 'pending'); return;
  }
  assert.equal(r.source_revision, 1); assert.equal(r.occurrences, 2);
  assert.equal(r.exceptions.length, f.name.includes('flag') ? 1 : 0);
  assert.equal(intents.length, f.name === 'warning-escalate-first' ? 2 : 1);
  const latest = intents.at(-1);
  assert.equal(latest.recipient_id, f.target); assert.equal(latest.state, 'pending');
  assert.equal(latest.source_revision, f.name.startsWith('legacy-') && f.name.includes('transfer-first') ? 0 : 1);
  assert.equal(latest.event_kind, f.name === 'warning-transfer-first' ? 'critical_escalated' : 'critical_reassigned');
  if (intents.length === 2) { assert.equal(intents[0].state, 'cancelled'); assert.equal(intents[0].event_kind, 'critical_escalated'); }
}
const results = [];
for (const f of fixtures) {
  const [first, second, afterWait = ''] = actions(f);
  const a = session(`${f.name}-a`), b = session(`${f.name}-b`);
  let wait, readback, codes;
  try {
    a.send(`SELECT 'PID:'||pg_backend_pid(); BEGIN; SET LOCAL statement_timeout='12s'; ${first}\n\\echo HOLDING\n`);
    await until(() => { if (a.state.ended) throw new Error(a.state.stderr); return a.state.stdout.includes('HOLDING'); }, `${f.name} holder`);
    const holder = Number(a.state.stdout.match(/PID:(\d+)/)?.[1]); assert.ok(holder);
    b.send(`SELECT 'PID:'||pg_backend_pid(); BEGIN; SET LOCAL statement_timeout='12s'; ${second}\nCOMMIT;\n`, true);
    await until(() => /PID:\d+/.test(b.state.stdout), `${f.name} contender PID`);
    const contender = Number(b.state.stdout.match(/PID:(\d+)/)?.[1]); assert.ok(contender);
    const query = `SELECT json_build_object('pid',pid,'wait_event_type',wait_event_type,'wait_event',wait_event,'blockers',pg_blocking_pids(pid),'query',query)
      FROM pg_stat_activity WHERE pid=${contender} AND ${holder}=ANY(pg_blocking_pids(pid));`;
    await until(async () => { if (b.state.ended) throw new Error(b.state.stderr || 'Contender never waited');
      const row = await sql(query); if (row) wait = JSON.parse(row); return Boolean(wait); }, `${f.name} observed blocking edge`);
    await writeFile(path.join(output, `${f.name}-wait.sql`), query, { flag: 'wx' });
    await writeFile(path.join(output, `${f.name}-wait.json`), JSON.stringify(wait, null, 2), { flag: 'wx' });
    // Key adversarial order: source/state insertion already waits on this work
    // row BEFORE the holder's work-AFTER performs its MVCC baseline lookup.
    a.send(`${afterWait} COMMIT;\n`, true);
    codes = await Promise.all([a.done, b.done]);
    assert.deepEqual(codes, [0, f.name === 'revoke-first' ? 3 : 0], a.state.stderr + b.state.stderr);
    if (f.name === 'revoke-first') assert.match(b.state.stderr, /42501/);
    readback = JSON.parse(await capture(`${f.name}-readback`, `SELECT json_build_object(
      'assigned',(SELECT assigned_to FROM public.work_items WHERE patient_id='${f.patient}'),
      'status',(SELECT status FROM public.work_items WHERE patient_id='${f.patient}'),
      'outcome',(SELECT outcome_code FROM public.work_items WHERE patient_id='${f.patient}'),
      'resolved',(SELECT underlying_alert_resolved_at IS NOT NULL FROM public.work_items WHERE patient_id='${f.patient}'),
      'work_count',(SELECT count(*) FROM public.work_items WHERE patient_id='${f.patient}'),
      'source_count',(SELECT count(*) FROM public.alerts WHERE patient_id='${f.patient}'),
      'source_status',(SELECT status FROM public.alerts WHERE patient_id='${f.patient}'),
      'occurrences',(SELECT occurrence_count FROM public.alerts WHERE patient_id='${f.patient}'),
      'source_revision',(SELECT source_revision FROM public.notification_source_state s JOIN public.alerts a ON a.id=s.alert_id WHERE a.patient_id='${f.patient}'),
      'intents',(SELECT COALESCE(jsonb_agg(to_jsonb(i) ORDER BY generation),'[]') FROM public.notification_intents i WHERE patient_id='${f.patient}'),
      'exceptions',(SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY source_revision),'[]') FROM public.notification_routing_exceptions e WHERE patient_id='${f.patient}'),
      'tester_exists',EXISTS(SELECT 1 FROM auth.users WHERE id='${f.tester}'),
      'lab_status',(SELECT status FROM public.lab_alert_evaluations WHERE lab_result_id='${f.lab}'),
      'recorded_by',(SELECT recorded_by FROM public.lab_alert_evaluations WHERE lab_result_id='${f.lab}'),
      'lab_sources',(SELECT count(*) FROM public.lab_alert_sources WHERE lab_result_id='${f.lab}'),
      'actor_receipts',(SELECT count(*) FROM public.lab_submission_receipts WHERE actor_id='${f.tester}'),
      'erasure_audits',(SELECT count(*) FROM public.lab_provenance_erasures WHERE actor_id='${f.tester}'));`));
    verify(f, readback);
    results.push({ name: f.name, status: 'PASS', codes, wait, readback });
    console.log(`${f.name}: PASS`);
  } catch (error) {
    results.push({ name: f.name, status: 'FAIL', codes, wait, readback, error: String(error) }); throw error;
  } finally {
    if (!a.state.ended) { a.child.kill('SIGTERM'); await a.done; }
    if (!b.state.ended) { b.child.kill('SIGTERM'); await b.done; }
    await Promise.all([a.persist(), b.persist()]);
    await writeFile(path.join(output, 'concurrency-results.json'), JSON.stringify(results, null, 2));
  }
}
assert.equal(results.length, names.length);
await writeFile(path.join(output, 'completion.json'), JSON.stringify({ completed_at: new Date().toISOString(), database,
  passed: results.length, listen_addresses: await sql('SHOW listen_addresses'), synthetic_users: Number(await sql('SELECT count(*) FROM auth.users')),
}, null, 2), { flag: 'wx' });
