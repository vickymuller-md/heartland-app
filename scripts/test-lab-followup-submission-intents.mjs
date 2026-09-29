/** Disposable local PostgreSQL only. Real blocking, never hosted mutations.
 * node scripts/test-lab-followup-submission-intents.mjs SOCKET PORT DATABASE NEW_OUTPUT
 */
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
const run = promisify(execFile);
const [socket, port, database, output] = process.argv.slice(2);
assert.ok(socket?.startsWith('/private/tmp/hl-') && /^\d+$/.test(port ?? '')
  && /^n2p3w_intent_races_[a-z0-9_]+$/.test(database ?? '') && path.isAbsolute(output ?? ''));
const args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-h', socket, '-p', port, '-U', 'postgres', '-d', database];
const sql = async (statement) => (await run('/opt/homebrew/bin/psql', [...args, '-c', statement], { maxBuffer: 8 * 1024 * 1024 })).stdout.trim();
assert.equal(await sql('SHOW listen_addresses'), ''); assert.equal(await sql('SELECT count(*) FROM auth.users'), '0');
await mkdir(output);
const source = await readFile('supabase/tests/lab_followup_submission_intents.sql', 'utf8');
const fixtures = source.match(/-- BEGIN STEP FIXTURES\n([\s\S]*?)-- END STEP FIXTURES/)[1];
const helper = fixtures.match(/CREATE FUNCTION pg_temp\.cs\([\s\S]*?\$\$;/)[0];
const steps = source.match(/-- BEGIN STEP HELPERS\n([\s\S]*?)-- END STEP HELPERS/)[1];
const prefix = `SET search_path=public,extensions; SET timezone='UTC'; ${helper} ${steps}\n`;
const auth = (actor = 1) => `SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.cs(${actor}),'aal','aal2')::text,true);`;
const payload = JSON.stringify({ analytes: ['potassium', 'egfr'], evidence: '  Synthetic race source  ', occurred_at: new Date(Date.now() - 3600000).toISOString() });
const bind = (n, sub) => `SELECT public.prepare_lab_followup_intent(pg_temp.cs(${n + 1000}),pg_temp.cs(${n}),pg_temp.cs(90),pg_temp.cs(11),'${sub}',1,1,'${payload}'::jsonb);`;
const save = (sub) => `SELECT * FROM public.submit_lab_result('${sub}',pg_temp.cs(11),'2026-01-01T12:00:00.123456Z',4.6,NULL,1.23);`;
const cancel = (n) => `SELECT public.cancel_lab_followup_intent(pg_temp.cs(${n + 1000}));`;
const step = (n) => `SELECT pg_temp.cs_prepare(${n + 2000},${n},'record_collection');`;
const offer = (n) => `SELECT public.offer_work_item_transfer(pg_temp.cs(${n}),pg_temp.cs(2));`;
const grantExpiry = `UPDATE public.member_authorizations SET expires_at=clock_timestamp()+interval '2 seconds'
 WHERE capability='monitor' AND membership_id IN(SELECT id FROM public.organization_memberships WHERE user_id=pg_temp.cs(1));`;
const reset = `UPDATE public.provider_patient_links SET status='active' WHERE provider_id=pg_temp.cs(1);
 UPDATE public.member_authorizations SET expires_at=NULL,revoked_at=NULL;`;
const labHold = `SELECT pg_advisory_xact_lock(hashtextextended('heartland:lab-submission:'||pg_temp.cs(1)||':'||pg_temp.cs(11),0));`;
async function capture(name, statement) {
  await writeFile(path.join(output, name + '.sql'), statement, { flag: 'wx' });
  const data = await sql(statement); await writeFile(path.join(output, name + '.stdout'), data, { flag: 'wx' }); return data;
}
await capture('fixtures', `BEGIN; ${fixtures} COMMIT;`);
function session(name) {
  const child = spawn('/opt/homebrew/bin/psql', args, { stdio: 'pipe' }); const state = { sql: '', stdout: '', stderr: '', ended: false };
  child.stdout.on('data', (part) => { state.stdout += part; }); child.stderr.on('data', (part) => { state.stderr += part; });
  const done = new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', (code) => { state.ended = true; resolve(code); }); });
  return { child, state, done, send(statement, end = false) { state.sql += statement; if (end) child.stdin.end(statement); else child.stdin.write(statement); },
    async persist() { for (const key of ['sql', 'stdout', 'stderr']) await writeFile(path.join(output, `${name}.${key}`), state[key], { flag: 'wx' }); } };
}
async function until(test, label) { const deadline = Date.now() + 8000;
  while (Date.now() < deadline) { if (await test()) return; await new Promise((resolve) => setTimeout(resolve, 25)); } throw new Error('Timed out: ' + label); }
const cases = [
  { name: 'bind-before-save', first: bind, second: (_n, sub) => save(sub), state: 'prepared', saved: true },
  { name: 'save-before-bind', first: (_n, sub) => save(sub), second: bind, code: '22023', state: null, saved: true },
  { name: 'cancel-before-save', prepared: true, first: cancel, second: (_n, sub) => save(sub), code: '23505', state: 'cancelled', closed: 'cancelled' },
  { name: 'save-before-cancel', prepared: true, first: (_n, sub) => save(sub), second: cancel, state: 'prepared', saved: true },
  { name: 'intent-before-step', first: bind, second: step, code: '23505', state: 'prepared' },
  { name: 'step-before-intent', first: step, second: bind, code: '23505', state: null, step: 'prepared' },
  { name: 'intent-before-transfer', first: bind, second: offer, state: 'prepared', transfer: true },
  { name: 'transfer-before-intent', first: offer, second: bind, code: '42501', state: null, transfer: true },
  { name: 'scope-revoked-during-lab-key-wait', first: () => labHold, firstAdmin: true, second: bind,
    after: `UPDATE public.provider_patient_links SET status='revoked' WHERE provider_id=pg_temp.cs(1);`, code: '42501', state: null },
  { name: 'monitor-expiry-during-lab-key-wait', first: () => labHold, firstAdmin: true, second: bind, expiry: true, code: '42501', state: null },
];
const results = []; const savedBindings = [];
async function race(test, n) {
  const setup = await capture(test.name + '-setup', `${prefix} BEGIN; ${reset} ${auth()} SELECT pg_temp.cs_new(${n});
    SELECT 'SUB:'||request_id FROM public.prepare_lab_submission(pg_temp.cs(11)); COMMIT;`);
  const sub = setup.match(/SUB:([a-f0-9-]{36})/)[1]; assert.match(sub, /^[a-f0-9-]{36}$/);
  if (test.prepared) await capture(test.name + '-binding', `${prefix} BEGIN; ${auth()} ${bind(n, sub)} COMMIT;`);
  if (test.expiry) await capture(test.name + '-expiry', prefix + grantExpiry);
  const a = session(test.name + '-a'), b = session(test.name + '-b'); let blocking;
  try {
    a.send(`${prefix} SELECT 'PID:'||pg_backend_pid(); BEGIN; SET LOCAL statement_timeout='12s'; ${test.firstAdmin ? '' : auth()} ${test.first(n, sub)}\n\\echo HOLDING\n`);
    await until(() => { if (a.state.ended) throw new Error(a.state.stderr); return a.state.stdout.includes('HOLDING'); }, test.name);
    const holder = Number(a.state.stdout.match(/PID:(\d+)/)?.[1]); assert.ok(holder);
    b.send(`${prefix} SELECT 'PID:'||pg_backend_pid(); BEGIN; SET LOCAL statement_timeout='12s'; ${auth()} ${test.second(n, sub)} COMMIT;\n`, true);
    await until(() => /PID:\d+/.test(b.state.stdout), test.name + ' contender'); const contender = Number(b.state.stdout.match(/PID:(\d+)/)?.[1]);
    await until(async () => { if (b.state.ended) throw new Error(b.state.stderr || 'Contender did not block');
      const row = await sql(`SELECT json_build_object('pid',pid,'blockers',pg_blocking_pids(pid),'wait',wait_event) FROM pg_stat_activity
        WHERE pid=${contender} AND ${holder}=ANY(pg_blocking_pids(pid));`); if (row) blocking = JSON.parse(row); return Boolean(blocking); }, test.name + ' blocking');
    if (test.expiry) await new Promise((resolve) => setTimeout(resolve, 2200));
    a.send(`${test.after ?? ''} COMMIT;\n`, true);
    const codes = await Promise.all([a.done, b.done]); assert.deepEqual(codes, [0, test.code ? 3 : 0], a.state.stderr + b.state.stderr);
    if (test.code) assert.match(b.state.stderr, new RegExp(test.code));
    const proof = JSON.parse(await capture(test.name + '-readback', `${prefix} SELECT json_build_object(
      'intent',(SELECT state FROM public.lab_followup_submission_intents WHERE id=pg_temp.cs(${n + 1000})),
      'saved',EXISTS(SELECT 1 FROM public.lab_submission_receipts WHERE request_id='${sub}'),
      'closed',(SELECT closed_status FROM public.lab_submission_attempts WHERE request_id='${sub}'),
      'step',(SELECT state FROM public.care_step_requests WHERE id=pg_temp.cs(${n + 2000})),
      'workflow_revision',(SELECT revision FROM public.care_workflows WHERE work_item_id=pg_temp.cs(${n})),
      'transfer',(SELECT transfer_pending_to IS NOT NULL FROM public.work_items WHERE id=pg_temp.cs(${n})));`));
    assert.deepEqual(proof, { intent: test.state, saved: test.saved ?? false, closed: test.closed ?? null, step: test.step ?? null, workflow_revision: 1, transfer: test.transfer ?? false });
    results.push({ name: test.name, codes, blocking, proof, ok: true }); console.log(test.name + ': PASS');
    if (test.saved && test.state) savedBindings.push({ n, sub });
  } finally {
    if (!a.state.ended) a.child.kill('SIGTERM'); if (!b.state.ended) b.child.kill('SIGTERM');
    await Promise.all([a.done, b.done]); await Promise.all([a.persist(), b.persist()]);
    await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
  }
  await capture(test.name + '-close-lab-attempt', `${prefix} BEGIN; ${reset} ${auth()}
    ${test.saved ? `SELECT public.acknowledge_lab_submission(pg_temp.cs(11),'${sub}',(SELECT lab_result_id FROM public.lab_submission_receipts WHERE request_id='${sub}'));`
      : `SELECT public.cancel_lab_submission(pg_temp.cs(11),'${sub}');`} COMMIT;`);
}
for (const [n, test] of cases.entries()) await race(test, 300 + n);

const { n, sub } = savedBindings[0];
const replay = await capture('replay-after-ack-transfer-and-new-stage', `${prefix} BEGIN; ${auth()} ${offer(n)} RESET ROLE; ${auth(2)}
 SELECT public.accept_work_item_transfer(pg_temp.cs(${n})); SELECT pg_temp.cs_step(9900,${n},'record_collection');
 RESET ROLE; ${auth()} SELECT 'RECOVERY:'||public.get_lab_followup_intent(pg_temp.cs(${n + 1000}))::text; ${bind(n, sub)} COMMIT;`);
const historical = JSON.parse(replay.match(/RECOVERY:(.*)/)[1]); assert.equal(historical.expected_revision, '1'); assert.equal(historical.expected_ownership_revision, '1');
assert.equal(historical.submission.status, 'saved_not_linked'); assert.ok(historical.submission.acknowledged_at);

// Isolated-only final projection pause. Restore the exact uninstrumented function afterwards.
const definition = await sql("SELECT pg_get_functiondef('public.get_lab_followup_intent(uuid)'::regprocedure)");
const marker = ' result:=public.lab_followup_intent_state(saved.id);'; assert.equal(definition.split(marker).length, 2);
await capture('install-final-projection-pause', definition.replace(marker, marker + '\n PERFORM pg_catalog.pg_advisory_xact_lock(670067);'));
const a = session('final-expiry-a'), b = session('final-expiry-b'); let finalBlocking;
try {
  await capture('final-expiry-setup', prefix + grantExpiry);
  a.send(`SELECT 'PID:'||pg_backend_pid(); BEGIN; SELECT pg_advisory_xact_lock(670067);\n\\echo HOLDING\n`);
  await until(() => a.state.stdout.includes('HOLDING'), 'final expiry holder'); const holder = Number(a.state.stdout.match(/PID:(\d+)/)[1]);
  b.send(`${prefix} SELECT 'PID:'||pg_backend_pid(); BEGIN; ${auth()} SELECT public.get_lab_followup_intent(pg_temp.cs(${n + 1000})); COMMIT;\n`, true);
  await until(() => /PID:\d+/.test(b.state.stdout), 'final expiry reader'); const reader = Number(b.state.stdout.match(/PID:(\d+)/)[1]);
  await until(async () => { const row = await sql(`SELECT json_build_object('pid',pid,'blockers',pg_blocking_pids(pid),'wait',wait_event)
    FROM pg_stat_activity WHERE pid=${reader} AND ${holder}=ANY(pg_blocking_pids(pid));`); if (row) finalBlocking = JSON.parse(row); return Boolean(finalBlocking); }, 'final projection wait');
  await new Promise((resolve) => setTimeout(resolve, 2200)); a.send('COMMIT;\n', true);
  assert.deepEqual(await Promise.all([a.done, b.done]), [0, 3]); assert.match(b.state.stderr, /42501/);
  results.push({ name: 'monitor-expiry-after-final-projection', blocking: finalBlocking, codes: [0, 3], ok: true });
} finally {
  if (!a.state.ended) a.child.kill('SIGTERM'); if (!b.state.ended) b.child.kill('SIGTERM');
  await Promise.all([a.done, b.done]); await Promise.all([a.persist(), b.persist()]);
  await capture('restore-final-projection-function', definition); await capture('restore-scope', prefix + reset);
}
for (const isolation of ['REPEATABLE READ', 'SERIALIZABLE']) {
  const s = session('isolation-' + isolation.toLowerCase().replaceAll(' ', '-'));
  s.send(`${prefix} BEGIN ISOLATION LEVEL ${isolation}; ${auth()} SELECT public.get_lab_followup_intent(pg_temp.cs(${n + 1000})); COMMIT;\n`, true);
  assert.equal(await s.done, 3); assert.match(s.state.stderr, /25001/); await s.persist();
}
const hashes = {};
for (const file of ['supabase/migrations/00067_lab_followup_submission_intents.sql', 'supabase/tests/lab_followup_submission_intents.sql', 'scripts/test-lab-followup-submission-intents.mjs']) {
  hashes[file] = createHash('sha256').update(await readFile(file)).digest('hex');
}
await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
await writeFile(path.join(output, 'completion.json'), JSON.stringify({ database, completed_at: new Date().toISOString(), actual_blocking_cases: results.length,
  isolation_denials: 2, historical_replay_after_ack_transfer_and_stage_change: true, hashes, all_ok: true }, null, 2), { flag: 'wx' });
console.log('Pre-save intention concurrency: PASS');
