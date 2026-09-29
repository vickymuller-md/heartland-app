/** Isolated synthetic PostgreSQL only: SOCKET PORT DATABASE NEW_OUTPUT. */
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
const run = promisify(execFile);
const [socket, port, database, output] = process.argv.slice(2);
assert.ok(socket?.startsWith('/private/tmp/hl-') && /^\d+$/.test(port ?? '')
  && /^n2p3z_postclosure_races_[a-z0-9_]+$/.test(database ?? '') && path.isAbsolute(output ?? ''));
const args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-h', socket, '-p', port, '-U', 'postgres', '-d', database];
const sql = async (statement) => (await run('/opt/homebrew/bin/psql', [...args, '-c', statement], { maxBuffer: 8 * 1024 * 1024 })).stdout.trim();
assert.equal(await sql('SHOW listen_addresses'), ''); assert.equal(await sql('SELECT count(*) FROM auth.users'), '0');
await mkdir(output);
const suite = await readFile('supabase/tests/care_postclosure_routing.sql', 'utf8');
const extract = (name) => suite.match(new RegExp('-- BEGIN '+name+'\\n([\\s\\S]*?)-- END '+name))[1];
const fixtures = extract('POSTCLOSURE FIXTURES');
const helper = fixtures.match(/CREATE FUNCTION pg_temp\.cs\([\s\S]*?\$\$;/)[0];
const prefix = `SET search_path=public,extensions; SET timezone='UTC'; ${helper} ${extract('POSTCLOSURE SHARED HELPERS')} ${extract('POSTCLOSURE HELPERS')}\n`;
const auth = (actor=1) => `SET LOCAL ROLE authenticated; SELECT pg_temp.csr_actor(${actor});`;
async function capture(name, statement) {
  await writeFile(path.join(output, name + '.sql'), statement, { flag: 'wx' });
  try { const result = await sql(statement); await writeFile(path.join(output, name + '.stdout'), result, { flag: 'wx' }); return result; }
  catch(error) { await writeFile(path.join(output,name+'.error'),error.stderr??String(error),{flag:'wx'}); throw error; }
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

const guid=(n)=>'60000000-0000-4000-8000-'+String(n).padStart(12,'0');
const decode=(value,tag)=>JSON.parse(value.match(new RegExp('^'+tag+':(.*)$','m'))[1]);
const quote=(value)=>"'"+JSON.stringify(value).replaceAll("'","''")+"'::jsonb";
const work=(n)=>80000+n, request=(n)=>90000+n;
const write=(n)=>`SELECT 'ROUTING_STATE:'||public.apply_care_postclosure_request(pg_temp.cs(${request(n)}))::text;`;
async function setup(n,prepare=true,short=false) {
 const helpers=short?prefix.replaceAll("now()+interval '1 day'","clock_timestamp()+interval '4 seconds'"):prefix;
 return capture('setup-'+n,helpers+` BEGIN; ${auth()} SELECT pg_temp.pc_setup(${n});
 SELECT 'ROUTING_CONTEXT:'||public.get_care_postclosure_context(pg_temp.pc_target(${n}),pg_temp.cs(${work(n)}))::text;
 ${prepare?`SELECT 'ROUTING_STATE:'||pg_temp.pc_prepare(${request(n)},${n})::text;`:''} COMMIT;`);
}
async function readback(name,n) {
 return decode(await capture(name+'-readback',prefix+` BEGIN; ${auth()}
 SELECT 'ROUTING_STATE:'||public.get_care_postclosure_request(pg_temp.cs(${request(n)}))::text; COMMIT;`),'ROUTING_STATE');
}
const transfer=(n)=>auth()+` SELECT public.offer_work_item_transfer(pg_temp.cs(${work(n)}),pg_temp.cs(2));
 SELECT pg_temp.csr_actor(2); SELECT public.accept_work_item_transfer(pg_temp.cs(${work(n)}));`;
let n=0;
const marker=' PERFORM public.require_care_workflow_scope(q.organization_id,q.patient_id,true); RETURN result;';
async function expiry(kind,red=false) {
 n++; await setup(n,true,kind==='deadline');
 const original=await sql("SELECT pg_get_functiondef('public.apply_care_postclosure_request(uuid)'::regprocedure)");
 assert.equal(original.split(marker).length,2);
 // Pause after persisted receipt but before any final recheck. Test function restored in finally.
 // A final successor validation may have been added; anchor the actual UPDATE instead.
 const update=" UPDATE public.care_postclosure_requests SET state='applied',applied_at=clock_timestamp(),receipt=v_receipt WHERE id=q.id;";
 assert.equal(original.split(update).length,2);
 await capture('install-pause-'+kind,original.replace(update,update+'\n PERFORM pg_catalog.pg_advisory_xact_lock(760076);'));
 try {
  if(kind!=='deadline') await capture('expiry-'+kind,`UPDATE public.member_authorizations SET expires_at=clock_timestamp()+interval '2 seconds'
   WHERE capability='${kind}' AND membership_id IN(SELECT id FROM public.organization_memberships WHERE user_id='${guid(1)}');`);
  const before=await capture('before-'+kind,prefix+` SELECT pg_temp.pc_fingerprint(${n});`);
  const pair=await race('expiry-after-writes-'+kind,'SELECT pg_advisory_xact_lock(760076);',auth()+write(n),
   red?null:kind==='deadline'?'40001':'42501',kind==='deadline'?4200:2200);
  const after=await capture('after-'+kind,prefix+` SELECT pg_temp.pc_fingerprint(${n});`);
  if(red) { assert.equal(decode(pair.second,'ROUTING_STATE').state,'applied'); assert.notDeepEqual(JSON.parse(after),JSON.parse(before)); }
  else assert.deepEqual(JSON.parse(after),JSON.parse(before));
 } finally {
  await capture('restore-function-'+kind,original);
  if(kind!=='deadline') await capture('restore-expiry-'+kind,'UPDATE public.member_authorizations SET expires_at=NULL;');
 }
 assert.equal((await readback('expiry-'+kind,n)).state,red?'applied':'prepared');
}
if(process.env.HEARTLAND_POSTCLOSURE_DEADLINE_RED==='1') {
 await expiry('deadline',true);
 await writeFile(path.join(output,'red-finding.json'),JSON.stringify({finding:'deadline expired after writes but delegation committed',results},null,2),{flag:'wx'});
 console.log('RED finding reproduced: expired deadline committed'); process.exit(0);
}
await expiry('deadline');
for(const capability of ['monitor','clinical_disposition']) await expiry(capability);
// Preparation must not freeze an already-expired candidate after its INSERT either.
n++; {
 const raw=await setup(n,false,true), context=decode(raw,'ROUTING_CONTEXT');
 const payload=decode(await capture('prepare-expiry-payload',prefix+` SELECT 'PAYLOAD:'||pg_temp.pc_payload(${quote(context)})::text;`),'PAYLOAD');
 const signature='public.prepare_care_postclosure_request(uuid,uuid,uuid,uuid,uuid,bigint,bigint,bigint,uuid,jsonb)';
 const original=await sql(`SELECT pg_get_functiondef('${signature}'::regprocedure)`);
 const insertMarker='  result:=public.care_postclosure_request_state(p_request_id);';
 assert.equal(original.split(insertMarker).length,2);
 await capture('install-prepare-pause',original.replace(insertMarker,insertMarker+'\n  PERFORM pg_catalog.pg_advisory_xact_lock(760076);'));
 try {
  const before=await capture('before-prepare-expiry',prefix+` SELECT pg_temp.pc_fingerprint(${n});`);
  await race('deadline-after-prepare-insert','SELECT pg_advisory_xact_lock(760076);',
   auth()+` SELECT pg_temp.pc_from(${request(n)},${quote(context)},${quote(payload)});`,'40001',4200);
  assert.deepEqual(JSON.parse(await capture('after-prepare-expiry',prefix+` SELECT pg_temp.pc_fingerprint(${n});`)),JSON.parse(before));
 } finally { await capture('restore-prepare-function',original); }
}
// A detail grant expiring after materialization must not leak the already-collected rows.
n++; await setup(n,false);
{
 const original=await sql("SELECT pg_get_functiondef('public.list_care_postclosure_needs(uuid,uuid)'::regprocedure)");
 const readMarker=" FOR row IN SELECT value FROM jsonb_array_elements(result->'items') LOOP";
 assert.equal(original.split(readMarker).length,2);
 await capture('install-reader-pause',original.replace(readMarker," PERFORM pg_catalog.pg_advisory_xact_lock(760076);\n"+readMarker));
 try {
  await capture('reader-monitor-expiry',`UPDATE public.member_authorizations SET expires_at=clock_timestamp()+interval '2 seconds'
   WHERE capability='monitor' AND membership_id IN(SELECT id FROM public.organization_memberships WHERE user_id='${guid(1)}');`);
  await race('reader-expiry-after-materialization','SELECT pg_advisory_xact_lock(760076);',
   auth()+" SELECT public.list_care_postclosure_needs(pg_temp.cs(90));",'42501',2200);
 } finally {
  await capture('restore-reader-function',original);
  await capture('restore-reader-grants','UPDATE public.member_authorizations SET expires_at=NULL;');
 }
}
n++; await setup(n);
const same=await race('same-request-replay',auth()+write(n),auth()+write(n));
assert.deepEqual(decode(same.first,'ROUTING_STATE'),decode(same.second,'ROUTING_STATE'));
await readback('same-request',n);
for(const routeFirst of [true,false]) {
 n++; await setup(n);
 const name='transfer-'+(routeFirst?'routing-first':'transfer-first');
 await race(name,routeFirst?auth()+write(n):transfer(n),routeFirst?transfer(n):auth()+write(n),routeFirst?null:'42501');
 assert.equal((await readback(name,n)).state,routeFirst?'applied':'prepared');
}
for(const routeFirst of [true,false]) {
 n++; const raw=await setup(n,routeFirst);
 const context=decode(raw,'ROUTING_CONTEXT');
 const payload=decode(await capture('closure-frozen-payload-'+n,prefix+` SELECT 'PAYLOAD:'||pg_temp.pc_payload(${quote(context)})::text;`),'PAYLOAD');
 const prepare=auth()+` SELECT pg_temp.pc_from(${request(n)},${quote(context)},${quote(payload)});`;
 const close=auth()+` SELECT pg_temp.cl_apply(${650000+n},${work(n)});`;
 const name='closure-'+(routeFirst?'routing-first':'closure-first');
 await race(name,routeFirst?auth()+write(n):close,routeFirst?close:prepare,routeFirst?null:'42501');
 if(routeFirst) {
  assert.equal((await readback(name,n)).state,'applied');
  const needs=decode(await capture(name+'-needs',prefix+` BEGIN; ${auth()} SELECT 'ROUTING_NEEDS:'||public.list_care_postclosure_needs(pg_temp.cs(90))::text; COMMIT;`),'ROUTING_NEEDS');
  assert.equal(needs.items.find(row=>row.invalidation_id===context.snapshot.invalidation_id).routing_state,'successor_closed');
 }
}
await capture('grant-second-clinical',`INSERT INTO public.member_authorizations(membership_id,capability,granted_by)
 SELECT id,'clinical_disposition',created_by FROM public.organization_memberships WHERE user_id='${guid(2)}';`);
for(const replacement of [false,true]) {
 n++; await setup(n,replacement);
 if(replacement) await capture('initial-route-'+n,prefix+` BEGIN; ${auth()} ${write(n)} COMMIT;`);
 const firstWork=replacement?84000+n:work(n), secondWork=85000+n;
 const firstRequest=replacement?94000+n:request(n), secondRequest=95000+n;
 await capture('competing-prepare-'+n,prefix+` BEGIN; ${auth()}
 ${replacement?`SELECT pg_temp.cs_new(${firstWork});`:''}
 SELECT pg_temp.pc_prepare(${firstRequest},${n},${firstWork});
 SELECT pg_temp.csr_actor(2); SELECT pg_temp.cs_new(${secondWork}); SELECT pg_temp.pc_prepare(${secondRequest},${n},${secondWork}); COMMIT;`);
 const name=replacement?'competing-replacements':'competing-initial-routes';
 await race(name,auth()+` SELECT public.apply_care_postclosure_request(pg_temp.cs(${firstRequest}));`,
 auth(2)+` SELECT public.apply_care_postclosure_request(pg_temp.cs(${secondRequest}));`,'40001');
 const history=decode(await capture(name+'-history',prefix+` BEGIN; ${auth()} SELECT 'ROUTING_HISTORY:'||public.list_care_postclosure_history(pg_temp.pc_target(${n}))::text; COMMIT;`),'ROUTING_HISTORY');
 assert.equal(history.items.length,replacement?2:1);
}
n++; {
 const raw=await setup(n,false), context=decode(raw,'ROUTING_CONTEXT');
 const payload=decode(await capture('same-target-frozen-payload',prefix+` SELECT 'PAYLOAD:'||pg_temp.pc_payload(${quote(context)})::text;`),'PAYLOAD');
 const prep=(id)=>auth()+` SELECT pg_temp.pc_from(${id},${quote(context)},${quote(payload)});`;
 await race('different-request-same-actor',prep(request(n)),prep(request(n)+1000),'23505');
 await readback('different-request',n);
}
// A new correction does not invalidate the immutable origin or cover the next need.
n++; await setup(n);
{
 const holder=session('source-independent-holder');
 try {
  holder.send(`${prefix} BEGIN; ${auth()} ${write(n)}\n\\echo HOLDING\n`);
  await until(()=>{ if(holder.state.ended) throw new Error(holder.state.stderr); return holder.state.stdout.includes('HOLDING'); },'source-independent holder');
  // The cross-organization immutable fan-out must NOT acquire a work lock held by routing.
  await capture('source-independent-change',prefix+` BEGIN; SET LOCAL statement_timeout='2s'; ${auth()} SELECT pg_temp.csr_change(${n},3); COMMIT;`);
  assert.equal(holder.state.ended,false);
  holder.send('COMMIT;\n',true); assert.equal(await holder.done,0,holder.state.stderr);
  results.push({name:'source-independent-fanout',nonblocking:true,ok:true});
 } finally { if(!holder.state.ended) holder.child.kill('SIGTERM'); await holder.done; await holder.persist(); }
}
const needs=decode(await capture('new-correction-needs',prefix+` BEGIN; ${auth()} SELECT 'ROUTING_NEEDS:'||public.list_care_postclosure_needs(pg_temp.cs(90))::text; COMMIT;`),'ROUTING_NEEDS');
assert.equal(needs.items.filter(row=>row.predecessor_work_item_id===guid(20000+n)).length,2);
for(const isolation of ['REPEATABLE READ','SERIALIZABLE']) {
 let denied=false; const name='isolation-'+isolation.replaceAll(' ','-');
 try { await capture(name,prefix+` BEGIN ISOLATION LEVEL ${isolation}; ${auth()} SELECT public.list_care_postclosure_needs(pg_temp.cs(90)); COMMIT;`); }
 catch(error) { assert.ok(error.stderr?.includes('25001')); denied=true; }
 assert.ok(denied); results.push({name,expected_sqlstate:'25001',ok:true});
}
const files=['supabase/migrations/00076_care_postclosure_routing.sql','supabase/tests/care_postclosure_routing.sql',
 'scripts/test-care-postclosure-routing.mjs','supabase/migrations/00074_care_workflow_closure.sql','supabase/migrations/00075_care_unsaved_intent_disposition.sql'];
const hashes=Object.fromEntries(await Promise.all(files.map(async file=>[file,createHash('sha256').update(await readFile(file)).digest('hex')])));
await writeFile(path.join(output,'completion.json'),JSON.stringify({database,run_at:new Date().toISOString(),results,hashes,all_ok:true},null,2),{flag:'wx'});
console.log('Routing concurrency complete: '+results.length+' cases');
