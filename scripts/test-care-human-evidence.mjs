/** Disposable, empty synthetic PostgreSQL only: SOCKET PORT DATABASE NEW_OUTPUT. */
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
const run = promisify(execFile);
const [socket, port, database, output] = process.argv.slice(2);
assert.ok(socket?.startsWith('/private/tmp/hl-') && /^\d+$/.test(port ?? '')
  && /^n2p3z_human_races_[a-z0-9_]+$/.test(database ?? '') && path.isAbsolute(output ?? ''));
const args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-h', socket, '-p', port, '-U', 'postgres', '-d', database];
const sql = async (statement) => (await run('/opt/homebrew/bin/psql', [...args, '-c', statement], { maxBuffer: 8 * 1024 * 1024 })).stdout.trim();
assert.equal(await sql('SHOW listen_addresses'), ''); assert.equal(await sql('SELECT count(*) FROM auth.users'), '0');
await mkdir(output);
const source = await readFile('supabase/tests/care_human_evidence.sql', 'utf8');
const fixtures = source.match(/-- BEGIN HUMAN FIXTURES\n([\s\S]*?)-- END HUMAN FIXTURES/)[1];
const helper = fixtures.match(/CREATE FUNCTION pg_temp\.cs\([\s\S]*?\$\$;/)[0];
const helpers = source.match(/-- BEGIN HUMAN HELPERS\n([\s\S]*?)-- END HUMAN HELPERS/)[1];
const human = source.match(/-- BEGIN HUMAN COMMAND HELPERS\n([\s\S]*?)-- END HUMAN COMMAND HELPERS/)[1];
const resolutionSource = await readFile('supabase/tests/care_exception_resolution.sql', 'utf8');
const resolutionHelpers = resolutionSource.match(/-- BEGIN RESOLUTION HELPERS\n([\s\S]*?)-- END RESOLUTION HELPERS/)[1];
const prefix = `SET search_path=public,extensions; SET timezone='UTC'; ${helper} ${helpers} ${human} ${resolutionHelpers}\n`;
const auth = `SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.cs(1),'aal','aal2')::text,true);`;
const authority = auth.replace('pg_temp.cs(1)', 'pg_temp.cs(3)');
const service = `SET LOCAL ROLE service_role; SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);`;
async function capture(name, statement) {
  await writeFile(path.join(output, name + '.sql'), statement, { flag: 'wx' });
  const result = await sql(statement); await writeFile(path.join(output, name + '.stdout'), result, { flag: 'wx' }); return result;
}
await capture('fixtures', `BEGIN; ${fixtures} COMMIT;`);
function session(name) {
  const child = spawn('/opt/homebrew/bin/psql', args, { stdio: 'pipe' }); const state = { sql: '', stdout: '', stderr: '', ended: false };
  child.stdout.on('data', (part) => { state.stdout += part; }); child.stderr.on('data', (part) => { state.stderr += part; });
  const done = new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', (code) => { state.ended = true; resolve(code); }); });
  return { child, state, done, send(statement, end = false) { state.sql += statement; if (end) child.stdin.end(statement); else child.stdin.write(statement); },
    async persist() { for (const key of ['sql', 'stdout', 'stderr']) await writeFile(path.join(output, `${name}.${key}`), state[key], { flag: 'wx' }); } };
}
async function until(test, label) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) { if (await test()) return; await new Promise((resolve) => setTimeout(resolve, 25)); }
  throw new Error('Timed out: ' + label);
}
async function blocked(a, b) {
  await until(() => /PID:\d+/.test(b.state.stdout), 'contender PID');
  const holder = Number(a.state.stdout.match(/PID:(\d+)/)[1]), contender = Number(b.state.stdout.match(/PID:(\d+)/)[1]); let result;
  await until(async () => {
    if (b.state.ended) throw new Error(b.state.stderr || 'Contender did not block');
    const row = await sql(`SELECT json_build_object('pid',pid,'blockers',pg_blocking_pids(pid),'wait',wait_event) FROM pg_stat_activity
      WHERE pid=${contender} AND ${holder}=ANY(pg_blocking_pids(pid));`);
    if (row) result = JSON.parse(row); return Boolean(result);
  }, 'actual blocking');
  return result;
}
const results = [];
async function race(name, first, second, secondError = null, pause = 0) {
  const a = session(name + '-a'), b = session(name + '-b');
  try {
    a.send(`${prefix} SELECT 'PID:'||pg_backend_pid(); BEGIN; ${first}\n\\echo HOLDING\n`);
    await until(() => { if (a.state.ended) throw new Error(a.state.stderr); return a.state.stdout.includes('HOLDING'); }, name);
    b.send(`${prefix} SELECT 'PID:'||pg_backend_pid(); BEGIN; SET LOCAL statement_timeout='10s'; ${second} COMMIT;\n`, true);
    const blocking = await blocked(a, b);
    if (pause) await new Promise((resolve) => setTimeout(resolve, pause));
    a.send('COMMIT;\n', true);
    assert.deepEqual(await Promise.all([a.done, b.done]), [0, secondError ? 3 : 0], a.state.stderr + b.state.stderr);
    if (secondError) assert.ok(b.state.stderr.includes(secondError), b.state.stderr);
    results.push({ name, blocking, expected_sqlstate: secondError, ok: true }); console.log(name + ': PASS');
    return { first: a.state.stdout, second: b.state.stdout };
  } finally {
    if (!a.state.ended) a.child.kill('SIGTERM'); if (!b.state.ended) b.child.kill('SIGTERM');
    await Promise.all([a.done, b.done]); await Promise.all([a.persist(), b.persist()]);
  }
}
const readContext = (n) => `SELECT 'CONTEXT:'||public.get_care_human_context(pg_temp.cs(${20000 + n}),'record_contact')::text;`;
const apply = (n) => `SELECT 'RECEIPT:'||public.apply_care_human_request(pg_temp.cs(${61000 + n}))::text;`;
const correct = (n) => `${authority} SELECT public.prepare_lab_observation_change(pg_temp.cs(${62000 + n}),pg_temp.cs(${30000 + n}),pg_temp.cs(91),pg_temp.cs(11),1,'correct_source',
 jsonb_build_object('reason','Synthetic revised report','evidence','Synthetic independent source authority','occurred_at',pg_temp.cs_instant(now()-interval '1 hour'),
 'value','4.2','collected_at',pg_temp.cs_instant(now()-interval '1 day'))); SELECT public.apply_lab_observation(pg_temp.cs(${62000 + n}));`;
