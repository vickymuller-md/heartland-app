/** Synthetic local blocking/interleaving proof. Never connect to hosted services.
 * node scripts/test-effective-laboratory-scan.mjs SOCKET PORT DATABASE NEW_OUTPUT
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
 && /^n2p3t_scan_races_[a-z0-9_]+$/.test(database ?? '') && path.isAbsolute(output ?? ''));
const args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-h', socket, '-p', port, '-U', 'postgres', '-d', database];
const sql = async (statement) => (await run('/opt/homebrew/bin/psql', [...args, '-c', statement], { maxBuffer: 8 * 1024 * 1024 })).stdout.trim();
assert.equal(await sql('SHOW listen_addresses'), '');
assert.equal(await sql('SELECT count(*) FROM auth.users'), '0');
await mkdir(output);
const testSource = await readFile('supabase/tests/effective_laboratory_scan.sql', 'utf8');
const fixtures = testSource.match(/-- BEGIN EFFECTIVE SCAN FIXTURES\n([\s\S]*?)-- END EFFECTIVE SCAN FIXTURES/)[1];
const helpers = fixtures.match(/CREATE FUNCTION pg_temp\.es\([\s\S]*?\$\$;/)[0]
 + testSource.match(/-- BEGIN EFFECTIVE SCAN HELPERS\n([\s\S]*?)-- END EFFECTIVE SCAN HELPERS/)[1];
const prefix = `SET search_path=public,extensions; SET timezone='UTC'; ${helpers}\n`;
const service = `SELECT pg_temp.es_service();`;
async function capture(name, statement) {
 await writeFile(path.join(output, name + '.sql'), statement, { flag: 'wx' });
 const data = await sql(statement);
 await writeFile(path.join(output, name + '.stdout'), data, { flag: 'wx' });
 return data;
}
await capture('fixtures', `BEGIN; ${fixtures} ${helpers.replace(fixtures.match(/CREATE FUNCTION pg_temp\.es\([\s\S]*?\$\$;/)[0], '')}
 ${service} SELECT public.prepare_alert_scan('UTC'); COMMIT;`);
const finish = (n, decision = 'triggered', rule = 'hyperkalemia') => `SELECT pg_temp.es_finish(${n},'${rule}','${decision}');`;
const register = (n) => `SELECT pg_temp.es_register(${n});`;
const change = (n, command = 'correct_source') => `SELECT pg_temp.es_change(${n},'${command}');`;
const revoke = (n, both = false) => `UPDATE public.provider_patient_links SET status='revoked'
 WHERE patient_id=pg_temp.es(${n}) AND provider_id ${both ? 'IN(pg_temp.es(1),pg_temp.es(2))' : '=pg_temp.es(1)'};`;
const readbackSQL = (n) => `${prefix} SELECT json_build_object(
 'capture',(SELECT capture_status FROM public.alert_scan_patients WHERE id=pg_temp.es_receipt(${n})),
 'evaluation',(SELECT to_jsonb(e) FROM public.alert_scan_evaluations e WHERE receipt_id=pg_temp.es_receipt(${n}) AND rule='hyperkalemia'),
 'alerts',(SELECT count(*) FROM public.alerts WHERE patient_id=pg_temp.es(${n})),
 'work',(SELECT count(*) FROM public.work_items WHERE patient_id=pg_temp.es(${n})),
 'intents',(SELECT count(*) FROM public.notification_intents WHERE patient_id=pg_temp.es(${n})),
 'contexts',(SELECT count(*) FROM public.alert_effect_scope_context));`;
const results = [];
function session(name) {
 const child = spawn('/opt/homebrew/bin/psql', args, { stdio: 'pipe' });
 const state = { sql: '', stdout: '', stderr: '', ended: false };
 child.stdout.on('data', (part) => { state.stdout += part; }); child.stderr.on('data', (part) => { state.stderr += part; });
 const done = new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', (code) => { state.ended = true; resolve(code); }); });
 return { child, state, done, send(statement, end = false) { state.sql += statement; if (end) child.stdin.end(statement); else child.stdin.write(statement); },
  async persist() { for (const key of ['sql','stdout','stderr']) await writeFile(path.join(output, `${name}.${key}`), state[key], { flag: 'wx' }); } };
}
async function until(test, label) {
 const deadline = Date.now() + 8000;
 while (Date.now() < deadline) { if (await test()) return; await new Promise((resolve) => setTimeout(resolve, 25)); }
 throw new Error('Timed out: ' + label);
}
async function race(name, n, first, second, verify, { afterWait = '', expectedCode = null } = {}) {
 const a = session(name + '-a'), b = session(name + '-b'); let wait;
 try {
  a.send(`${prefix} SELECT 'PID:'||pg_backend_pid(); BEGIN; SET LOCAL statement_timeout='12s'; ${first}\n\\echo HOLDING\n`);
  await until(() => { if (a.state.ended) throw new Error(a.state.stderr); return a.state.stdout.includes('HOLDING'); }, name);
  const holder = Number(a.state.stdout.match(/PID:(\d+)/)?.[1]); assert.ok(holder);
  b.send(`${prefix} SELECT 'PID:'||pg_backend_pid(); BEGIN; SET LOCAL statement_timeout='12s'; ${second} COMMIT;\n`, true);
  await until(() => /PID:\d+/.test(b.state.stdout), name + ' contender');
  const contender = Number(b.state.stdout.match(/PID:(\d+)/)?.[1]);
  await until(async () => {
   if (b.state.ended) throw new Error(b.state.stderr || 'Contender failed to block');
   const data = await sql(`SELECT json_build_object('pid',pid,'blockers',pg_blocking_pids(pid),'wait',wait_event)
    FROM pg_stat_activity WHERE pid=${contender} AND ${holder}=ANY(pg_blocking_pids(pid));`);
   if (data) wait = JSON.parse(data); return Boolean(wait);
  }, name + ' real wait');
  a.send(`${afterWait} COMMIT;\n`, true);
  const codes = await Promise.all([a.done, b.done]); assert.deepEqual(codes, [0, expectedCode ? 3 : 0], a.state.stderr + b.state.stderr);
  if (expectedCode) assert.match(b.state.stderr, new RegExp(expectedCode));
  const readback = JSON.parse(await capture(name + '-readback', readbackSQL(n)));
  assert.equal(readback.contexts, 0); verify(readback);
  results.push({ name, wait, codes, readback, ok: true }); console.log(name + ': PASS');
 } finally {
  if (!a.state.ended) a.child.kill('SIGTERM'); if (!b.state.ended) b.child.kill('SIGTERM');
  await Promise.all([a.done,b.done]); await Promise.all([a.persist(),b.persist()]);
  await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
 }
}
const complete = (r) => { assert.equal(r.evaluation.status, 'complete'); assert.equal(r.alerts, 1); assert.equal(r.work, 4); assert.equal(r.intents, 4); };
const changed = (r) => { assert.equal(r.evaluation.status, 'blocked'); assert.equal(r.evaluation.error_code, 'source_changed'); assert.equal(r.alerts, 0); };
for (const [n, operation, before] of [[11,'register',true],[12,'register',false],[13,'correct',true],[14,'correct',false],[15,'cancel',true],[16,'cancel',false]]) {
 await capture(`source-${n}-setup`, `${prefix} BEGIN; ${operation !== 'register' ? register(n) : ''} SELECT pg_temp.es_capture(${n}); COMMIT;`);
 const mutation = operation === 'register' ? register(n) : change(n, operation === 'cancel' ? 'cancel_source' : 'correct_source');
 await race(`${operation}-${before ? 'before' : 'after'}-finalize`, n, before ? mutation : finish(n), before ? finish(n) : mutation, before ? changed : complete);
}
for (const n of [17,18]) {
 await capture(`replay-${n}-setup`, `${prefix} BEGIN; SELECT pg_temp.es_capture(${n}); COMMIT;`);
 await race(n === 17 ? 'concurrent-replay' : 'concurrent-conflicting-result', n, finish(n), finish(n, n === 17 ? 'triggered' : 'not_triggered'), complete,
  { expectedCode: n === 18 ? '23505' : null });
}
// A new lower UUID provider becomes eligible while the chosen provider profile
// blocks preflight. Authorized scope changed, so both capture/finalize must retry.
for (const [n, mode] of [[20,'finalize'],[21,'capture']]) {
 await capture(`scope-${n}-setup`, `${prefix} BEGIN; ${mode === 'finalize' ? `SELECT pg_temp.es_capture(${n});` : ''} ${revoke(n)} COMMIT;`);
 await race(`lower-provider-during-${mode}`, n, `SELECT id FROM public.profiles WHERE id=pg_temp.es(2) FOR UPDATE;`,
  mode === 'finalize' ? finish(n) : `SELECT pg_temp.es_capture(${n});`, (r) => {
   if (mode === 'finalize') { assert.equal(r.evaluation.status, 'failed'); assert.equal(r.evaluation.error_code, '40001'); }
   else assert.equal(r.capture, 'failed');
   assert.equal(r.alerts, 0);
  }, { afterWait: `UPDATE public.provider_patient_links SET status='active' WHERE patient_id=pg_temp.es(${n}) AND provider_id=pg_temp.es(1);` });
 const retry = await capture(`scope-${n}-retry`, `${prefix} BEGIN; SELECT pg_temp.es_capture(${n}); ${finish(n)} COMMIT;`);
 assert.ok(retry.includes('"status": "complete"'));
}
for (const [n, both] of [[22,false],[23,true]]) {
 await capture(`revocation-${n}-setup`, `${prefix} BEGIN; SELECT pg_temp.es_capture(${n}); COMMIT;`);
 await race(both ? 'all-scope-revoked' : 'selected-link-revoked-with-alternative', n, revoke(n,both), finish(n), (r) => {
  assert.equal(r.evaluation.status, both ? 'blocked' : 'failed');
  assert.equal(r.evaluation.error_code, both ? 'blocked_scope' : '40001'); assert.equal(r.alerts, 0);
 });
}
// A profile/organization deletion may not hold that identity and then wait for
// work while a second flag tries to acquire its FK. It waits at the early fence.
for (const [n, entity] of [[24,'profile'],[25,'organization']]) {
 await capture(`deletion-${n}-setup`, `${prefix} BEGIN; SELECT pg_temp.es_capture(${n}); COMMIT;`);
 const deletion = entity === 'profile' ? `DELETE FROM public.profiles WHERE id=pg_temp.es(2);` : `DELETE FROM public.organizations WHERE id=pg_temp.es(91);`;
 await race(`${entity}-deletion-between-two-flags`, n, finish(n), deletion, (r) => {
  assert.equal(r.evaluation.status, 'complete'); assert.equal(r.alerts, 2); assert.equal(r.work, 8); assert.equal(r.intents, 8);
 }, { afterWait: finish(n,'triggered','low_egfr'), expectedCode: '23503' });
}
// No blocking is expected for a new recipient outside the preflight set; the
// BEFORE guard must reject it BEFORE acquiring any of its new identity FKs.
{
 const a = session('late-routing-a');
 try {
  a.send(`${prefix} BEGIN; ${service} SELECT public.begin_alert_effect_scope(pg_temp.es(19));\n\\echo HOLDING\n`);
  await until(() => { if (a.state.ended) throw new Error(a.state.stderr); return a.state.stdout.includes('HOLDING'); }, 'late routing fence');
  await capture('late-routing-b', `${prefix} BEGIN;
   INSERT INTO public.provider_patient_links(provider_id,patient_id,status,linked_at) VALUES(pg_temp.es(3),pg_temp.es(19),'active',now());
   COMMIT;`);
  a.send(`SELECT public.coalesce_fenced_patient_alert(pg_temp.es(19),'critical',ARRAY['hyperkalemia']); COMMIT;\n`,true);
  assert.equal(await a.done, 3); assert.match(a.state.stderr,/40001/);
  const readback = JSON.parse(await capture('late-routing-readback',readbackSQL(19)));
  assert.equal(readback.alerts,0); assert.equal(readback.work,0); assert.equal(readback.intents,0); assert.equal(readback.contexts,0);
  results.push({name:'late-routing-retryable-before-fk',ok:true,readback}); console.log('late-routing-retryable-before-fk: PASS');
 } finally { if (!a.state.ended) a.child.kill('SIGTERM'); await a.done; await a.persist(); }
}
const isolation = [];
for (const level of ['REPEATABLE READ','SERIALIZABLE']) for (const method of ['capture','finish']) {
 const statement = `${prefix} BEGIN ISOLATION LEVEL ${level}; SELECT pg_temp.es_${method}(17); COMMIT;`;
 const name = `isolation-${level.replaceAll(' ','-').toLowerCase()}-${method}`;
 await writeFile(path.join(output,name+'.sql'),statement,{flag:'wx'});
 let failure;
 try { await sql(statement); } catch (error) { failure=error; }
 assert.ok(failure); assert.match(failure.stderr,/25001/);
 await writeFile(path.join(output,name+'.stderr'),failure.stderr,{flag:'wx'}); isolation.push({name,ok:true});
}
const hashes = {};
for (const file of ['supabase/migrations/00064_effective_laboratory_scan.sql','supabase/tests/effective_laboratory_scan.sql','scripts/test-effective-laboratory-scan.mjs']) {
 hashes[file]=createHash('sha256').update(await readFile(file)).digest('hex');
}
await writeFile(path.join(output,'completion.json'),JSON.stringify({database,completed_at:new Date().toISOString(),hashes,results,isolation,all_ok:true},null,2),{flag:'wx'});
console.log(`Completed ${results.length} interleavings and ${isolation.length} isolation denials.`);
