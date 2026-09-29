/** Synthetic local PostgreSQL only; preserve committed two-session evidence.
 * node scripts/test-alert-scan-concurrency.mjs SOCKET PORT DATABASE OUTPUT
 */
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
const run = promisify(execFile);
const [socket, port, database, output] = process.argv.slice(2);
if (!socket?.startsWith('/private/tmp/hl-') || !/^\d+$/.test(port ?? '')
  || !/^n2p3d_concurrency_[a-z0-9_]+$/.test(database ?? '') || !path.isAbsolute(output ?? '')) {
  throw new Error('Explicit local rehearsal socket/database/output required');
}
const psql = '/opt/homebrew/bin/psql';
const args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-h', socket, '-p', port, '-U', 'postgres', '-d', database];
await mkdir(output);
async function sql(statement) { return (await run(psql, [...args, '-c', statement], { maxBuffer: 8 * 1024 * 1024 })).stdout.trim(); }
assert.equal(await sql('SHOW listen_addresses'), '', 'TCP must be disabled');
assert.equal(await sql('SELECT count(*) FROM auth.users'), '0', 'empty disposable database required');
const service = "SET ROLE service_role; SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',false);";
const id = (n) => `48000000-5555-4000-8000-${String(n).padStart(12, '0')}`;
const fixtures = Array.from({ length: 10 }, (_, index) => ({ actor: id(index * 10 + 1), patient: id(index * 10 + 2) }));
const setup = 'BEGIN;' + fixtures.map((f, i) => `
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
('${f.actor}','scan-race-${i}-provider@example.invalid','{"consent_accepted":true}'),
('${f.patient}','scan-race-${i}-patient@example.invalid','{"consent_accepted":true}');
UPDATE public.profiles SET role='provider' WHERE id='${f.actor}';
UPDATE public.patients SET created_at=now()-interval '30 days' WHERE id='${f.patient}';
INSERT INTO public.provider_patient_links(provider_id,patient_id,status,linked_at) VALUES('${f.actor}','${f.patient}','active',now());
INSERT INTO public.organization_patient_assignments(organization_id,patient_id,assigned_by)
VALUES(public.primary_organization_for_provider('${f.actor}'),'${f.patient}','${f.actor}') ON CONFLICT DO NOTHING;
`).join('') + 'COMMIT;';
await writeFile(path.join(output, 'setup.sql'), setup);
await writeFile(path.join(output, 'setup.stdout'), await sql(setup));
function session(label) {
  const child = spawn(psql, args, { stdio: 'pipe' });
  const state = { input: '', stdout: '', stderr: '', ended: false };
  child.stdout.on('data', (value) => { state.stdout += value; });
  child.stderr.on('data', (value) => { state.stderr += value; });
  const done = new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', (code) => { state.ended = true; resolve(code); }); });
  return { child, state, done,
    send(command, end = false) { state.input += command; if (end) child.stdin.end(command); else child.stdin.write(command); },
    async persist() { await Promise.all(['input', 'stdout', 'stderr'].map((kind) => writeFile(path.join(output, `${label}.${kind === 'input' ? 'sql' : kind}`), state[kind]))); },
  };
}
async function until(test, label) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) { if (await test()) return; await new Promise((resolve) => setTimeout(resolve, 30)); }
  throw new Error(`Timed out: ${label}`);
}
const results = [];
async function race(name, first, second, check, expectedCode = 0, errorCode) {
  const a = session(`${name}-a`), b = session(`${name}-b`);
  try {
    a.send(`SELECT 'PID:'||pg_backend_pid(); BEGIN; ${first}\n\\echo HOLDING\n`);
    await until(() => a.state.stdout.includes('HOLDING'), `${name} holding`);
    const holder = Number(a.state.stdout.match(/PID:(\d+)/)?.[1]); assert.ok(holder);
    b.send(`SELECT 'PID:'||pg_backend_pid(); BEGIN; ${second}\nCOMMIT;\n`, true);
    await until(() => /PID:\d+/.test(b.state.stdout), `${name} contender`);
    const contender = Number(b.state.stdout.match(/PID:(\d+)/)?.[1]);
    const query = `SELECT json_build_object('pid',pid,'wait_event_type',wait_event_type,'wait_event',wait_event,
      'blockers',pg_blocking_pids(pid),'query',query) FROM pg_stat_activity WHERE pid=${contender} AND ${holder}=ANY(pg_blocking_pids(pid));`;
    let wait;
    await until(async () => { wait = await sql(query); return Boolean(wait); }, `${name} observed wait`);
    await writeFile(path.join(output, `${name}-wait.sql`), query);
    await writeFile(path.join(output, `${name}-wait.json`), wait);
    a.send('COMMIT;\n', true);
    const codes = await Promise.all([a.done, b.done]); assert.deepEqual(codes, [0, expectedCode]);
    if (errorCode) assert.ok(b.state.stderr.includes(errorCode), b.state.stderr);
    const readback = JSON.parse(await sql(check.query));
    await writeFile(path.join(output, `${name}-readback.sql`), check.query);
    await writeFile(path.join(output, `${name}-readback.json`), JSON.stringify(readback, null, 2));
    check.assert(readback);
    results.push({ name, status: 'PASS', codes, wait: JSON.parse(wait), readback });
    console.log(`${name}: PASS`);
  } finally {
    if (!a.state.ended) { a.child.kill('SIGTERM'); await a.done; }
    if (!b.state.ended) { b.child.kill('SIGTERM'); await b.done; }
    await Promise.all([a.persist(), b.persist()]);
    await writeFile(path.join(output, 'concurrency-results.json'), JSON.stringify(results, null, 2));
  }
}
await race('prepare-prepare', service + "SELECT public.prepare_alert_scan('UTC');", service + "SELECT public.prepare_alert_scan('UTC');", {
  query: "SELECT json_build_object('runs',(SELECT count(*) FROM public.alert_scan_runs),'patients',(SELECT count(*) FROM public.alert_scan_patients),'rules',(SELECT count(*) FROM public.alert_scan_evaluations));",
  assert: (r) => assert.deepEqual(r, { runs: 1, patients: 10, rules: 70 }),
});
await race('scheduler-scheduler', service + 'SELECT public.next_alert_scan_page(1);', service + 'SELECT public.next_alert_scan_page(1);', {
  query: "SELECT json_build_object('advanced',(SELECT count(*) FROM public.alert_scan_patients WHERE rule_cursor=1),'positioned',(SELECT after_id IS NOT NULL FROM public.alert_scan_drain_state));",
  assert: (r) => assert.deepEqual(r, { advanced: 2, positioned: true }),
});
// A locked first candidate must not block selection of another ready receipt.
{
  const candidate = await sql(`SELECT id FROM public.alert_scan_patients
    WHERE id>(SELECT after_id FROM public.alert_scan_drain_state) ORDER BY id LIMIT 1;`);
  assert.ok(candidate);
  const holder = session('scheduler-skips-locked-a');
  try {
    holder.send(`BEGIN; SELECT id FROM public.alert_scan_patients WHERE id='${candidate}' FOR UPDATE;\n\\echo HOLDING\n`);
    await until(() => holder.state.stdout.includes('HOLDING'), 'locked scan receipt');
    const selection = `SET statement_timeout='2s'; ${service} SELECT public.next_alert_scan_page(1);`;
    await writeFile(path.join(output, 'scheduler-skips-locked-b.sql'), selection);
    const response = await sql(selection);
    await writeFile(path.join(output, 'scheduler-skips-locked-b.stdout'), response);
    const data = JSON.parse(response.split('\n').find((line) => line.startsWith('{') && line.includes('receipts')));
    assert.equal(data.receipts.length, 1); assert.notEqual(data.receipts[0].receipt_id, candidate);
    assert.equal(holder.state.ended, false, 'selection completed while first transaction still held the lock');
    results.push({ name: 'scheduler-skips-locked', status: 'PASS', blockedReceipt: candidate, selected: data.receipts[0] });
    console.log('scheduler-skips-locked: PASS');
    holder.send('COMMIT;\n', true); assert.equal(await holder.done, 0);
  } finally {
    if (!holder.state.ended) { holder.child.kill('SIGTERM'); await holder.done; }
    await holder.persist();
    await writeFile(path.join(output, 'concurrency-results.json'), JSON.stringify(results, null, 2));
  }
}
for (const f of fixtures) {
  f.receipt = await sql(`SELECT id FROM public.alert_scan_patients WHERE patient_id='${f.patient}'`);
  f.capture = `SELECT public.capture_alert_scan_patient('${f.receipt}');`;
  f.finish = (decision = 'triggered') => `SELECT public.finalize_alert_scan_rule('${f.receipt}','proactive-frozen-v2',
    '${JSON.stringify({ receipt_id: f.receipt, rule: 'no_checkin', decision, severity: decision === 'triggered' ? 'informational' : null, reason: null, source_ids: [] })}'::jsonb);`;
  f.revoke = `UPDATE public.provider_patient_links SET status='revoked' WHERE patient_id='${f.patient}';`;
  f.expire = `UPDATE public.profiles SET role='tester',sandbox_expires_at=now()-interval '1 hour' WHERE id='${f.patient}';`;
  f.purge = `SELECT public.purge_expired_tester_provenance('${f.patient}');`;
  f.check = (verify) => ({ query: `SELECT json_build_object(
    'receipt',(SELECT to_jsonb(r) FROM public.alert_scan_patients r WHERE id='${f.receipt}'),
    'evaluation',(SELECT to_jsonb(e) FROM public.alert_scan_evaluations e WHERE receipt_id='${f.receipt}' AND rule='no_checkin'),
    'alerts',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'count',occurrence_count)),'[]') FROM public.alerts WHERE patient_id='${f.patient}'),
    'items',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'status',status,'outcome',outcome)),'[]') FROM public.work_items WHERE patient_id='${f.patient}'));`, assert: verify });
}
const captured = (r) => { assert.equal(r.receipt.capture_status, 'captured'); assert.equal(r.receipt.attempts, 1); };
const complete = (r) => { assert.equal(r.evaluation.status, 'complete'); assert.equal(r.evaluation.attempts, 1); assert.equal(r.alerts.length, 1); assert.equal(r.alerts[0].count, 1); };
let f = fixtures[0];
await race('capture-capture', service + f.capture, service + f.capture, f.check(captured));
await race('finalize-finalize', service + f.finish(), service + f.finish(), f.check(complete));
f = fixtures[1]; await sql(service + f.capture);
await race('conflicting-finalize', service + f.finish(), service + f.finish('not_triggered'), f.check(complete), 3, '23505');
f = fixtures[2];
await race('revoke-before-capture', f.revoke, service + f.capture, f.check((r) => { assert.equal(r.receipt.capture_status, 'blocked_scope'); assert.equal(r.receipt.snapshot, null); assert.equal(r.alerts.length, 0); }));
f = fixtures[3];
await race('capture-before-revoke', service + f.capture, f.revoke, f.check(captured));
f = fixtures[4]; await sql(service + f.capture);
await race('revoke-before-finalize', f.revoke, service + f.finish(), f.check((r) => { assert.equal(r.evaluation.status, 'blocked'); assert.equal(r.evaluation.error_code, 'blocked_scope'); assert.equal(r.alerts.length, 0); }));
f = fixtures[5]; await sql(service + f.capture);
await race('finalize-before-revoke', service + f.finish(), f.revoke, f.check(complete));
f = fixtures[6]; await sql(f.expire);
await race('purge-before-capture', service + f.purge, service + f.capture, f.check((r) => { assert.equal(r.receipt, null); assert.equal(r.evaluation, null); assert.equal(r.alerts.length, 0); }), 3, '22023');
f = fixtures[7];
await race('capture-before-purge', service + f.capture, f.expire + service + f.purge, f.check((r) => { assert.equal(r.receipt, null); assert.equal(r.evaluation, null); assert.equal(r.alerts.length, 0); }));
for (const [index, direction] of [[8, 'close-before-finalize'], [9, 'finalize-before-close']]) {
  f = fixtures[index];
  await sql(service + f.capture + `SELECT * FROM public.coalesce_patient_alert('${f.patient}',NULL,'informational',ARRAY['no_checkin']);`);
  const close = `UPDATE public.work_items SET status='closed',outcome='Synthetic completed review',outcome_code='no_action_needed' WHERE patient_id='${f.patient}';`;
  const first = direction === 'close-before-finalize' ? close : service + f.finish();
  const second = direction === 'close-before-finalize' ? service + f.finish() : close;
  await race(direction, first, second, f.check((r) => {
    assert.equal(r.evaluation.status, 'complete'); assert.equal(r.alerts[0].count, 2);
    assert.equal(r.items[0].status, 'closed'); assert.equal(r.items[0].outcome, 'Synthetic completed review');
    if (direction === 'close-before-finalize') assert.equal(r.evaluation.error_code, 'needs_episode_adjudication');
    else assert.equal(r.evaluation.error_code, null);
  }));
}
console.log(`Completed ${results.length} committed local scan concurrency cases.`);