const evaluate = (n) => `${service} SELECT * FROM public.process_lab_alert_event(pg_temp.cs(${40000 + n}));`;
async function setup(n, command = 'record_review', prepare = true) {
  await capture('setup-' + n, `${prefix} BEGIN;
   INSERT INTO public.lab_results(id,patient_id,collected_at,potassium,egfr) VALUES(pg_temp.cs(${40000 + n}),pg_temp.cs(11),now()-interval '1 day',4.6,82);
   ${auth} SELECT pg_temp.cs_new(${20000 + n}); ${authority} SELECT pg_temp.cc_register(${30000 + n},pg_temp.cs(${40000 + n}),'potassium',91);
   ${auth} SELECT pg_temp.cc_apply(${50000 + n},${20000 + n},pg_temp.cc_mapping(${30000 + n}));
   ${command === 'record_contact' ? `SELECT pg_temp.ch_apply(${60000 + n},${20000 + n});` : ''}
   ${prepare ? `SELECT pg_temp.ch_prepare(${61000 + n},${20000 + n},'${command}'${command === 'record_contact'
     ? `,jsonb_build_object('review_addressed',true,'review_event_id',public.get_care_human_request(pg_temp.cs(${60000 + n}))#>>'{receipt,event_id}')` : ''});` : ''}
   COMMIT;`);
}
let n = 0;
for (const command of ['record_review', 'record_contact']) for (const operation of ['source', 'processing']) for (const humanFirst of [true, false]) {
  n++; await setup(n, command);
  const change = operation === 'source' ? correct(n) : evaluate(n), humanWrite = auth + apply(n);
  const name = `${command}-${operation}-${humanFirst ? 'human-first' : 'change-first'}`;
  const value = await race(name, humanFirst ? humanWrite : change, humanFirst ? change : humanWrite, humanFirst ? null : '40001');
  const readback = await capture(name + '-readback', `${prefix} BEGIN; ${auth} ${readContext(n)}
   SELECT 'REQUEST:'||public.get_care_human_request(pg_temp.cs(${61000 + n}))::text;
   SELECT 'HISTORY:'||public.get_care_workflow_steps(pg_temp.cs(${20000 + n}))::text; COMMIT;`);
  const state = JSON.parse(readback.match(/REQUEST:(.*)/)[1]), context = JSON.parse(readback.match(/CONTEXT:(.*)/)[1]);
  assert.equal(state.state, humanFirst ? 'applied' : 'prepared');
  if (humanFirst || command === 'record_contact') assert.equal(context.latest_review.is_current, false);
  if (humanFirst) {
    assert.equal(JSON.parse(value.first.match(/RECEIPT:(.*)/)[1]).receipt.care_completed, false);
    assert.equal(state.receipt.addresses_current_review, command === 'record_contact');
  }
}
// The visible contact snapshot cannot silently inherit a newer professional review.
n++; await setup(n, 'record_contact', false);
const old = JSON.parse((await capture('old-contact-context', `${prefix} BEGIN; ${auth} ${readContext(n)} COMMIT;`)).match(/CONTEXT:(.*)/)[1]);
await race('review-before-contact-preparation', `${auth} SELECT pg_temp.ch_apply(${61000 + n},${20000 + n});`,
  `${auth} SELECT pg_temp.ch_from_context(63000,'${JSON.stringify(old)}'::jsonb,'record_contact',
    jsonb_build_object('review_addressed',true,'review_event_id','${old.latest_review.event_id}'));`, '40001');

