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
  && /^n2p3z_source_races_[a-z0-9_]+$/.test(database ?? '') && path.isAbsolute(output ?? ''));
const args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-h', socket, '-p', port, '-U', 'postgres', '-d', database];
const sql = async (statement) => (await run('/opt/homebrew/bin/psql', [...args, '-c', statement], { maxBuffer: 8 * 1024 * 1024 })).stdout.trim();
assert.equal(await sql('SHOW listen_addresses'), ''); assert.equal(await sql('SELECT count(*) FROM auth.users'), '0');
await mkdir(output);
const source = await readFile('supabase/tests/care_human_evidence.sql', 'utf8');
const fixtures = source.match(/-- BEGIN HUMAN FIXTURES\n([\s\S]*?)-- END HUMAN FIXTURES/)[1];
const helper = fixtures.match(/CREATE FUNCTION pg_temp\.cs\([\s\S]*?\$\$;/)[0];
const helpers = source.match(/-- BEGIN HUMAN HELPERS\n([\s\S]*?)-- END HUMAN HELPERS/)[1];
const human = source.match(/-- BEGIN HUMAN COMMAND HELPERS\n([\s\S]*?)-- END HUMAN COMMAND HELPERS/)[1];
const sourceSuite = await readFile('supabase/tests/care_source_resolution.sql', 'utf8');
const sourceHelpers = sourceSuite.match(/-- BEGIN SOURCE RESOLUTION HELPERS\n([\s\S]*?)-- END SOURCE RESOLUTION HELPERS/)[1];
const labFixtures = sourceSuite.match(/-- BEGIN SOURCE LAB FIXTURES\n([\s\S]*?)-- END SOURCE LAB FIXTURES/)[1];
const prefix = `SET search_path=public,extensions; SET timezone='UTC'; ${helper} ${helpers} ${human} ${sourceHelpers}\n`;
const auth = `SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.cs(1),'aal','aal2')::text,true);`;
const authority = auth.replace('pg_temp.cs(1)', 'pg_temp.cs(3)');
const service = `SET LOCAL ROLE service_role; SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);`;
async function capture(name, statement) {
  await writeFile(path.join(output, name + '.sql'), statement, { flag: 'wx' });
  const result = await sql(statement); await writeFile(path.join(output, name + '.stdout'), result, { flag: 'wx' }); return result;
}
await capture('fixtures', `BEGIN; ${fixtures} ${labFixtures} COMMIT;`);
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
const write = (n) => "SELECT 'SOURCE_STATE:'||public.apply_care_human_request(pg_temp.cs("+ (62000+n) +"))::text;";
const readHistory = (n) => "SELECT 'SOURCE_HISTORY:'||public.get_care_workflow_steps(pg_temp.cs("+ (20000+n) +"))::text;";
const decode = (value, tag) => JSON.parse(value.match(new RegExp('^'+tag+':(.*)$','m'))[1]);
async function setup(n, removed = false, prepare = true) {
 return capture('setup-'+n, prefix+" BEGIN; "+auth+" SELECT pg_temp.csr_setup("+n+","+removed+"); SELECT pg_temp.csr_humans("+n+");"
  +" SELECT 'SOURCE_CONTEXT:'||pg_temp.csr_context("+n+")::text;"
  +(prepare ? " SELECT 'SOURCE_STATE:'||pg_temp.csr_prepare("+(62000+n)+","+n+")::text;" : '')+" COMMIT;");
}
async function readback(name,n) {
 return capture(name+'-readback',prefix+" BEGIN; "+auth
  +" SELECT 'SOURCE_STATE:'||public.get_care_human_request(pg_temp.cs("+(62000+n)+"))::text; "+readHistory(n)
  +" SELECT 'SOURCE_INVALIDATIONS:'||public.list_care_lab_invalidations(pg_temp.cs("+(20000+n)+"))::text; COMMIT;");
}
let n=0;
for(const mode of ['historical-source','current-source','processing']) for(const resolutionFirst of [true,false]) {
 n++; await setup(n,mode==='historical-source');
 let change;
 if(mode==='processing') {
  const head=JSON.parse(await sql("SELECT public.lab_observation_head_snapshot('"+guid(30000+n)+"')"));
  change=service+" SELECT * FROM public.process_lab_alert_event('"+head.effective_lab_result_id+"');";
 } else change=auth+" SELECT pg_temp.csr_change("+n+",2);";
 const name=mode+'-'+(resolutionFirst?'resolution-first':'change-first'), humanWrite=auth+write(n);
 await race(name,resolutionFirst?humanWrite:change,resolutionFirst?change:humanWrite,resolutionFirst?null:'40001');
 const value=await readback(name,n), state=decode(value,'SOURCE_STATE'), history=decode(value,'SOURCE_HISTORY'), list=decode(value,'SOURCE_INVALIDATIONS');
 assert.equal(state.state,resolutionFirst?'applied':'prepared');
 assert.equal(history.humans.length,resolutionFirst?3:2);
 assert.equal(list.items.filter(x=>x.resolution!==null).length,resolutionFirst?1:0);
 if(mode==='historical-source') assert.equal(list.items.length,1);
 if(mode==='current-source') assert.equal(list.items.length,2);
}
// Fresh preparation and a different-root replacement must serialize before work.
for(const prepareFirst of [true,false]) {
 n++; const initial=await setup(n,false,false), context=decode(initial,'SOURCE_CONTEXT');
 await capture('replacement-root-'+n,prefix+" BEGIN; "+authority+" SELECT pg_temp.cc_register("+(35000+n)+",pg_temp.cs("+(45000+n)+"),'potassium',91); COMMIT;");
 const payload=JSON.parse(await sql(prefix+" BEGIN; "+auth+" SELECT pg_temp.csr_payload('"+JSON.stringify(context)+"'::jsonb); COMMIT;").then(v=>v.split('\n').filter(x=>x.startsWith('{')).at(-1)));
 const prepare=auth+" SELECT 'SOURCE_STATE:'||pg_temp.csr_from_context("+(62000+n)+",'"+JSON.stringify(context)+"'::jsonb,'"+JSON.stringify(payload)+"'::jsonb)::text;";
 const replace=auth+" SELECT pg_temp.cc_apply("+(51000+n)+","+(20000+n)+",pg_temp.cc_mapping("+(35000+n)+"));";
 await race('replacement-prepare-'+prepareFirst,prepareFirst?prepare:replace,prepareFirst?replace:prepare,prepareFirst?'23505':'40001');
}
n++; await setup(n,true);
const replay=await race('same-request-replay',auth+write(n),auth+write(n));
assert.deepEqual(decode(replay.first,'SOURCE_STATE'),decode(replay.second,'SOURCE_STATE')); await readback('same-request-replay',n);
n++; {
 const initial=await setup(n,true,false),context=decode(initial,'SOURCE_CONTEXT');
 const p=await capture('competing-payload',prefix+" BEGIN; "+auth+" SELECT 'PAYLOAD:'||pg_temp.csr_payload('"+JSON.stringify(context)+"'::jsonb)::text; COMMIT;");
 const payload=decode(p,'PAYLOAD');
 const prepare=(request)=>" SELECT pg_temp.csr_from_context("+request+",'"+JSON.stringify(context)+"'::jsonb,'"+JSON.stringify(payload)+"'::jsonb);";
 await race('same-target-competing-requests',auth+prepare(62000+n)+write(n),auth+prepare(63000+n),'40001');
 await readback('same-target-competing-requests',n);
 assert.equal(await sql("SELECT count(*) FROM public.care_human_requests WHERE id='"+guid(63000+n)+"'"),'0');
}
for(const readFirst of [true,false]) {
 n++; await setup(n,true);
 const value=await race('history-resolution-'+readFirst,auth+(readFirst?readHistory(n):write(n)),auth+(readFirst?write(n):readHistory(n)));
 assert.equal(decode(readFirst?value.first:value.second,'SOURCE_HISTORY').humans.length,readFirst?2:3);
 await readback('history-resolution-'+readFirst,n);
}
for(const transferFirst of [true,false]) {
 n++; await setup(n,true);
 const transfer=auth+" SELECT public.offer_work_item_transfer(pg_temp.cs("+(20000+n)+"),pg_temp.cs(2));", apply=auth+write(n);
 await race('transfer-resolution-'+transferFirst,transferFirst?transfer:apply,transferFirst?apply:transfer,transferFirst?'42501':null);
 await readback('transfer-resolution-'+transferFirst,n);
}
n++; await setup(n,true);
await race('clinical-revocation-before-resolution',"UPDATE public.member_authorizations SET revoked_at=clock_timestamp() WHERE capability='clinical_disposition'"
 +" AND membership_id IN(SELECT id FROM public.organization_memberships WHERE user_id='"+guid(1)+"');",auth+write(n),'42501');
await capture('restore-clinical',"UPDATE public.member_authorizations SET revoked_at=NULL WHERE capability='clinical_disposition';");
await readback('clinical-revocation-before-resolution',n);
const marker=' PERFORM public.require_care_workflow_scope(item.organization_id,item.patient_id,public.care_human_requires_clinical(saved.command,saved.payload)); RETURN result;';
for(const capability of ['monitor','clinical_disposition']) {
 n++; await setup(n,true);
 const original=await sql("SELECT pg_get_functiondef('public.apply_care_human_request(uuid)'::regprocedure)");
 assert.equal(original.split(marker).length,2);
 await capture('install-pause-'+capability,original.replace(marker,' PERFORM pg_catalog.pg_advisory_xact_lock(730073);\n'+marker));
 try {
  const before=await capture('counts-before-'+capability,prefix+" SELECT pg_temp.csr_counts("+n+","+(62000+n)+");");
  await capture('expiry-'+capability,"UPDATE public.member_authorizations SET expires_at=clock_timestamp()+interval '2 seconds' WHERE capability='"+capability+"'"
   +" AND membership_id IN(SELECT id FROM public.organization_memberships WHERE user_id='"+guid(1)+"');");
  const value=await race('expiry-after-writes-'+capability,'SELECT pg_advisory_xact_lock(730073);',auth+write(n),'42501',2200);
  assert.ok(!value.second.includes('SOURCE_STATE:'));
  const after=await capture('counts-after-'+capability,prefix+" SELECT pg_temp.csr_counts("+n+","+(62000+n)+");");
  assert.deepEqual(JSON.parse(after),JSON.parse(before));
 } finally {
  await capture('restore-function-'+capability,original);
  await capture('restore-expiry-'+capability,'UPDATE public.member_authorizations SET expires_at=NULL;');
 }
 await readback('expiry-after-writes-'+capability,n);
}
// Immutable human history must not start rereading removed roots.
n++; await setup(n,true); await capture('history-independent-apply',prefix+' BEGIN; '+auth+write(n)+' COMMIT;');
{
 const a=session('removed-history-independent-a'),b=session('removed-history-independent-b');
 try {
  a.send(prefix+" SELECT 'PID:'||pg_backend_pid(); BEGIN; "+auth+readHistory(n)+"\n\\echo HOLDING\n");
  await until(()=>{if(a.state.ended)throw new Error(a.state.stderr);return a.state.stdout.includes('HOLDING');},'history-independent');
  b.send(prefix+" BEGIN; "+auth+" SELECT pg_temp.csr_change("+n+",2); COMMIT;\n",true);
  assert.equal(await b.done,0,b.state.stderr); assert.equal(a.state.ended,false);
  a.send('COMMIT;\n',true); assert.equal(await a.done,0);
  const after=await capture('removed-history-independent-readback',prefix+' BEGIN; '+auth+readHistory(n)+' COMMIT;');
  assert.deepEqual(decode(after,'SOURCE_HISTORY'),decode(a.state.stdout,'SOURCE_HISTORY'));
 } finally {
  if(!a.state.ended)a.child.kill('SIGTERM'); if(!b.state.ended)b.child.kill('SIGTERM');
  await Promise.all([a.done,b.done]);await Promise.all([a.persist(),b.persist()]);
 }
}
for(const isolation of ['REPEATABLE READ','SERIALIZABLE']) {
 const s=session('isolation-'+isolation.replace(' ','-'));
 try {
  s.send(prefix+' BEGIN ISOLATION LEVEL '+isolation+'; '+auth+' SELECT pg_temp.csr_context(6); COMMIT;\n',true);
  assert.equal(await s.done,3); assert.ok(s.state.stderr.includes('25001'));
 } finally {await s.persist();}
}
const hashes={};
for(const file of ['supabase/migrations/00070_care_human_evidence.sql','supabase/migrations/00071_care_human_history.sql',
 'supabase/migrations/00072_care_exception_resolution.sql','supabase/migrations/00073_care_source_resolution.sql',
 'supabase/tests/care_human_evidence.sql','supabase/tests/care_source_resolution.sql','scripts/test-care-source-resolution.mjs']) {
 hashes[file]=createHash('sha256').update(await readFile(file)).digest('hex');
}
await writeFile(path.join(output,'completion.json'),JSON.stringify({database,completed_at:new Date().toISOString(),results,
 actual_blocking_cases:results.length,removed_history_independence_cases:1,isolation_denials:2,hashes,all_ok:true},null,2),{flag:'wx'});
console.log('Exact changed-source resolution concurrency: PASS');
