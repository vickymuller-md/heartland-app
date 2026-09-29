/** Local synthetic blocking proof. Never connect to a hosted database.
 * node scripts/test-lab-source-context.mjs SOCKET PORT DATABASE NEW_OUTPUT
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
  && /^n2p3v_context_races_[a-z0-9_]+$/.test(database ?? '') && path.isAbsolute(output ?? ''));
const args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-h', socket, '-p', port, '-U', 'postgres', '-d', database];
const sql = async (statement) => (await run('/opt/homebrew/bin/psql', [...args, '-c', statement], { maxBuffer: 8 * 1024 * 1024 })).stdout.trim();
assert.equal(await sql('SHOW listen_addresses'), '');
assert.equal(await sql('SELECT count(*) FROM auth.users'), '0');
await mkdir(output);
const source = await readFile('supabase/tests/lab_source_context.sql', 'utf8');
const fixtures = source.match(/-- BEGIN OBSERVATION FIXTURES\n([\s\S]*?)-- END OBSERVATION FIXTURES/)[1];
const helper = fixtures.match(/CREATE FUNCTION pg_temp\.lo\([\s\S]*?\$\$;/)[0];
const prefix = `SET search_path=public,extensions; SET timezone='UTC'; ${helper}\n`;
const auth = `SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.lo(1),'aal','aal2')::text,true);`;
const context = `SELECT 'CONTEXT:'||public.get_lab_source_context(pg_temp.lo(90),pg_temp.lo(11))::text;`;
const scopeHold = `SELECT id FROM public.profiles WHERE id=pg_temp.lo(1) FOR UPDATE;`;
const reset = `UPDATE public.provider_patient_links SET status='active' WHERE provider_id=pg_temp.lo(1);
 UPDATE public.member_authorizations SET revoked_at=NULL,expires_at=NULL;
 UPDATE public.consents SET accepted=true WHERE user_id=pg_temp.lo(1);
 UPDATE public.organization_memberships SET status='active' WHERE user_id=pg_temp.lo(1);`;
const grant = (field, capability) => `UPDATE public.member_authorizations SET ${field} WHERE capability='${capability}'
 AND membership_id IN(SELECT id FROM public.organization_memberships WHERE user_id=pg_temp.lo(1) AND organization_id=pg_temp.lo(90));`;
async function capture(name, statement) {
  await writeFile(path.join(output, name + '.sql'), statement, { flag: 'wx' });
  const data = await sql(statement); await writeFile(path.join(output, name + '.stdout'), data, { flag: 'wx' }); return data;
}
await capture('fixtures', `BEGIN; ${fixtures} COMMIT;`);
function session(name) {
  const child = spawn('/opt/homebrew/bin/psql', args, { stdio: 'pipe' });
  const state = { sql: '', stdout: '', stderr: '', ended: false };
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
const cases = [
  { name: 'link-revoked-during-profile-wait', first: scopeHold, after: `UPDATE public.provider_patient_links SET status='revoked' WHERE provider_id=pg_temp.lo(1);`, code: '42501' },
  { name: 'consent-revoked-during-profile-wait', first: scopeHold, after: `UPDATE public.consents SET accepted=false WHERE user_id=pg_temp.lo(1);`, code: '42501' },
  { name: 'membership-suspended-during-profile-wait', first: scopeHold, after: `UPDATE public.organization_memberships SET status='suspended' WHERE user_id=pg_temp.lo(1);`, code: '42501' },
  { name: 'monitor-revoked-during-profile-wait', first: scopeHold, after: grant('revoked_at=clock_timestamp()', 'monitor'), code: '42501' },
  { name: 'clinical-revoked-during-profile-wait', first: scopeHold, after: grant('revoked_at=clock_timestamp()', 'clinical_disposition'), canMutate: false },
  { name: 'monitor-expires-during-profile-wait', first: scopeHold, expiry: 'monitor', code: '42501' },
  { name: 'clinical-expires-during-profile-wait', first: scopeHold, expiry: 'clinical_disposition', canMutate: false },
  { name: 'read-before-link-revocation', first: auth + context, second: `UPDATE public.provider_patient_links SET status='revoked' WHERE provider_id=pg_temp.lo(1);`, firstRead: true },
];
const results = [];
async function race(test) {
  await capture(test.name + '-setup', prefix + reset + (test.expiry ? grant("expires_at=clock_timestamp()+interval '2 seconds'", test.expiry) : ''));
  const a = session(test.name + '-a'), b = session(test.name + '-b'); let blocking;
  try {
    a.send(`${prefix} SELECT 'PID:'||pg_backend_pid(); BEGIN; SET LOCAL statement_timeout='12s'; ${test.first}\n\\echo HOLDING\n`);
    await until(() => { if (a.state.ended) throw new Error(a.state.stderr); return a.state.stdout.includes('HOLDING'); }, test.name);
    const holder = Number(a.state.stdout.match(/PID:(\d+)/)?.[1]); assert.ok(holder);
    b.send(`${prefix} SELECT 'PID:'||pg_backend_pid(); BEGIN; SET LOCAL statement_timeout='12s'; ${test.second ?? auth + context} COMMIT;\n`, true);
    await until(() => /PID:\d+/.test(b.state.stdout), test.name + ' contender');
    const contender = Number(b.state.stdout.match(/PID:(\d+)/)?.[1]);
    await until(async () => {
      if (b.state.ended) throw new Error(b.state.stderr || 'Contender did not block');
      const row = await sql(`SELECT json_build_object('pid',pid,'blockers',pg_blocking_pids(pid),'wait',wait_event)
        FROM pg_stat_activity WHERE pid=${contender} AND ${holder}=ANY(pg_blocking_pids(pid));`);
      if (row) blocking = JSON.parse(row); return Boolean(blocking);
    }, test.name + ' actual blocking');
    if (test.expiry) await new Promise((resolve) => setTimeout(resolve, 2200));
    a.send(`${test.after ?? ''} COMMIT;\n`, true);
    const codes = await Promise.all([a.done, b.done]); assert.deepEqual(codes, [0, test.code ? 3 : 0], a.state.stderr + b.state.stderr);
    if (test.code) { assert.match(b.state.stderr, new RegExp(test.code)); assert.doesNotMatch(b.state.stdout, /CONTEXT:/); }
    else {
      const data = JSON.parse((test.firstRead ? a : b).state.stdout.match(/CONTEXT:(.*)/)[1]);
      assert.equal(data.can_mutate, test.canMutate ?? true); assert.equal(data.items.length, 250);
      assert.equal(data.actor_id, '61000000-0000-4000-8000-000000000001');
    }
    results.push({ name: test.name, blocking, codes, ok: true }); console.log(test.name + ': PASS');
  } finally {
    if (!a.state.ended) a.child.kill('SIGTERM'); if (!b.state.ended) b.child.kill('SIGTERM');
    await Promise.all([a.done, b.done]); await Promise.all([a.persist(), b.persist()]);
    await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
  }
}
for (const test of cases) await race(test);

// Disposable-clone-only pause immediately before the final scope check. This
// proves expiry after composition, rather than only expiry in the initial lock.
const definition = await sql("SELECT pg_get_functiondef('public.get_lab_source_context(uuid,uuid,text,text)'::regprocedure)");
const finalCheck = ' PERFORM public.require_care_workflow_scope(p_organization_id,p_patient_id,false);';
assert.equal(definition.split(finalCheck).length, 2);
await capture('install-final-check-pause', definition.replace(finalCheck, ' PERFORM pg_catalog.pg_advisory_xact_lock(660066);\n' + finalCheck));
try {
  await race({ name: 'monitor-expires-after-composition', first: 'SELECT pg_advisory_xact_lock(660066);', expiry: 'monitor', code: '42501' });
} finally { await capture('restore-uninstrumented-function', definition); }
await capture('restore-fixture-scope', prefix + reset);
const isolationChecks = [];
for (const isolation of ['REPEATABLE READ', 'SERIALIZABLE']) {
  const s = session('isolation-' + isolation.toLowerCase().replaceAll(' ', '-'));
  s.send(`${prefix} BEGIN ISOLATION LEVEL ${isolation}; ${auth} ${context} COMMIT;\n`, true);
  assert.equal(await s.done, 3); assert.match(s.state.stderr, /25001/); await s.persist(); isolationChecks.push(isolation);
}
const counts = JSON.parse(await capture('no-clinical-effects', `SELECT json_build_object('requests',(SELECT count(*) FROM public.lab_observation_requests),
  'roots',(SELECT count(*) FROM public.lab_observation_roots),'alerts',(SELECT count(*) FROM public.alerts),'work',(SELECT count(*) FROM public.work_items));`));
assert.deepEqual(counts, { requests: 0, roots: 0, alerts: 0, work: 0 });
const hashes = {};
for (const file of ['supabase/migrations/00066_lab_source_context.sql', 'supabase/tests/lab_source_context.sql', 'scripts/test-lab-source-context.mjs']) {
  hashes[file] = createHash('sha256').update(await readFile(file)).digest('hex');
}
await writeFile(path.join(output, 'completion.json'), JSON.stringify({ database, completed_at: new Date().toISOString(),
  actual_blocking_cases: results.length, isolation_checks: isolationChecks, counts, hashes, all_ok: true }, null, 2), { flag: 'wx' });
console.log('Source context blocking proof: PASS');