for (const cancelFirst of [true, false]) {
  n++; await setup(n);
  const cancel = `${auth} SELECT 'CANCEL:'||public.cancel_care_human_request(pg_temp.cs(${61000 + n}))::text;`, write = auth + apply(n);
  const value = await race('cancel-apply-' + cancelFirst, cancelFirst ? cancel : write, cancelFirst ? write : cancel, cancelFirst ? '22023' : null);
  assert.equal(JSON.parse((cancelFirst ? value.first : value.second).match(/CANCEL:(.*)/)[1]).state, cancelFirst ? 'cancelled' : 'applied');
}
for (const transferFirst of [true, false]) {
  n++; await setup(n);
  const transfer = `${auth} SELECT public.offer_work_item_transfer(pg_temp.cs(${20000 + n}),pg_temp.cs(2));`, write = auth + apply(n);
  await race('transfer-apply-' + transferFirst, transferFirst ? transfer : write, transferFirst ? write : transfer, transferFirst ? '42501' : null);
}
n++; await setup(n);
await race('revocation-before-application', `UPDATE public.member_authorizations SET revoked_at=clock_timestamp()
 WHERE capability='clinical_disposition' AND membership_id IN(SELECT id FROM public.organization_memberships WHERE user_id='60000000-0000-4000-8000-000000000001');`,
 `${auth} ${apply(n)}`, '42501');
await capture('restore-clinical-scope', `UPDATE public.member_authorizations SET revoked_at=NULL WHERE capability='clinical_disposition';`);

