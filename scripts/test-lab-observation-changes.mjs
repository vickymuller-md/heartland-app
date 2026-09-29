/** Local synthetic blocking tests for source changes; never connect to a hosted database.
 * node scripts/test-lab-observation-changes.mjs SOCKET PORT DATABASE NEW_OUTPUT
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
 && /^n2p3s_change_races_[a-z0-9_]+$/.test(database ?? '') && path.isAbsolute(output ?? ''), 'Explicit local clone required');
const args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-h', socket, '-p', port, '-U', 'postgres', '-d', database];
const raw = async (sql) => (await run('/opt/homebrew/bin/psql', [...args, '-c', sql])).stdout.trim();
assert.equal(await raw('SHOW listen_addresses'), '');
assert.equal(await raw('SELECT count(*) FROM auth.users'), '0');
await mkdir(output);
const source = await readFile('supabase/tests/lab_observation_changes.sql', 'utf8');
const fixtures = source.match(/-- BEGIN CHANGE FIXTURES\n([\s\S]*?)-- END CHANGE FIXTURES/)[1];
const uuidHelper = fixtures.match(/CREATE FUNCTION pg_temp\.lo\([\s\S]*?\$\$;/)[0];
const prefix = `SET search_path=public,extensions; SET timezone='UTC'; ${uuidHelper}\n`;
async function capture(name, sql) {
 await writeFile(path.join(output, name + '.sql'), sql, { flag: 'wx' });
 const result = await raw(sql);
 await writeFile(path.join(output, name + '.stdout'), result, { flag: 'wx' });
 return result;
}
await capture('fixtures', `BEGIN; ${fixtures}
 INSERT INTO public.member_authorizations(membership_id,capability,granted_by)
 SELECT id,'clinical_disposition',created_by FROM public.organization_memberships WHERE user_id=pg_temp.lo(2);
 COMMIT;`);
const auth = (actor = 1) => `SET LOCAL ROLE authenticated;
 SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.lo(${actor}),'aal','aal2')::text,true);`;
const occurrence = new Date(Date.now() - 3600000).toISOString();
const collection = new Date(Date.now() - 172800000).toISOString();
const originalPayload = JSON.stringify({ evidence: 'Synthetic source registration', occurred_at: occurrence });
const changePayload = (command = 'correct_source', value = '4.20') => JSON.stringify({
 reason: 'Private synthetic correction reason', evidence: 'Synthetic source revision', occurred_at: occurrence,
 ...(command === 'correct_source' ? { value, collected_at: collection } : {}),
});
const req = (n, actor = 1) => n + (actor === 1 ? 8000 : 9000);
const register = (n) => `SELECT public.prepare_lab_observation(pg_temp.lo(${n + 1000}),pg_temp.lo(${n + 2000}),
 pg_temp.lo(90),pg_temp.lo(11),pg_temp.lo(${n}),'potassium','${originalPayload}'); SELECT public.apply_lab_observation(pg_temp.lo(${n + 1000}));`;
const prepare = (n, actor = 1, command = 'correct_source', value = '4.20') => `SELECT public.prepare_lab_observation_change(
 pg_temp.lo(${req(n, actor)}),pg_temp.lo(${n + 2000}),pg_temp.lo(90),pg_temp.lo(11),1,'${command}','${changePayload(command, value)}');`;
const apply = (n, actor = 1) => `SELECT public.apply_lab_observation(pg_temp.lo(${req(n, actor)}));`;
const cancel = (n) => `SELECT public.cancel_lab_observation(pg_temp.lo(${req(n)}));`;
const revoke = (capability) => `UPDATE public.member_authorizations SET revoked_at=clock_timestamp() WHERE capability='${capability}'
 AND membership_id IN(SELECT id FROM public.organization_memberships WHERE user_id=pg_temp.lo(1) AND organization_id=pg_temp.lo(90));`;
const reset = `UPDATE public.member_authorizations SET revoked_at=NULL,expires_at=NULL;
 UPDATE public.provider_patient_links SET status='active' WHERE provider_id=pg_temp.lo(1);
 UPDATE public.consents SET accepted=true WHERE user_id=pg_temp.lo(1) AND consent_type='registration';`;
const holdScope = () => `SELECT pg_advisory_xact_lock(hashtextextended('heartland:work-ownership:'||pg_temp.lo(90)||':'||pg_temp.lo(11),0));`;
const cases = [
 { name: 'prepare-replay', first: (n) => prepare(n), second: (n) => prepare(n), state: 'prepared' },
 { name: 'prepare-conflict', first: (n) => prepare(n), second: (n) => prepare(n, 1, 'correct_source', '4.3'), secondCode: '23505', state: 'prepared' },
 { name: 'apply-replay', prepared: true, first: apply, second: apply, state: 'applied' },
 { name: 'apply-before-request-cancel', prepared: true, first: apply, second: cancel, state: 'applied' },
 { name: 'request-cancel-before-apply', prepared: true, first: cancel, second: apply, secondCode: '22023', state: 'cancelled' },
 { name: 'correction-before-correction', prepared: true, competitor: 'correct_source', first: apply, second: (n) => apply(n, 2), secondActor: 2, secondCode: '40001', state: 'applied' },
 { name: 'correction-before-source-cancel', prepared: true, competitor: 'cancel_source', first: apply, second: (n) => apply(n, 2), secondActor: 2, secondCode: '40001', state: 'applied' },
 { name: 'source-cancel-before-correction', prepared: true, command: 'cancel_source', competitor: 'correct_source', first: apply, second: (n) => apply(n, 2), secondActor: 2, secondCode: '40001', state: 'applied' },
 ...['clinical_disposition', 'monitor'].flatMap((capability) => [
  { name: `apply-before-${capability}-revocation`, prepared: true, first: apply, second: () => revoke(capability), secondAdmin: true, state: 'applied' },
  { name: `${capability}-revocation-before-apply`, prepared: true, first: () => revoke(capability), firstAdmin: true, second: apply, secondCode: '42501', state: 'prepared' },
  { name: `${capability}-expiry-during-wait`, prepared: true, expiry: capability, first: holdScope, firstAdmin: true, second: apply, secondCode: '42501', state: 'prepared' },
 ]),
 { name: 'link-revocation-before-apply', prepared: true, firstAdmin: true,
  first: () => `UPDATE public.provider_patient_links SET status='revoked' WHERE provider_id=pg_temp.lo(1) AND patient_id=pg_temp.lo(11);`,
  second: apply, secondCode: '42501', state: 'prepared' },
 { name: 'consent-revocation-before-apply', prepared: true, firstAdmin: true,
  first: () => `UPDATE public.consents SET accepted=false WHERE user_id=pg_temp.lo(1) AND consent_type='registration';`,
  second: apply, secondCode: '42501', state: 'prepared' },
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
 await capture(test.name + '-prepare', `${prefix} BEGIN; ${reset} ${auth()} ${register(n)}
  ${test.prepared ? prepare(n, 1, test.command) : ''}
  ${test.competitor ? `RESET ROLE; ${auth(2)} ${prepare(n, 2, test.competitor)}` : ''} RESET ROLE;
  ${test.expiry ? `UPDATE public.member_authorizations SET expires_at=clock_timestamp()+interval '2 seconds' WHERE capability='${test.expiry}'
   AND membership_id IN(SELECT id FROM public.organization_memberships WHERE user_id=pg_temp.lo(1) AND organization_id=pg_temp.lo(90));` : ''} COMMIT;`);
 const a = session(test.name + '-a'); const b = session(test.name + '-b'); let blocking;
 try {
  a.send(`${prefix} SELECT 'PID:'||pg_backend_pid(); BEGIN; SET LOCAL statement_timeout='12s';
   ${test.firstAdmin ? '' : auth()} ${test.first(n)}\n\\echo HOLDING\n`);
  await until(() => { if (a.state.ended) throw new Error(a.state.stderr); return a.state.stdout.includes('HOLDING'); }, test.name);
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
  }, test.name + ' blocking');
  if (test.expiry) await new Promise((resolve) => setTimeout(resolve, 2200));
  a.send('COMMIT;\n', true);
  const codes = await Promise.all([a.done, b.done]); assert.deepEqual(codes, [0, test.secondCode ? 3 : 0], a.state.stderr + b.state.stderr);
  if (test.secondCode) assert.match(b.state.stderr, new RegExp(test.secondCode));
  const readback = JSON.parse(await capture(test.name + '-readback', `${prefix} SELECT json_build_object(
   'state',(SELECT state FROM public.lab_observation_requests WHERE id=pg_temp.lo(${req(n)})),
   'competitor_state',(SELECT state FROM public.lab_observation_requests WHERE id=pg_temp.lo(${req(n, 2)})),
   'versions',(SELECT count(*) FROM public.lab_observation_versions WHERE root_id=pg_temp.lo(${n + 2000})),
   'events',(SELECT count(*) FROM public.lab_observation_change_events WHERE root_id=pg_temp.lo(${n + 2000})),
   'head_status',(SELECT status FROM public.lab_observation_versions WHERE root_id=pg_temp.lo(${n + 2000}) ORDER BY revision DESC LIMIT 1),
   'evaluations',(SELECT count(*) FROM public.lab_alert_evaluations WHERE lab_result_id IN
    (SELECT lab_result_id FROM public.lab_observation_versions WHERE root_id=pg_temp.lo(${n + 2000}))));`));
  const applied = test.state === 'applied'; const corrected = applied && test.command !== 'cancel_source';
  assert.deepEqual(readback, { state: test.state, competitor_state: test.competitor ? 'prepared' : null,
   versions: applied ? 2 : 1, events: applied ? 1 : 0, head_status: applied ? corrected ? 'corrected' : 'cancelled' : 'original', evaluations: corrected ? 1 : 0 });
  results.push({ name: test.name, codes, blocking, readback, ok: true }); console.log(test.name + ': PASS');
 } finally {
  if (!a.state.ended) a.child.kill('SIGTERM'); if (!b.state.ended) b.child.kill('SIGTERM');
  await Promise.all([a.done, b.done]); await Promise.all([a.persist(), b.persist()]);
  await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
 }
}
// Holding the entire work table must not block a source correction.
await capture('no-work-lock-prepare', `${prefix} BEGIN; ${reset} ${auth()} ${register(340)} ${prepare(340)} COMMIT;`);
const owner = session('no-work-lock-holder'); const correction = session('no-work-lock-correction');
try {
 owner.send(`${prefix} BEGIN; LOCK TABLE public.work_items IN ACCESS EXCLUSIVE MODE;\n\\echo WORK_HELD\n`);
 await until(() => owner.state.stdout.includes('WORK_HELD'), 'work table held');
 correction.send(`${prefix} BEGIN; SET LOCAL statement_timeout='3s'; ${auth()} ${apply(340)} COMMIT;\n`, true);
 assert.equal(await correction.done, 0, correction.state.stderr);
 assert.equal(owner.state.ended, false, 'Work lock must remain held while correction commits');
 owner.send('COMMIT;\n', true); assert.equal(await owner.done, 0);
 await capture('no-work-lock-readback', `${prefix} SELECT public.lab_observation_request_state(pg_temp.lo(${req(340)}));`);
} finally {
 if (!owner.state.ended) owner.child.kill('SIGTERM'); if (!correction.state.ended) correction.child.kill('SIGTERM');
 await Promise.all([owner.done, correction.done]); await Promise.all([owner.persist(), correction.persist()]);
}
let isolationChecks = 0;
for (const isolation of ['REPEATABLE READ', 'SERIALIZABLE']) {
 for (const operation of ['get', 'apply', 'update-amendment', 'delete-amendment']) {
  const s = session('isolation-' + isolation.toLowerCase().replaceAll(' ', '-') + '-' + operation);
  const query = operation === 'get' ? `SELECT public.get_lab_observation_request(pg_temp.lo(${req(340)}));`
   : operation === 'apply' ? apply(340)
   : `${operation === 'update-amendment' ? "UPDATE public.lab_results SET notes='Invalid old-snapshot write'" : 'DELETE FROM public.lab_results'}
    WHERE id=(SELECT lab_result_id FROM public.lab_observation_versions WHERE root_id=pg_temp.lo(2340) AND revision=2);`;
  s.send(`${prefix} BEGIN ISOLATION LEVEL ${isolation}; ${operation === 'get' || operation === 'apply' ? auth() : ''} ${query} COMMIT;\n`, true);
  assert.equal(await s.done, 3); assert.match(s.state.stderr, /25001/); await s.persist(); isolationChecks++;
 }
}
const hashes = {};
for (const filename of ['supabase/migrations/00063_lab_observation_changes.sql','supabase/tests/lab_observation_changes.sql','scripts/test-lab-observation-changes.mjs']) {
 hashes[filename] = createHash('sha256').update(await readFile(filename)).digest('hex');
}
await writeFile(path.join(output, 'completion.json'), JSON.stringify({ database, timestamp: new Date().toISOString(), hashes,
 race_count: cases.length, isolation_checks: isolationChecks, work_lock_independence: true,
 all_ok: results.every((row) => row.ok) && isolationChecks === 8 }, null, 2), { flag: 'wx' });
console.log('All local source-change concurrency checks passed.');
