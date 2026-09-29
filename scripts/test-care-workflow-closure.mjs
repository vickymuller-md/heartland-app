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
  && /^n2p3z_closure_races_[a-z0-9_]+$/.test(database ?? '') && path.isAbsolute(output ?? ''));
const args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-h', socket, '-p', port, '-U', 'postgres', '-d', database];
const sql = async (statement) => (await run('/opt/homebrew/bin/psql', [...args, '-c', statement], { maxBuffer: 8 * 1024 * 1024 })).stdout.trim();
assert.equal(await sql('SHOW listen_addresses'), ''); assert.equal(await sql('SELECT count(*) FROM auth.users'), '0');
await mkdir(output);
const suite = await readFile('supabase/tests/care_workflow_closure.sql', 'utf8');
const extract = (name) => suite.match(new RegExp('-- BEGIN '+name+'\\n([\\s\\S]*?)-- END '+name))[1];
const fixtures = extract('CLOSURE FIXTURES');
const helper = fixtures.match(/CREATE FUNCTION pg_temp\.cs\([\s\S]*?\$\$;/)[0];
const prefix = `SET search_path=public,extensions; SET timezone='UTC'; ${helper} ${extract('CLOSURE SHARED HELPERS')} ${extract('CLOSURE HELPERS')}\n`;
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

const guid = (n) => '60000000-0000-4000-8000-' + String(n).padStart(12,'0');
const decode = (value, tag) => JSON.parse(value.match(new RegExp('^'+tag+':(.*)$','m'))[1]);
const quote = (value) => "'"+JSON.stringify(value).replaceAll("'","''")+"'::jsonb";
const request = (n) => 500000+n;
const work = (n, source=false) => source ? 20000+n : 100+n;
const write = (n) => ` SELECT 'CLOSURE_STATE:'||public.apply_care_human_request(pg_temp.cs(${request(n)}))::text;`;
async function setup(n, {source=false, removed=false, prepare=true}={}) {
 const w=work(n,source), command=source?'close_without_completion':'close_success';
 return capture('setup-'+n,prefix+` BEGIN; ${auth} SELECT ${source?`pg_temp.csr_setup(${n},${removed})`:`pg_temp.cl_ready(${400000+n*10},${w})`};
 SELECT 'CLOSURE_CONTEXT:'||public.get_care_closure_context(pg_temp.cs(${w}),'${command}')::text;
 ${prepare?`SELECT 'CLOSURE_STATE:'||pg_temp.cl_prepare(${request(n)},${w},'${command}')::text;`:''} COMMIT;`);
}
async function readback(name,n,source=false) {
 const value=await capture(name+'-readback',prefix+` BEGIN; ${auth}
 SELECT 'CLOSURE_STATE:'||public.get_care_human_request(pg_temp.cs(${request(n)}))::text;
 SELECT 'CLOSURE_HISTORY:'||public.get_care_workflow_steps(pg_temp.cs(${work(n,source)}))::text; COMMIT;`);
 const state=decode(value,'CLOSURE_STATE');
 if(state.state==='applied') {
  const actual=await sql(`SELECT json_build_object('closed_at',w.closed_at,'event_recorded_at',e.recorded_at,'outcome',w.outcome_code)
   FROM public.work_items w JOIN public.care_workflow_closures c ON c.work_item_id=w.id JOIN public.care_human_events e ON e.id=c.human_event_id
   WHERE w.id='${guid(work(n,source))}'`);
  const projection=JSON.parse(actual);
  assert.equal(new Date(projection.closed_at).getTime(),new Date(projection.event_recorded_at).getTime());
  assert.equal(await sql(`SELECT w.closed_at=e.recorded_at FROM public.work_items w JOIN public.care_workflow_closures c ON c.work_item_id=w.id
   JOIN public.care_human_events e ON e.id=c.human_event_id WHERE w.id='${guid(work(n,source))}'`),'t');
  await writeFile(path.join(output,name+'-projection.json'),JSON.stringify(projection,null,2),{flag:'wx'});
 }
 return state;
}
let n=0;
n++; await setup(n);
const same=await race('same-request-replay',auth+write(n),auth+write(n));
assert.deepEqual(decode(same.first,'CLOSURE_STATE'),decode(same.second,'CLOSURE_STATE'));
await readback('same-request-replay',n);
n++; {
 const initial=await setup(n,{prepare:false}), context=decode(initial,'CLOSURE_CONTEXT');
 const raw=await capture('competing-payload',prefix+` BEGIN; ${auth} SELECT 'PAYLOAD:'||pg_temp.cl_payload(${quote(context)})::text; COMMIT;`);
 const payload=decode(raw,'PAYLOAD');
 const prepare=(id)=>` SELECT pg_temp.cl_from(${id},${quote(context)},${quote(payload)});`;
 await race('different-request-closure',auth+prepare(request(n))+write(n),auth+prepare(request(n)+1000),'42501');
 assert.equal(await sql(`SELECT count(*) FROM public.care_human_requests WHERE id='${guid(request(n)+1000)}'`),'0');
 await readback('different-request-closure',n);
}
for(const mode of ['current-source','historical-source','processing']) for(const closureFirst of [true,false]) {
 n++; await setup(n,{source:true,removed:mode==='historical-source'});
 let change;
 if(mode==='processing') {
  const head=JSON.parse(await sql(`SELECT public.lab_observation_head_snapshot('${guid(30000+n)}')`));
  change=service+` SELECT * FROM public.process_lab_alert_event('${head.effective_lab_result_id}');`;
 } else change=auth+` SELECT pg_temp.csr_change(${n},2);`;
 const name=mode+'-'+(closureFirst?'closure-first':'change-first');
 await race(name,closureFirst?auth+write(n):change,closureFirst?change:auth+write(n),closureFirst?null:'40001');
 const state=await readback(name,n,true);
 assert.equal(state.state,closureFirst?'applied':'prepared');
 if(closureFirst&&mode==='current-source') {
  const result=await sql(`SELECT count(*) FROM public.care_lab_source_invalidations i JOIN public.care_lab_composition_entries e ON e.id=i.entry_id
   JOIN public.care_lab_composition_events c ON c.id=e.event_id WHERE c.work_item_id='${guid(work(n,true))}'
   AND NOT(${quote(state.payload.details.snapshot.known_invalidation_ids)} ? i.id::text)`);
  assert.equal(result,'1');
 }
}
for(const closureFirst of [true,false]) {
 n++; await setup(n); const name='transfer-'+(closureFirst?'closure-first':'transfer-first');
 const transfer=auth+` SELECT public.offer_work_item_transfer(pg_temp.cs(${work(n)}),pg_temp.cs(2));`;
 await race(name,closureFirst?auth+write(n):transfer,closureFirst?transfer:auth+write(n),closureFirst?'P0001':'42501');
 assert.equal((await readback(name,n)).state,closureFirst?'applied':'prepared');
}
n++; await setup(n);
await race('clinical-revocation-before-closure',`UPDATE public.member_authorizations SET revoked_at=clock_timestamp()
 WHERE capability='clinical_disposition' AND membership_id IN(SELECT id FROM public.organization_memberships WHERE user_id='${guid(1)}');`,auth+write(n),'42501');
await capture('restore-clinical','UPDATE public.member_authorizations SET revoked_at=NULL WHERE capability=\'clinical_disposition\';');
assert.equal((await readback('clinical-revocation-before-closure',n)).state,'prepared');
const marker=' PERFORM public.require_care_workflow_scope(item.organization_id,item.patient_id,public.care_human_requires_clinical(saved.command,saved.payload)); RETURN result;';
for(const capability of ['monitor','clinical_disposition']) {
 n++; await setup(n);
 const original=await sql("SELECT pg_get_functiondef('public.apply_care_human_request(uuid)'::regprocedure)");
 assert.equal(original.split(marker).length,2);
 await capture('install-pause-'+capability,original.replace(marker,' PERFORM pg_catalog.pg_advisory_xact_lock(740074);\n'+marker));
 try {
  const before=await capture('counts-before-'+capability,prefix+` SELECT pg_temp.cl_counts(${work(n)},${request(n)});`);
  await capture('expiry-'+capability,`UPDATE public.member_authorizations SET expires_at=clock_timestamp()+interval '2 seconds'
   WHERE capability='${capability}' AND membership_id IN(SELECT id FROM public.organization_memberships WHERE user_id='${guid(1)}');`);
  const value=await race('expiry-after-writes-'+capability,'SELECT pg_advisory_xact_lock(740074);',auth+write(n),'42501',2200);
  assert.ok(!value.second.includes('CLOSURE_STATE:'));
  const after=await capture('counts-after-'+capability,prefix+` SELECT pg_temp.cl_counts(${work(n)},${request(n)});`);
  assert.deepEqual(JSON.parse(after),JSON.parse(before));
 } finally {
  await capture('restore-function-'+capability,original);
  await capture('restore-expiry-'+capability,'UPDATE public.member_authorizations SET expires_at=NULL;');
 }
 await readback('expiry-after-writes-'+capability,n);
}
for(const isolation of ['REPEATABLE READ','SERIALIZABLE']) {
 let denied=false;
 try { await capture('isolation-'+isolation.replaceAll(' ','-'),prefix+` BEGIN ISOLATION LEVEL ${isolation}; ${auth}
 SELECT public.get_care_closure_context(pg_temp.cs(${work(n)}),'close_success'); COMMIT;`); }
 catch(error) { denied=/25001/.test(error.stderr??''); await writeFile(path.join(output,'isolation-'+isolation.replaceAll(' ','-')+'.stderr'),error.stderr??'',{flag:'wx'}); }
 assert.equal(denied,true); results.push({name:isolation,ok:true});
}
const sources={};
for(const file of ['supabase/migrations/00070_care_human_evidence.sql','supabase/migrations/00071_care_human_history.sql',
 'supabase/migrations/00072_care_exception_resolution.sql','supabase/migrations/00073_care_source_resolution.sql',
 'supabase/migrations/00074_care_workflow_closure.sql','supabase/tests/care_workflow_closure.sql','scripts/test-care-workflow-closure.mjs']) {
 sources[file]=createHash('sha256').update(await readFile(file)).digest('hex');
}
await writeFile(path.join(output,'completion.json'),JSON.stringify({database,run_at:new Date().toISOString(),results,source_sha256:sources,all_ok:true},null,2),{flag:'wx'});
console.log('Closure races and isolation checks: PASS');