// Pause only this disposable clone after writes but before its final scope check.
n++; await setup(n);
const definition = await sql("SELECT pg_get_functiondef('public.apply_care_human_request(uuid)'::regprocedure)");
const marker = ' PERFORM public.require_care_workflow_scope(item.organization_id,item.patient_id,public.care_human_requires_clinical(saved.command,saved.payload)); RETURN result;';
assert.equal(definition.split(marker).length, 2);
await capture('install-final-pause', definition.replace(marker, ' PERFORM pg_catalog.pg_advisory_xact_lock(700070);\n' + marker));
try {
  await capture('expiry-setup', `UPDATE public.member_authorizations SET expires_at=clock_timestamp()+interval '2 seconds'
    WHERE capability='clinical_disposition' AND membership_id IN(SELECT id FROM public.organization_memberships WHERE user_id='60000000-0000-4000-8000-000000000001');`);
  const value = await race('expiry-after-human-writes', 'SELECT pg_advisory_xact_lock(700070);', `${auth} ${apply(n)}`, '42501', 2200);
  assert.ok(!value.second.includes('RECEIPT:'));
  await capture('restore-expiry', 'UPDATE public.member_authorizations SET expires_at=NULL;');
  const readback = await capture('expiry-rollback-readback', `${prefix} BEGIN; ${auth}
   SELECT 'REQUEST:'||public.get_care_human_request(pg_temp.cs(${61000 + n}))::text;
   RESET ROLE; SELECT 'EVENTS:'||count(*) FROM public.care_human_events WHERE request_id=pg_temp.cs(${61000 + n});
   SELECT 'CONTEXTS:'||count(*) FROM public.care_workflow_write_context; COMMIT;`);
  assert.equal(JSON.parse(readback.match(/REQUEST:(.*)/)[1]).state, 'prepared');
  assert.match(readback, /EVENTS:0/); assert.match(readback, /CONTEXTS:0/);
} finally {
  await capture('restore-uninstrumented-function', definition);
  await capture('restore-scope-finally', 'UPDATE public.member_authorizations SET expires_at=NULL;');
}
const readHistory = (n) => `SELECT 'HISTORY:'||public.get_care_workflow_steps(pg_temp.cs(${20000 + n}))::text;`;
const historyWrite = (n) => apply(n).replace("'RECEIPT:'", "'HISTORY_WRITE:'");
for (const readFirst of [true, false]) {
  n++; await setup(n);
  const value = await race('history-apply-' + readFirst, auth + (readFirst ? readHistory(n) : historyWrite(n)), auth + (readFirst ? historyWrite(n) : readHistory(n)));
  const history = JSON.parse((readFirst ? value.first : value.second).match(/HISTORY:(.*)/)[1]);
  assert.equal(history.humans.length, readFirst ? 0 : 1); assert.equal(history.revision, readFirst ? '2' : '3');
}
n++; await setup(n);
await capture('history-independent-setup', `${prefix} BEGIN; ${auth} ${historyWrite(n)} COMMIT;`);
{
  const a = session('history-independent-a'), b = session('history-independent-b');
  try {
    a.send(`${prefix} SELECT 'PID:'||pg_backend_pid(); BEGIN; ${auth} ${readHistory(n)}\n\\echo HOLDING\n`);
    await until(() => { if (a.state.ended) throw new Error(a.state.stderr); return a.state.stdout.includes('HOLDING'); }, 'history-independent');
    b.send(`${prefix} BEGIN; ${correct(n)} COMMIT;\n`, true);
    assert.equal(await b.done, 0, b.state.stderr); assert.equal(a.state.ended, false);
    a.send('COMMIT;\n', true); assert.equal(await a.done, 0);
    const after = await capture('history-independent-readback', `${prefix} BEGIN; ${auth} ${readHistory(n)} COMMIT;`);
    assert.deepEqual(JSON.parse(after.match(/HISTORY:(.*)/)[1]), JSON.parse(a.state.stdout.match(/HISTORY:(.*)/)[1]));
  } finally {
    if (!a.state.ended) a.child.kill('SIGTERM'); if (!b.state.ended) b.child.kill('SIGTERM');
    await Promise.all([a.done, b.done]); await Promise.all([a.persist(), b.persist()]);
  }
}
const historyDefinition = await sql("SELECT pg_get_functiondef('public.get_care_workflow_steps(uuid)'::regprocedure)");
const historyMarker = " PERFORM public.require_care_workflow_scope((result->>'organization_id')::uuid,(result->>'patient_id')::uuid,false);";
assert.equal(historyDefinition.split(historyMarker).length, 2);
await capture('install-history-pause', historyDefinition.replace(historyMarker, ' PERFORM pg_catalog.pg_advisory_xact_lock(710071);\n' + historyMarker));
try {
  await capture('history-expiry-setup', `UPDATE public.member_authorizations SET expires_at=clock_timestamp()+interval '2 seconds'
    WHERE capability='monitor' AND membership_id IN(SELECT id FROM public.organization_memberships WHERE user_id='60000000-0000-4000-8000-000000000001');`);
  const value = await race('expiry-after-history-projection', 'SELECT pg_advisory_xact_lock(710071);', auth + readHistory(n), '42501', 2200);
  assert.ok(!value.second.includes('HISTORY:'));
} finally {
  await capture('restore-history-uninstrumented', historyDefinition);
  await capture('restore-history-scope', 'UPDATE public.member_authorizations SET expires_at=NULL;');
}
await capture('nonlaboratory-histories', `${prefix} BEGIN; ${auth}
 SELECT pg_temp.cs_new(70000,'referral');
 SELECT pg_temp.cs_step(90000,70000,'record_destination_acceptance','{"destination":"Synthetic clinic"}');
 SELECT pg_temp.cs_step(90001,70000,'record_schedule','{"appointment_date":"2026-09-01","appointment_at":null,"appointment_timezone":null}');
 SELECT pg_temp.cs_step(90002,70000,'record_attendance');
 SELECT pg_temp.cs_step(90003,70000,'record_report','{"report_reference":"Synthetic report A"}');
 SELECT pg_temp.ch_apply(91000,70000); SELECT pg_temp.ch_apply(91001,70000,'record_contact',
  jsonb_build_object('review_addressed',true,'review_event_id',public.get_care_human_request(pg_temp.cs(91000))#>>'{receipt,event_id}'));
 SELECT 'HISTORY:'||public.get_care_workflow_steps(pg_temp.cs(70000))::text;
 SELECT pg_temp.cs_new(70001,'medication_access');
 SELECT pg_temp.cs_step(90010,70001,'record_assistance_request','{"assistance_program":"Synthetic assistance","request_reference":"Synthetic request A"}');
 SELECT pg_temp.cs_step(90011,70001,'record_assistance_response','{"outcome":"approved","response_reference":"Synthetic response A"}');
 SELECT pg_temp.cs_step(90012,70001,'record_obtained','{"source":"patient_report"}');
 SELECT pg_temp.ch_apply(91010,70001); SELECT pg_temp.ch_apply(91011,70001,'record_contact',
  jsonb_build_object('outcome','refused','exception_id',pg_temp.cs(92000),'reason','Synthetic documented refusal'));
 SELECT 'HISTORY:'||public.get_care_workflow_steps(pg_temp.cs(70001))::text; COMMIT;`);
