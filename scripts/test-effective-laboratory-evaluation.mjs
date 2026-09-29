/** Synthetic local blocking/interleaving proof. Never connect to hosted services.
 * node scripts/test-effective-laboratory-evaluation.mjs SOCKET PORT DATABASE NEW_OUTPUT
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
 && /^n2p3u_eval_races_[a-z0-9_]+$/.test(database ?? '') && path.isAbsolute(output ?? ''));
const args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-h', socket, '-p', port, '-U', 'postgres', '-d', database];
const sql = async (statement) => (await run('/opt/homebrew/bin/psql', [...args, '-c', statement], { maxBuffer: 8 * 1024 * 1024 })).stdout.trim();
assert.equal(await sql('SHOW listen_addresses'), '');
assert.equal(await sql('SELECT count(*) FROM auth.users'), '0');
await mkdir(output);
const testSource = await readFile('supabase/tests/effective_laboratory_evaluation.sql', 'utf8');
let fixtures = testSource.match(/-- BEGIN EFFECTIVE EVALUATION FIXTURES\n([\s\S]*?)-- END EFFECTIVE EVALUATION FIXTURES/)[1];
fixtures = fixtures.replace(/CASE WHEN n=16 THEN NULL WHEN n=17 THEN 5.5 ELSE 6.2 END/, '6.2')
 .replace(/CASE WHEN n IN\(13,15,20,21,22\) THEN NULL WHEN n=17 THEN 15 WHEN n=16 THEN NULL ELSE 10 END/, '10')
 .replace(/CASE WHEN n=16 THEN 140 ELSE NULL END/, 'NULL');
const helpers = fixtures.match(/CREATE FUNCTION pg_temp\.ee\([\s\S]*?\$\$;/)[0]
 + testSource.match(/-- BEGIN EFFECTIVE EVALUATION HELPERS\n([\s\S]*?)-- END EFFECTIVE EVALUATION HELPERS/)[1];
const prefix = `SET search_path=public,extensions; SET timezone='UTC'; ${helpers}\n`;
const service = `SELECT pg_temp.ee_service();`;
async function capture(name, statement) {
 await writeFile(path.join(output, name + '.sql'), statement, { flag: 'wx' });
 const data = await sql(statement);
 await writeFile(path.join(output, name + '.stdout'), data, { flag: 'wx' });
 return data;
}
await capture('fixtures', `BEGIN; ${fixtures} ${helpers.replace(fixtures.match(/CREATE FUNCTION pg_temp\.ee\([\s\S]*?\$\$;/)[0], '')}
 ${service} COMMIT;`);
const processEvent = (n) => `SELECT pg_temp.ee_process(${n});`;
const register = (n) => `SELECT pg_temp.ee_register(${n});`;
const change = (n, command = 'correct_source') => `SELECT pg_temp.ee_change(${n},'${command}');`;
const revoke = (n, both = false) => `UPDATE public.provider_patient_links SET status='revoked'
 WHERE patient_id=pg_temp.ee(${n}) AND provider_id ${both ? 'IN(pg_temp.ee(1),pg_temp.ee(2))' : '=pg_temp.ee(1)'};`;
const readbackSQL = (n) => `${prefix} SELECT json_build_object(
 'evaluation',(SELECT to_jsonb(e) FROM public.lab_alert_evaluations e WHERE lab_result_id=pg_temp.ee(${100}+ ${n})),
 'alerts',(SELECT count(*) FROM public.alerts WHERE patient_id=pg_temp.ee(${n})),
 'work',(SELECT count(*) FROM public.work_items WHERE patient_id=pg_temp.ee(${n})),
 'intents',(SELECT count(*) FROM public.notification_intents WHERE patient_id=pg_temp.ee(${n})),
 'sources',(SELECT count(*) FROM public.lab_alert_sources WHERE patient_id=pg_temp.ee(${n})),
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

const complete = (r, signals = 2) => { assert.equal(r.evaluation.status,'recorded'); assert.equal(r.alerts,signals);
 assert.equal(r.sources,signals); assert.equal(r.work,signals*4); assert.equal(r.intents,signals*4); assert.ok(r.evaluation.source_assessment); };
const pending = (r) => { assert.equal(r.evaluation.status,'pending'); assert.equal(r.evaluation.last_error_code,'evaluation_failed');
 assert.equal(r.evaluation.source_assessment,null); assert.equal(r.alerts,0); assert.equal(r.work,0); assert.equal(r.intents,0); };
for (const [n, operation, before] of [[11,'register',true],[12,'register',false],[13,'correct',true],[14,'correct',false],[15,'cancel',true],[16,'cancel',false]]) {
 if(operation!=='register') await capture(`source-${n}-setup`,`${prefix} BEGIN; ${register(n)} COMMIT;`);
 const mutation = operation === 'register' ? register(n) : change(n,operation==='cancel'?'cancel_source':'correct_source');
 await race(`${operation}-${before?'before':'after'}-processing`,n,before?mutation:processEvent(n),before?processEvent(n):mutation,(r)=>{
  complete(r,before&&operation!=='register'?1:2);
  assert.equal(r.evaluation.source_assessment.analytes.potassium.reason,before&&operation!=='register'?(operation==='cancel'?'cancelled':'replaced'):'effective');
  assert.equal(r.evaluation.source_assessment.analytes.egfr.reason,'effective');
 });
}
await race('concurrent-terminal-replay',17,processEvent(17),processEvent(17),(r)=>{complete(r);assert.equal(r.evaluation.attempt_count,1);});
for (const [n,both] of [[18,false],[19,true]]) {
 await race(both?'all-scope-revoked':'selected-provider-revoked',n,revoke(n,both),processEvent(n),pending);
 await capture(`restore-${n}`,`${prefix} BEGIN; UPDATE public.provider_patient_links SET status='active' WHERE patient_id=pg_temp.ee(${n}); ${processEvent(n)} COMMIT;`);
 complete(JSON.parse(await capture(`restore-${n}-readback`,readbackSQL(n))));
}
await capture('lower-provider-setup',`${prefix} BEGIN; ${revoke(20)} COMMIT;`);
await race('lower-provider-becomes-eligible',20,`SELECT id FROM public.profiles WHERE id=pg_temp.ee(2) FOR UPDATE;`,processEvent(20),pending,
 {afterWait:`UPDATE public.provider_patient_links SET status='active' WHERE patient_id=pg_temp.ee(20) AND provider_id=pg_temp.ee(1);`});
await capture('lower-provider-retry',`${prefix} BEGIN; ${processEvent(20)} COMMIT;`);
complete(JSON.parse(await capture('lower-provider-readback',readbackSQL(20))));

// A real actor-only erasure can wait for an event without invalidating its source proof.
await capture('actor-setup',`${prefix} BEGIN;
 INSERT INTO auth.users(id,email,raw_user_meta_data) SELECT pg_temp.ee(n),'evaluation-actor-'||n||'@example.invalid',
  '{"signup_intent":"sandbox","consent_accepted":true}'::jsonb FROM unnest(ARRAY[96,97]) n;
 UPDATE public.profiles SET sandbox_expires_at=now()-interval '1 day' WHERE id IN(pg_temp.ee(96),pg_temp.ee(97));
 UPDATE public.lab_alert_evaluations SET recorded_by=CASE WHEN patient_id=pg_temp.ee(21) THEN pg_temp.ee(96) ELSE pg_temp.ee(97) END
  WHERE patient_id IN(pg_temp.ee(21),pg_temp.ee(22)); COMMIT;`);
await race('actor-erasure-after-processing',21,processEvent(21),`${service} SELECT public.purge_expired_tester_provenance(pg_temp.ee(96));`,
 (r)=>{complete(r);assert.equal(r.evaluation.recorded_by,null);});
await race('actor-erasure-before-processing',22,`${service} SELECT public.purge_expired_tester_provenance(pg_temp.ee(97));`,processEvent(22),
 (r)=>{complete(r);assert.equal(r.evaluation.recorded_by,null);});

// Pause WITHIN the function after its first signal, then attempt account deletion.
await capture('pause-trigger',`CREATE FUNCTION public.synthetic_eval_pause() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN IF NEW.patient_id::text IN('65000000-0000-4000-8000-000000000024','65000000-0000-4000-8000-000000000025') AND NEW.flag='hyperkalemia'
 THEN PERFORM pg_advisory_xact_lock(65065,right(NEW.patient_id::text,2)::integer); END IF; RETURN NEW; END $$;
 CREATE TRIGGER synthetic_eval_pause AFTER INSERT ON public.lab_alert_sources FOR EACH ROW EXECUTE FUNCTION public.synthetic_eval_pause();`);
for(const [n,entity] of [[24,'profile'],[25,'organization']]) {
 const name=entity+'-deletion-between-flags'; const a=session(name+'-a'),b=session(name+'-b'),c=session(name+'-controller'); let wait,firstWait;
 try {
  c.send(`SELECT 'PID:'||pg_backend_pid(); SELECT pg_advisory_lock(65065,${n});\n\\echo HOLDING\n`);
  await until(()=>c.state.stdout.includes('HOLDING'),name+' controller');
  const controller=Number(c.state.stdout.match(/PID:(\d+)/)?.[1]);
  a.send(`${prefix} SELECT 'PID:'||pg_backend_pid(); BEGIN; SET LOCAL statement_timeout='15s'; ${processEvent(n)} COMMIT;\n`,true);
  await until(()=>/PID:\d+/.test(a.state.stdout),name+' processor');
  const holder=Number(a.state.stdout.match(/PID:(\d+)/)?.[1]);
  await until(async()=>{if(a.state.ended)throw new Error(a.state.stderr||a.state.stdout);
   const d=await sql(`SELECT json_build_object('pid',pid,'blockers',pg_blocking_pids(pid),'wait',wait_event) FROM pg_stat_activity WHERE pid=${holder} AND ${controller}=ANY(pg_blocking_pids(pid));`);
   if(d)firstWait=JSON.parse(d);return Boolean(firstWait);},name+' first flag');
  const deletion=entity==='profile'?`DELETE FROM public.profiles WHERE id=pg_temp.ee(2);`:`DELETE FROM public.organizations WHERE id=pg_temp.ee(91);`;
  b.send(`${prefix} SELECT 'PID:'||pg_backend_pid(); BEGIN; SET LOCAL statement_timeout='15s'; ${deletion} COMMIT;\n`,true);
  await until(()=>/PID:\d+/.test(b.state.stdout),name+' deletion');
  const contender=Number(b.state.stdout.match(/PID:(\d+)/)?.[1]);
  await until(async()=>{if(b.state.ended)throw new Error(b.state.stderr||'Deletion did not wait');
   const d=await sql(`SELECT json_build_object('pid',pid,'blockers',pg_blocking_pids(pid),'wait',wait_event) FROM pg_stat_activity WHERE pid=${contender} AND ${holder}=ANY(pg_blocking_pids(pid));`);
   if(d)wait=JSON.parse(d);return Boolean(wait);},name+' identity fence');
  c.send(`SELECT pg_advisory_unlock(65065,${n});\n`,true);
  const codes=await Promise.all([a.done,b.done,c.done]);assert.deepEqual(codes,[0,3,0],a.state.stderr+b.state.stderr);
  assert.match(b.state.stderr,/23503/);
  const readback=JSON.parse(await capture(name+'-readback',readbackSQL(n)));complete(readback);assert.equal(readback.contexts,0);
  results.push({name,firstWait,wait,codes,readback,ok:true});console.log(name+': PASS');
 }finally{for(const s of [a,b,c])if(!s.state.ended)s.child.kill('SIGTERM');
  await Promise.all([a.done,b.done,c.done]);await Promise.all([a.persist(),b.persist(),c.persist()]);}
}
await capture('remove-pause-trigger','DROP TRIGGER synthetic_eval_pause ON public.lab_alert_sources; DROP FUNCTION public.synthetic_eval_pause();');
const isolation=[];
for(const level of ['REPEATABLE READ','SERIALIZABLE']) for(const n of [17,23]) {
 const name=`isolation-${level.replaceAll(' ','-').toLowerCase()}-${n===17?'terminal':'pending'}`;
 const statement=`${prefix} BEGIN ISOLATION LEVEL ${level}; ${processEvent(n)} COMMIT;`;
 await writeFile(path.join(output,name+'.sql'),statement,{flag:'wx'});let failure;
 try{await sql(statement);}catch(error){failure=error;}
 assert.ok(failure);assert.match(failure.stderr,/25001/);
 await writeFile(path.join(output,name+'.stderr'),failure.stderr,{flag:'wx'});isolation.push({name,ok:true});
}
const hashes={};
for(const file of ['supabase/migrations/00065_effective_laboratory_evaluation.sql','supabase/tests/effective_laboratory_evaluation.sql','scripts/test-effective-laboratory-evaluation.mjs']){
 hashes[file]=createHash('sha256').update(await readFile(file)).digest('hex');
}
await writeFile(path.join(output,'completion.json'),JSON.stringify({database,completed_at:new Date().toISOString(),hashes,results,isolation,all_ok:true},null,2),{flag:'wx'});
console.log(`Completed ${results.length} interleavings and ${isolation.length} isolation denials.`);
