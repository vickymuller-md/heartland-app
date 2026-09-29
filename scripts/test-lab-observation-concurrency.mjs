/** Disposable local PostgreSQL only; actual blocking pairs and old-snapshot writes.
 * node scripts/test-lab-observation-concurrency.mjs SOCKET PORT DATABASE NEW_OUTPUT
 */
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
const run = promisify(execFile);
const [socket, port, database, output] = process.argv.slice(2);
assert.ok(socket?.startsWith('/private/tmp/hl-') && /^\d+$/.test(port ?? '')
 && /^n2p3q_observation_races_[a-z0-9_]+$/.test(database ?? '') && path.isAbsolute(output ?? ''), 'Explicit local clone required');
const args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-h', socket, '-p', port, '-U', 'postgres', '-d', database];
const raw = async (sql) => (await run('/opt/homebrew/bin/psql', [...args, '-c', sql])).stdout.trim();
assert.equal(await raw('SHOW listen_addresses'), '');
assert.equal(await raw('SELECT count(*) FROM auth.users'), '0');
await mkdir(output);
const source = await readFile('supabase/tests/lab_observation_roots.sql', 'utf8');
const fixtures = source.match(/-- BEGIN OBSERVATION FIXTURES\n([\s\S]*?)-- END OBSERVATION FIXTURES/)[1];
const uuidHelper = fixtures.match(/CREATE FUNCTION pg_temp\.lo\([\s\S]*?\$\$;/)[0];
const prefix = `SET search_path=public,extensions; SET timezone='UTC'; ${uuidHelper}\n`;
async function capture(name, sql) {
 await writeFile(path.join(output, name + '.sql'), sql, { flag: 'wx' });
 const result = await raw(sql);
 await writeFile(path.join(output, name + '.stdout'), result, { flag: 'wx' });
 return result;
}
await capture('fixtures', `BEGIN; ${fixtures} COMMIT;`);
const auth = (actor = 1) => `SET LOCAL ROLE authenticated;
 SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.lo(${actor}),'aal','aal2')::text,true);`;
const payload = JSON.stringify({ occurred_at: new Date(Date.now() - 3600000).toISOString(), evidence: 'Synthetic source race evidence' });
const request = (n, actor = 1) => n + (actor === 1 ? 1000 : 4000);
const root = (n, actor = 1) => n + (actor === 1 ? 2000 : 5000);
const prepare = (n, actor = 1, analyte = 'potassium', changed = false) => `SELECT public.prepare_lab_observation(
 pg_temp.lo(${request(n, actor)}),pg_temp.lo(${root(n, actor)}),pg_temp.lo(${actor === 1 ? 90 : 91}),pg_temp.lo(11),pg_temp.lo(${n}),
 '${analyte}','${payload}'::jsonb${changed ? `||'{"evidence":"Changed synthetic evidence"}'` : ''});`;
const apply = (n, actor = 1) => `SELECT public.apply_lab_observation(pg_temp.lo(${request(n, actor)}));`;
const cancel = (n) => `SELECT public.cancel_lab_observation(pg_temp.lo(${request(n)}));`;
const revoke = (capability) => `UPDATE public.member_authorizations SET revoked_at=clock_timestamp() WHERE capability='${capability}'
 AND membership_id IN(SELECT id FROM public.organization_memberships WHERE user_id=pg_temp.lo(1) AND organization_id=pg_temp.lo(90));`;
const revokeLink = `UPDATE public.provider_patient_links SET status='revoked' WHERE provider_id=pg_temp.lo(1) AND patient_id=pg_temp.lo(11);`;
const revokeConsent = `UPDATE public.consents SET accepted=false WHERE user_id=pg_temp.lo(1) AND consent_type='registration';`;
const suspend = `UPDATE public.organization_memberships SET status='suspended' WHERE user_id=pg_temp.lo(1) AND organization_id=pg_temp.lo(90);`;
const reset = `UPDATE public.provider_patient_links SET status='active' WHERE provider_id=pg_temp.lo(1) AND patient_id=pg_temp.lo(11);
 UPDATE public.member_authorizations SET revoked_at=NULL,expires_at=NULL;
 UPDATE public.consents SET accepted=true WHERE user_id=pg_temp.lo(1) AND consent_type='registration';
 UPDATE public.organization_memberships SET status='active' WHERE user_id=pg_temp.lo(1) AND organization_id=pg_temp.lo(90);`;
const holdScope = () => `SELECT pg_advisory_xact_lock(hashtextextended('heartland:work-ownership:'||pg_temp.lo(90)||':'||pg_temp.lo(11),0));`;
const changeSource = (n) => `UPDATE public.lab_results SET notes='Changed during synthetic race' WHERE id=pg_temp.lo(${n});`;
const cases = [
 { name: 'prepare-replay', first: (n) => prepare(n), second: (n) => prepare(n), state: 'prepared' },
 { name: 'prepare-conflict', first: (n) => prepare(n), second: (n) => prepare(n, 1, 'potassium', true), secondCode: '23505', state: 'prepared' },
 { name: 'apply-replay', prepared: true, first: apply, second: apply, state: 'applied' },
 { name: 'apply-before-cancel', prepared: true, first: apply, second: cancel, state: 'applied' },
 { name: 'cancel-before-apply', prepared: true, first: cancel, second: apply, secondCode: '22023', state: 'cancelled' },
 { name: 'cancel-replay', prepared: true, first: cancel, second: cancel, state: 'cancelled' },
 ...['clinical_disposition', 'monitor'].flatMap((capability) => [
  { name: `apply-before-${capability}-revocation`, prepared: true, first: apply, second: () => revoke(capability), secondAdmin: true, state: 'applied' },
  { name: `${capability}-revocation-before-apply`, prepared: true, first: () => revoke(capability), firstAdmin: true, second: apply, secondCode: '42501', state: 'prepared' },
  { name: `${capability}-expiry-during-wait`, prepared: true, expiry: capability, first: holdScope, firstAdmin: true, second: apply, secondCode: '42501', state: 'prepared' },
 ]),
 { name: 'apply-before-link-revocation', prepared: true, first: apply, second: () => revokeLink, secondAdmin: true, state: 'applied' },
 { name: 'link-revocation-before-apply', prepared: true, first: () => revokeLink, firstAdmin: true, second: apply, secondCode: '42501', state: 'prepared' },
 { name: 'consent-revocation-before-apply', prepared: true, first: () => revokeConsent, firstAdmin: true, second: apply, secondCode: '42501', state: 'prepared' },
 { name: 'membership-suspended-before-apply', prepared: true, first: () => suspend, firstAdmin: true, second: apply, secondCode: '42501', state: 'prepared' },
 { name: 'source-change-before-apply', prepared: true, first: changeSource, firstAdmin: true, second: apply, secondCode: '40001', state: 'prepared' },
 { name: 'apply-before-source-change', prepared: true, first: apply, second: changeSource, secondAdmin: true, secondCode: '42501', state: 'applied' },
 { name: 'first-organization-wins', prepared: true, competitor: true, first: apply, second: (n) => apply(n, 3), secondActor: 3, secondCode: '23505', state: 'applied', competitorState: 'prepared', organizations: [90] },
 { name: 'second-organization-wins', prepared: true, competitor: true, first: (n) => apply(n, 3), firstActor: 3, second: apply, secondCode: '23505', state: 'prepared', competitorState: 'applied', organizations: [91] },
 { name: 'different-analytes-same-panel', prepared: true, competitor: true, competitorAnalyte: 'creatinine', first: apply, second: (n) => apply(n, 3), secondActor: 3, state: 'applied', competitorState: 'applied', organizations: [90, 91] },
];
function session(label) {
 const child = spawn('/opt/homebrew/bin/psql', args, { stdio: 'pipe' });
 const state = { sql: '', stdout: '', stderr: '', ended: false };
 child.stdout.on('data', (chunk) => { state.stdout += chunk; }); child.stderr.on('data', (chunk) => { state.stderr += chunk; });
 const done = new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', (code) => { state.ended = true; resolve(code); }); });
 return { child, state, done,
  send(sql, end = false) { state.sql += sql; if (end) child.stdin.end(sql); else child.stdin.write(sql); },
  async persist() { for (const field of ['sql', 'stdout', 'stderr']) await writeFile(path.join(output, `${label}.${field}`), state[field], { flag: 'wx' }); },
 };
}
async function until(test, name) {
 const deadline = Date.now() + 8000;
 while (Date.now() < deadline) { if (await test()) return; await new Promise((resolve) => setTimeout(resolve, 25)); }
 throw new Error('Timed out: ' + name);
}
const results = [];
for (const [index, test] of cases.entries()) {
 const n = 300 + index;
 await capture(test.name + '-prepare', `${prefix} BEGIN; ${reset} ${auth()} ${test.prepared ? prepare(n) : ''}
  ${test.competitor ? `RESET ROLE; ${auth(3)} ${prepare(n, 3, test.competitorAnalyte)}` : ''} RESET ROLE;
  ${test.expiry ? `UPDATE public.member_authorizations SET expires_at=clock_timestamp()+interval '2 seconds' WHERE capability='${test.expiry}'
   AND membership_id IN(SELECT id FROM public.organization_memberships WHERE user_id=pg_temp.lo(1) AND organization_id=pg_temp.lo(90));` : ''} COMMIT;`);
 const a = session(test.name + '-a'); const b = session(test.name + '-b'); let blocking;
 try {
  a.send(`${prefix} SELECT 'PID:'||pg_backend_pid(); BEGIN; SET LOCAL statement_timeout='12s';
   ${test.firstAdmin ? '' : auth(test.firstActor)} ${test.first(n)}\n\\echo HOLDING\n`);
  await until(() => { if (a.state.ended) throw new Error(a.state.stderr); return a.state.stdout.includes('HOLDING'); }, test.name + ' holder');
  const holder = Number(a.state.stdout.match(/PID:(\d+)/)?.[1]); assert.ok(holder);
  b.send(`${prefix} SELECT 'PID:'||pg_backend_pid(); BEGIN; SET LOCAL statement_timeout='12s';
   ${test.secondAdmin ? '' : auth(test.secondActor)} ${test.second(n)} COMMIT;\n`, true);
  await until(() => /PID:\d+/.test(b.state.stdout), test.name + ' contender');
  const contender = Number(b.state.stdout.match(/PID:(\d+)/)?.[1]);
  await until(async () => {
   if (b.state.ended) throw new Error(b.state.stderr || 'Contender did not wait');
   const row = await raw(`SELECT json_build_object('pid',pid,'blockers',pg_blocking_pids(pid),'wait',wait_event)
    FROM pg_stat_activity WHERE pid=${contender} AND ${holder}=ANY(pg_blocking_pids(pid));`);
   if (row) blocking = JSON.parse(row); return Boolean(blocking);
  }, test.name + ' blocking edge');
  if (test.expiry) await new Promise((resolve) => setTimeout(resolve, 2200));
  a.send('COMMIT;\n', true);
  const codes = await Promise.all([a.done, b.done]); assert.deepEqual(codes, [0, test.secondCode ? 3 : 0], a.state.stderr + b.state.stderr);
  if (test.secondCode) assert.match(b.state.stderr, new RegExp(test.secondCode));
  const readback = JSON.parse(await capture(test.name + '-readback', `${prefix} SELECT json_build_object(
   'state',(SELECT state FROM public.lab_observation_requests WHERE id=pg_temp.lo(${request(n)})),
   'competitor_state',(SELECT state FROM public.lab_observation_requests WHERE id=pg_temp.lo(${request(n, 3)})),
   'organizations',COALESCE((SELECT json_agg(organization_id ORDER BY organization_id) FROM public.lab_observation_roots WHERE original_lab_result_id=pg_temp.lo(${n})),'[]'),
   'versions',(SELECT count(*) FROM public.lab_observation_versions WHERE lab_result_id=pg_temp.lo(${n})),
   'evaluations',(SELECT count(*) FROM public.lab_alert_evaluations WHERE lab_result_id=pg_temp.lo(${n})));`));
  const organizations = test.organizations ?? (test.state === 'applied' ? [90] : []);
  assert.deepEqual(readback, { state: test.state, competitor_state: test.competitorState ?? null,
   organizations: organizations.map((x) => `61000000-0000-4000-8000-${String(x).padStart(12, '0')}`), versions: organizations.length, evaluations: 0 });
  results.push({ name: test.name, codes, blocking, readback, ok: true }); console.log(test.name + ': PASS');
 } finally {
  if (!a.state.ended) a.child.kill('SIGTERM'); if (!b.state.ended) b.child.kill('SIGTERM');
  await Promise.all([a.done, b.done]); await Promise.all([a.persist(), b.persist()]);
  await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
 }
}
await capture('restore-fixture-eligibility', prefix + reset);
let oldSnapshotChecks = 0;
for (const isolation of ['REPEATABLE READ', 'SERIALIZABLE']) {
 const s = session('isolation-' + isolation.toLowerCase().replaceAll(' ', '-'));
 s.send(`${prefix} BEGIN ISOLATION LEVEL ${isolation}; ${auth()} SELECT public.get_lab_observation_request(pg_temp.lo(1300)); COMMIT;\n`, true);
 assert.equal(await s.done, 3); assert.match(s.state.stderr, /25001/); await s.persist();
 for (const operation of ['UPDATE', 'DELETE']) {
  const n = 400 + oldSnapshotChecks;
  const name = 'old-snapshot-' + isolation.toLowerCase().replaceAll(' ', '-') + '-' + operation.toLowerCase();
  await capture(name + '-prepare', `${prefix} BEGIN; ${auth()} ${prepare(n)} COMMIT;`);
  const a = session(name + '-a');
  try {
   // Fix a snapshot before another connection commits the root. That connection
   // only locks the source row; its tuple is deliberately not rewritten.
   a.send(`${prefix} BEGIN ISOLATION LEVEL ${isolation}; SELECT count(*) FROM public.lab_observation_roots WHERE original_lab_result_id=pg_temp.lo(${n});\n\\echo SNAPSHOT\n`);
   await until(() => { if (a.state.ended) throw new Error(a.state.stderr); return a.state.stdout.includes('SNAPSHOT'); }, name);
   await capture(name + '-register', `${prefix} BEGIN; ${auth()} ${apply(n)} COMMIT;`);
   a.send(`${operation === 'UPDATE' ? `UPDATE public.lab_results SET notes='Old snapshot write'` : 'DELETE FROM public.lab_results'} WHERE id=pg_temp.lo(${n}); COMMIT;\n`, true);
   assert.equal(await a.done, 3); assert.match(a.state.stderr, /25001.*Laboratory source writes require READ COMMITTED/);
   assert.equal(await capture(name + '-readback', `${prefix} SELECT notes FROM public.lab_results WHERE id=pg_temp.lo(${n});`), 'Legacy synthetic source');
   oldSnapshotChecks++; console.log(name + ': PASS');
  } finally { if (!a.state.ended) a.child.kill('SIGTERM'); await a.done; await a.persist(); }
 }
}
const hashes = {};
for (const filename of ['supabase/migrations/00061_lab_observation_roots.sql', 'supabase/tests/lab_observation_roots.sql', 'scripts/test-lab-observation-concurrency.mjs']) {
 hashes[filename] = createHash('sha256').update(await readFile(filename)).digest('hex');
}
await writeFile(path.join(output, 'completion.json'), JSON.stringify({ database, timestamp: new Date().toISOString(), hashes,
 race_count: cases.length, isolation_checks: 2, old_snapshot_write_checks: oldSnapshotChecks, all_ok: results.every((row) => row.ok) && oldSnapshotChecks === 4 }, null, 2), { flag: 'wx' });
console.log('All local observation races passed.');