for (const isolation of ['REPEATABLE READ', 'SERIALIZABLE']) {
  const s = session('isolation-' + isolation.toLowerCase().replaceAll(' ', '-'));
  s.send(`${prefix} BEGIN ISOLATION LEVEL ${isolation}; ${auth} ${readContext(n)} COMMIT;\n`, true);
  assert.equal(await s.done, 3); assert.match(s.state.stderr, /25001/); await s.persist();
}
// Resolution outputs use a separate prefix: old client decoders remain strict until integrated.
const resolutionResultsStart = results.length;
const resolutionWrite = (n) => `SELECT 'RESOLVE_STATE:'||public.apply_care_human_request(pg_temp.cs(${61000 + n}))::text;`;
async function setupResolution(n, disposition = 'barrier_addressed', prepare = true) {
  await setup(n, 'record_review', false);
  await capture('resolution-setup-' + n, `${prefix} BEGIN; ${auth}
   SELECT pg_temp.ch_apply(${60000 + n},${20000 + n},'record_contact',jsonb_build_object('outcome','no_answer',
    'exception_id',pg_temp.cs(${64000 + n}),'reason','Synthetic barrier for exact resolution'));
   ${prepare ? `SELECT pg_temp.cr_prepare(${61000 + n},${20000 + n},pg_temp.cs(${64000 + n}),'${disposition}');` : ''}
   SELECT 'RESOLVE_CONTEXT:'||public.get_care_human_context(pg_temp.cs(${20000 + n}),'resolve_exception')::text; COMMIT;`);
}
async function resolutionReadback(name, n, state) {
  const raw = await capture(name + '-readback', `${prefix} BEGIN; ${auth}
   SELECT 'RESOLVE_STATE:'||public.get_care_human_request(pg_temp.cs(${61000 + n}))::text;
   SELECT 'RESOLVE_TIMELINE:'||public.get_care_workflow_steps(pg_temp.cs(${20000 + n}))::text;
   SELECT 'RESOLVE_CONTEXT:'||public.get_care_human_context(pg_temp.cs(${20000 + n}),'resolve_exception')::text;
   SELECT 'RESOLVE_INVALIDATIONS:'||public.list_care_lab_invalidations(pg_temp.cs(${20000 + n}))::text;
   RESET ROLE; SELECT 'RESOLUTION_COUNT:'||count(*) FROM public.care_exception_resolutions WHERE exception_id=pg_temp.cs(${64000 + n}); COMMIT;`);
  const request = JSON.parse(raw.match(/^RESOLVE_STATE:(.*)$/m)[1]);
  assert.equal(request.state, state); assert.match(raw, new RegExp('RESOLUTION_COUNT:' + (state === 'applied' ? 1 : 0)));
  assert.equal(JSON.parse(raw.match(/^RESOLVE_TIMELINE:(.*)$/m)[1]).exceptions.length, 1);
  assert.equal(JSON.parse(raw.match(/^RESOLVE_CONTEXT:(.*)$/m)[1]).exceptions.length, state === 'applied' ? 0 : 1);
  if (state === 'applied') {
    for (const flag of ['clinical_review_recorded','addresses_current_review','communication_confirmed','care_completed']) assert.equal(request.receipt[flag], false);
    assert.equal(request.receipt.exception_id, null); assert.equal(request.receipt.resolution_event_id, request.receipt.event_id);
  }
  return raw;
}
for (const operation of ['source', 'processing']) for (const resolutionFirst of [true, false]) {
  n++; await setupResolution(n);
  const change = operation === 'source' ? correct(n) : evaluate(n), write = auth + resolutionWrite(n);
  const name = `resolution-${operation}-${resolutionFirst ? 'resolution-first' : 'change-first'}`;
  await race(name, resolutionFirst ? write : change, resolutionFirst ? change : write, resolutionFirst ? null : '40001');
  const raw = await resolutionReadback(name, n, resolutionFirst ? 'applied' : 'prepared');
  if (operation === 'source') assert.equal(JSON.parse(raw.match(/^RESOLVE_INVALIDATIONS:(.*)$/m)[1]).items.length, 1);
}
n++; await setupResolution(n);
{
  const value = await race('resolution-same-request-replay', auth + resolutionWrite(n), auth + resolutionWrite(n));
  assert.deepEqual(JSON.parse(value.first.match(/^RESOLVE_STATE:(.*)$/m)[1]), JSON.parse(value.second.match(/^RESOLVE_STATE:(.*)$/m)[1]));
  await resolutionReadback('resolution-same-request-replay', n, 'applied');
}
n++; await setupResolution(n, 'barrier_addressed', false);
{
  const contextRaw = await capture('resolution-competing-context', `${prefix} BEGIN; ${auth}
   SELECT 'RESOLVE_CONTEXT:'||public.get_care_human_context(pg_temp.cs(${20000 + n}),'resolve_exception')::text; COMMIT;`);
  const context = JSON.parse(contextRaw.match(/^RESOLVE_CONTEXT:(.*)$/m)[1]);
  const literal = JSON.stringify(context).replaceAll("'", "''");
  const prepare = (request) => `${auth} SELECT pg_temp.cr_from_context(${request},'${literal}'::jsonb,
   pg_temp.cr_payload('${literal}'::jsonb,pg_temp.cs(${64000 + n})));`;
  await race('resolution-competing-request', prepare(61000 + n) + resolutionWrite(n), prepare(65000 + n), '40001');
  await resolutionReadback('resolution-competing-request', n, 'applied');
  const raw = await capture('resolution-competing-no-second-request', `${prefix} SELECT count(*) FROM public.care_human_requests WHERE id=pg_temp.cs(${65000 + n});`);
  assert.equal(raw.trim(), '0');
}
for (const readFirst of [true, false]) {
  n++; await setupResolution(n);
  const history = `SELECT 'RESOLVE_TIMELINE:'||public.get_care_workflow_steps(pg_temp.cs(${20000 + n}))::text;`;
  const value = await race('resolution-history-' + readFirst, auth + (readFirst ? history : resolutionWrite(n)), auth + (readFirst ? resolutionWrite(n) : history));
  const historyValue = JSON.parse((readFirst ? value.first : value.second).match(/^RESOLVE_TIMELINE:(.*)$/m)[1]);
  assert.equal(historyValue.humans.filter((row) => row.request.command === 'resolve_exception').length, readFirst ? 0 : 1);
  assert.equal(historyValue.exceptions.length, 1);
}
for (const transferFirst of [true, false]) {
  n++; await setupResolution(n);
  const transfer = `${auth} SELECT public.offer_work_item_transfer(pg_temp.cs(${20000 + n}),pg_temp.cs(2));`, write = auth + resolutionWrite(n);
  await race('resolution-transfer-' + transferFirst, transferFirst ? transfer : write, transferFirst ? write : transfer, transferFirst ? '42501' : null);
}
n++; await setupResolution(n, 'clinical_non_delivery');
await race('resolution-clinical-revocation-before-apply', `UPDATE public.member_authorizations SET revoked_at=clock_timestamp()
 WHERE capability='clinical_disposition' AND membership_id IN(SELECT id FROM public.organization_memberships WHERE user_id='60000000-0000-4000-8000-000000000001');`,
 auth + resolutionWrite(n), '42501');
