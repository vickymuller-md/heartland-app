/** Disposable synthetic PostgreSQL only: SOCKET PORT DATABASE NEW_OUTPUT. */
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
const run = promisify(execFile);
const [socket, port, database, output] = process.argv.slice(2);
assert.ok(socket?.startsWith('/private/tmp/hl-') && /^\d+$/.test(port ?? '')
  && /^n2p3y_mixed_races_[a-z0-9_]+$/.test(database ?? '') && path.isAbsolute(output ?? ''));
const args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-h', socket, '-p', port, '-U', 'postgres', '-d', database];
const sql = async (statement) => (await run('/opt/homebrew/bin/psql', [...args, '-c', statement], { maxBuffer: 8 * 1024 * 1024 })).stdout.trim();
assert.equal(await sql('SHOW listen_addresses'), ''); assert.equal(await sql('SELECT count(*) FROM auth.users'), '0');
await mkdir(output);
const source = await readFile('supabase/tests/care_workflow_mixed_history.sql', 'utf8');
const fixtures = source.match(/-- BEGIN COMPOSITION FIXTURES\n([\s\S]*?)-- END COMPOSITION FIXTURES/)[1];
const helper = fixtures.match(/CREATE FUNCTION pg_temp\.cs\([\s\S]*?\$\$;/)[0];
const helpers = source.match(/-- BEGIN COMPOSITION HELPERS\n([\s\S]*?)-- END COMPOSITION HELPERS/)[1];
const prefix = `SET search_path=public,extensions; SET timezone='UTC'; ${helper} ${helpers}\n`;
const auth = `SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.cs(1),'aal','aal2')::text,true);`;
const otherAuthority = auth.replace('pg_temp.cs(1)', 'pg_temp.cs(3)');
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
async function until(test, label) { const deadline = Date.now() + 8000;
  while (Date.now() < deadline) { if (await test()) return; await new Promise((resolve) => setTimeout(resolve, 25)); } throw new Error('Timed out: ' + label); }
async function blocked(a, b) {
  await until(() => /PID:\d+/.test(b.state.stdout), 'reader PID');
  const holder = Number(a.state.stdout.match(/PID:(\d+)/)[1]), contender = Number(b.state.stdout.match(/PID:(\d+)/)[1]); let result;
  await until(async () => { if (b.state.ended) throw new Error(b.state.stderr || 'Contender did not block');
    const row = await sql(`SELECT json_build_object('pid',pid,'blockers',pg_blocking_pids(pid),'wait',wait_event) FROM pg_stat_activity
     WHERE pid=${contender} AND ${holder}=ANY(pg_blocking_pids(pid));`); if (row) result = JSON.parse(row); return Boolean(result); }, 'actual blocking');
  return result;
}
const read = (n) => `SELECT 'SNAPSHOT:'||public.get_care_workflow_steps(pg_temp.cs(${20000 + n}))::text;`;
const apply = (n) => `SELECT public.apply_care_lab_composition(pg_temp.cs(${40000 + n}));`;
const results = [];
for (const [n, mode] of ['read-before-composition', 'composition-before-read', 'read-independent-of-source-correction'].entries()) {
  await capture(mode + '-setup', `${prefix} BEGIN; ${auth} SELECT pg_temp.cs_new(${20000 + n});
   ${n === 2 ? otherAuthority : ''} SELECT pg_temp.cc_register(${10000 + n},pg_temp.cs(${4100 + n}),'potassium',${n === 2 ? 91 : 90}); ${auth}
   SELECT pg_temp.cc_prepare(${40000 + n},${20000 + n},pg_temp.cc_mapping(${10000 + n})); ${n === 2 ? apply(n) : ''} COMMIT;`);
  const a = session(mode + '-a'), b = session(mode + '-b'); let blocking;
  try {
    a.send(`${prefix} SELECT 'PID:'||pg_backend_pid(); BEGIN; ${auth} ${n === 1 ? apply(n) : read(n)}\n\\echo HOLDING\n`);
    await until(() => { if (a.state.ended) throw new Error(a.state.stderr); return a.state.stdout.includes('HOLDING'); }, mode);
    b.send(`${prefix} SELECT 'PID:'||pg_backend_pid(); BEGIN; SET LOCAL statement_timeout='10s'; ${n === 2 ? otherAuthority : auth}
     ${n === 0 ? apply(n) : n === 1 ? read(n) : `SELECT public.prepare_lab_observation_change(pg_temp.cs(50002),pg_temp.cs(10002),pg_temp.cs(91),pg_temp.cs(11),1,'correct_source',
      jsonb_build_object('reason','Synthetic revised report','evidence','Synthetic independent authority','occurred_at',pg_temp.cs_instant(now()-interval '1 hour'),
      'value','4.2','collected_at',pg_temp.cs_instant(now()-interval '1 day'))); SELECT public.apply_lab_observation(pg_temp.cs(50002));`} COMMIT;\n`, true);
    if (n !== 2) blocking = await blocked(a, b);
    else { assert.equal(await b.done, 0, b.state.stderr); assert.equal(a.state.ended, false); }
    a.send('COMMIT;\n', true); assert.deepEqual(await Promise.all([a.done, b.done]), [0, 0], a.state.stderr + b.state.stderr);
    const snapshot = JSON.parse((n === 1 ? b : a).state.stdout.match(/SNAPSHOT:(.*)/)[1]);
    assert.equal(snapshot.revision, n === 0 ? '1' : '2'); assert.equal(snapshot.compositions.length, n === 0 ? 0 : 1);
    const current = JSON.parse((await capture(mode + '-readback', `${prefix} BEGIN; ${auth} ${read(n)} COMMIT;`)).match(/SNAPSHOT:(.*)/)[1]);
    assert.equal(current.revision, '2'); assert.equal(current.compositions.length, 1);
    if (n === 2) assert.deepEqual(current, snapshot);
    results.push({ name: mode, blocking, observed_revision: snapshot.revision, current_revision: current.revision, ok: true });
    console.log(mode + ': PASS');
  } finally {
    if (!a.state.ended) a.child.kill('SIGTERM'); if (!b.state.ended) b.child.kill('SIGTERM');
    await Promise.all([a.done, b.done]); await Promise.all([a.persist(), b.persist()]);
  }
}
// A disposable-clone pause immediately before the final authorization check.
const definition = await sql("SELECT pg_get_functiondef('public.get_care_workflow_steps(uuid)'::regprocedure)");
const marker = " PERFORM public.require_care_workflow_scope((result->>'organization_id')::uuid,(result->>'patient_id')::uuid,false);";
assert.equal(definition.split(marker).length, 2);
await capture('install-final-pause', definition.replace(marker, ' PERFORM pg_catalog.pg_advisory_xact_lock(690069);\n' + marker));
const a = session('final-expiry-a'), b = session('final-expiry-b');
try {
  await capture('expiry-setup', `${prefix} UPDATE public.member_authorizations SET expires_at=clock_timestamp()+interval '2 seconds'
   WHERE capability='monitor' AND membership_id IN(SELECT id FROM public.organization_memberships WHERE user_id=pg_temp.cs(1));`);
  a.send(`SELECT 'PID:'||pg_backend_pid(); BEGIN; SELECT pg_advisory_xact_lock(690069);\n\\echo HOLDING\n`);
  await until(() => a.state.stdout.includes('HOLDING'), 'expiry holder');
  b.send(`${prefix} SELECT 'PID:'||pg_backend_pid(); BEGIN; ${auth} ${read(2)} COMMIT;\n`, true);
  const blocking = await blocked(a, b); await new Promise((resolve) => setTimeout(resolve, 2200));
  a.send('COMMIT;\n', true); assert.deepEqual(await Promise.all([a.done, b.done]), [0, 3]); assert.match(b.state.stderr, /42501/);
  assert.ok(!b.state.stdout.includes('SNAPSHOT:'));
  results.push({ name: 'expiry-after-history-projection', blocking, ok: true });
} finally {
  if (!a.state.ended) a.child.kill('SIGTERM'); if (!b.state.ended) b.child.kill('SIGTERM');
  await Promise.all([a.done, b.done]); await Promise.all([a.persist(), b.persist()]);
  await capture('restore-uninstrumented-function', definition);
  await capture('restore-scope', `${prefix} UPDATE public.member_authorizations SET expires_at=NULL;`);
}
for (const isolation of ['REPEATABLE READ', 'SERIALIZABLE']) {
  const s = session('isolation-' + isolation.toLowerCase().replaceAll(' ', '-'));
  s.send(`${prefix} BEGIN ISOLATION LEVEL ${isolation}; ${auth} ${read(2)} COMMIT;\n`, true);
  assert.equal(await s.done, 3); assert.match(s.state.stderr, /25001/); await s.persist();
}
const hashes = {};
for (const file of ['supabase/migrations/00069_care_workflow_mixed_history.sql','supabase/tests/care_workflow_mixed_history.sql','scripts/test-care-mixed-history.mjs']) {
  hashes[file] = createHash('sha256').update(await readFile(file)).digest('hex');
}
await writeFile(path.join(output, 'completion.json'), JSON.stringify({ database, completed_at: new Date().toISOString(), results,
  actual_blocking_cases: 3, source_change_independence_cases: 1, isolation_denials: 2, hashes, all_ok: true }, null, 2), { flag: 'wx' });
console.log('Mixed workflow history concurrency: PASS');