await capture('resolution-restore-clinical', "UPDATE public.member_authorizations SET revoked_at=NULL WHERE capability='clinical_disposition';");
for (const capability of ['monitor', 'clinical_disposition']) {
  n++; await setupResolution(n, capability === 'monitor' ? 'barrier_addressed' : 'clinical_non_delivery');
  const original = await sql("SELECT pg_get_functiondef('public.apply_care_human_request(uuid)'::regprocedure)");
  assert.equal(original.split(marker).length, 2);
  await capture('resolution-install-pause-' + capability, original.replace(marker, ' PERFORM pg_catalog.pg_advisory_xact_lock(720072);\n' + marker));
  try {
    const before = await capture('resolution-counts-before-' + capability, `${prefix} SELECT pg_temp.cr_counts(${20000 + n},${61000 + n});`);
    await capture('resolution-expiry-setup-' + capability, `UPDATE public.member_authorizations SET expires_at=clock_timestamp()+interval '2 seconds'
     WHERE capability='${capability}' AND membership_id IN(SELECT id FROM public.organization_memberships WHERE user_id='60000000-0000-4000-8000-000000000001');`);
    const value = await race('resolution-expiry-after-writes-' + capability, 'SELECT pg_advisory_xact_lock(720072);', auth + resolutionWrite(n), '42501', 2200);
    assert.ok(!value.second.includes('RESOLVE_STATE:'));
    const after = await capture('resolution-counts-after-' + capability, `${prefix} SELECT pg_temp.cr_counts(${20000 + n},${61000 + n});`);
    assert.deepEqual(JSON.parse(after), JSON.parse(before));
  } finally {
    await capture('resolution-restore-function-' + capability, original);
    await capture('resolution-restore-scope-' + capability, 'UPDATE public.member_authorizations SET expires_at=NULL;');
  }
}
const hashes = {};
for (const file of ['supabase/migrations/00070_care_human_evidence.sql','supabase/migrations/00071_care_human_history.sql',
  'supabase/migrations/00072_care_exception_resolution.sql','supabase/tests/care_human_evidence.sql',
  'supabase/tests/care_exception_resolution.sql','scripts/test-care-human-evidence.mjs']) {
  hashes[file] = createHash('sha256').update(await readFile(file)).digest('hex');
}
await writeFile(path.join(output, 'completion.json'), JSON.stringify({ database, completed_at: new Date().toISOString(), results,
  actual_blocking_cases: results.length, resolution_blocking_cases: results.length - resolutionResultsStart,
  source_history_independence_cases: 1, isolation_denials: 2, hashes, all_ok: true }, null, 2), { flag: 'wx' });
console.log('Human evidence concurrency: PASS');
