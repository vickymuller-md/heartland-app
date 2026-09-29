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
  && /^n2p3z_unsaved_races_[a-z0-9_]+$/.test(database ?? '') && path.isAbsolute(output ?? ''));
const args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-h', socket, '-p', port, '-U', 'postgres', '-d', database];
const sql = async (statement) => (await run('/opt/homebrew/bin/psql', [...args, '-c', statement], { maxBuffer: 8 * 1024 * 1024 })).stdout.trim();
assert.equal(await sql('SHOW listen_addresses'), ''); assert.equal(await sql('SELECT count(*) FROM auth.users'), '0');
await mkdir(output);
const suite = await readFile('supabase/tests/care_unsaved_intent_disposition.sql', 'utf8');
const extract = (name) => suite.match(new RegExp('-- BEGIN '+name+'\\n([\\s\\S]*?)-- END '+name))[1];
const fixtures = extract('UNSAVED FIXTURES');
const helper = fixtures.match(/CREATE FUNCTION pg_temp\.ui\([\s\S]*?\$\$;/)[0];
const prefix = `SET search_path=public,extensions; SET timezone='UTC'; ${helper} ${extract('UNSAVED HELPERS')}
 INSERT INTO unsaved_attempts SELECT right(work_item_id::text,12)::integer,submission_request_id
 FROM public.lab_followup_submission_intents WHERE actor_id='75000000-0000-4000-8000-000000000001';\n`;
const auth = (actor=2) => `SET LOCAL ROLE authenticated; SELECT pg_temp.ua(${actor});`;
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


const guid=(n)=>'75000000-0000-4000-8000-'+String(n).padStart(12,'0');
const decode=(value,tag)=>JSON.parse(value.match(new RegExp('^'+tag+':(.*)$','m'))[1]);
const quote=(value)=>"'"+JSON.stringify(value).replaceAll("'","''")+"'::jsonb";
const work=(n)=>400+n, request=(n)=>6000+n;
const write=(n)=>`SELECT 'UNSAVED_STATE:'||public.apply_care_unsaved_intent_request(pg_temp.ui(${request(n)}))::text;`;
async function setup(n,prepare=true) {
 return capture('setup-'+n,prefix+` BEGIN; ${auth()} SELECT pg_temp.unew(${work(n)});
 SELECT 'UNSAVED_CONTEXT:'||public.get_care_unsaved_intent_context(pg_temp.ui(${work(n)}),pg_temp.ui(${work(n)+2000}))::text;
 ${prepare?`SELECT 'UNSAVED_STATE:'||pg_temp.uprepare(${request(n)},${work(n)})::text;`:''} COMMIT;`);
}
async function readback(name,n) {
 const raw=await capture(name+'-readback',prefix+` BEGIN; ${auth()}
 SELECT 'UNSAVED_STATE:'||public.get_care_unsaved_intent_request(pg_temp.ui(${request(n)}))::text; COMMIT;`);
 assert.equal(await sql('SELECT count(*) FROM public.care_unsaved_intent_context'),'0');
 return decode(raw,'UNSAVED_STATE');
}
async function cleanup(n) {
 await capture('cleanup-'+n,prefix+` BEGIN; ${auth(1)}
 DO $cleanup$ DECLARE state jsonb; BEGIN
  state:=public.cancel_lab_followup_intent(pg_temp.ui(${work(n)+2000}));
  IF state#>>'{submission,lab_result_id}' IS NOT NULL THEN
   PERFORM public.acknowledge_lab_submission(pg_temp.ui(11),(state->>'submission_request_id')::uuid,(state#>>'{submission,lab_result_id}')::uuid);
  END IF; END $cleanup$; COMMIT;`);
}
const transfer=(n)=>auth()+` SELECT public.offer_work_item_transfer(pg_temp.ui(${work(n)}),pg_temp.ui(1));
 SELECT pg_temp.ua(1); SELECT public.accept_work_item_transfer(pg_temp.ui(${work(n)}));`;
let n=0;
// Concrete reviewer finding: the non-manager old owner loses shared-history visibility while waiting.
for(const readerFirst of [false,true]) {
 n++; await setup(n); await capture('apply-before-reader-'+n,prefix+` BEGIN; ${auth()} ${write(n)} COMMIT;`);
 const read=auth()+` SELECT 'UNSAVED_HISTORY:'||public.list_care_unsaved_intent_history(pg_temp.ui(${work(n)}))::text;`;
 await race('shared-history-'+(readerFirst?'reader-first':'transfer-first'),readerFirst?read:transfer(n),readerFirst?transfer(n):read,readerFirst?null:'42501');
 const state=await readback('shared-history-'+n,n); assert.equal(state.state,'applied');
}
if(process.env.HEARTLAND_UNSAVED_READBACK_ONLY==='1') {
 await writeFile(path.join(output,'reviewer-readback.json'),JSON.stringify({results,all_ok:true},null,2),{flag:'wx'});
 console.log('Shared-history race regression: PASS'); process.exit(0);
}
n++; await setup(n);
const same=await race('same-request-replay',auth()+write(n),auth()+write(n));
assert.deepEqual(decode(same.first,'UNSAVED_STATE'),decode(same.second,'UNSAVED_STATE')); await readback('same-request',n);
for(const mode of ['save','cancel','transfer']) for(const disposalFirst of [true,false]) {
 n++; await setup(n);
 const competitor=mode==='save'?auth(1)+` SELECT pg_temp.usave(${work(n)});`
  :mode==='cancel'?auth(1)+` SELECT public.cancel_lab_submission(pg_temp.ui(11),(SELECT submission FROM unsaved_attempts WHERE work=${work(n)}));`:transfer(n);
 const name=mode+'-'+(disposalFirst?'disposal-first':'other-first');
 await race(name,disposalFirst?auth()+write(n):competitor,disposalFirst?competitor:auth()+write(n),
  disposalFirst?(mode==='save'?'23505':null):(mode==='transfer'?'42501':'40001'));
 assert.equal((await readback(name,n)).state,disposalFirst?'applied':'prepared');
 await cleanup(n);
}
n++; {
 const raw=await setup(n,false), context=decode(raw,'UNSAVED_CONTEXT');
 const payload=decode(await capture('frozen-competing-payload',prefix+` SELECT 'PAYLOAD:'||pg_temp.upayload(${quote(context)})::text;`),'PAYLOAD');
 const prep=(id)=>auth()+` SELECT public.prepare_care_unsaved_intent_request(pg_temp.ui(${id}),pg_temp.ui(${work(n)}),pg_temp.ui(${work(n)+2000}),
 pg_temp.ui(90),pg_temp.ui(11),${context.workflow_revision},${context.ownership_revision},${quote(payload)});`;
 await race('different-request-preparation',prep(request(n)),prep(request(n)+1000),'23505');
 assert.equal((await readback('different-request',n)).state,'prepared'); await cleanup(n);
}
for(const disposalFirst of [true,false]) {
 n++; await setup(n);
 const closureRead=auth()+` SELECT 'CLOSURE_CONTEXT:'||public.get_care_closure_context(pg_temp.ui(${work(n)}),'close_without_completion')::text;`;
 const name='closure-snapshot-'+(disposalFirst?'disposal-first':'reader-first');
 const raw=await race(name,disposalFirst?auth()+write(n):closureRead,disposalFirst?closureRead:auth()+write(n));
 assert.equal(decode(disposalFirst?raw.second:raw.first,'CLOSURE_CONTEXT').snapshot.prepared_intents.length,disposalFirst?0:1);
 await readback(name,n);
}
const marker=' PERFORM public.require_care_workflow_scope(q.organization_id,q.patient_id,true); RETURN result;';
for(const capability of ['monitor','clinical_disposition']) {
 n++; await setup(n);
 const original=await sql("SELECT pg_get_functiondef('public.apply_care_unsaved_intent_request(uuid)'::regprocedure)");
 assert.equal(original.split(marker).length,2);
 await capture('install-pause-'+capability,original.replace(marker,' PERFORM pg_catalog.pg_advisory_xact_lock(750075);\n'+marker));
 try {
  const before=await capture('before-'+capability,prefix+` SELECT pg_temp.ufingerprint(${work(n)},${request(n)});`);
  await capture('expiry-'+capability,`UPDATE public.member_authorizations SET expires_at=clock_timestamp()+interval '2 seconds'
   WHERE capability='${capability}' AND membership_id IN(SELECT id FROM public.organization_memberships WHERE user_id='${guid(2)}');`);
  await race('expiry-after-writes-'+capability,'SELECT pg_advisory_xact_lock(750075);',auth()+write(n),'42501',2200);
  const after=await capture('after-'+capability,prefix+` SELECT pg_temp.ufingerprint(${work(n)},${request(n)});`);
  assert.deepEqual(JSON.parse(after),JSON.parse(before));
 } finally {
  await capture('restore-function-'+capability,original); await capture('restore-expiry-'+capability,'UPDATE public.member_authorizations SET expires_at=NULL;');
 }
 assert.equal((await readback('expiry-'+capability,n)).state,'prepared'); await cleanup(n);
}
for(const isolation of ['REPEATABLE READ','SERIALIZABLE']) {
 let denied=false; const name='isolation-'+isolation.replaceAll(' ','-');
 try { await capture(name,prefix+` BEGIN ISOLATION LEVEL ${isolation}; ${auth()} SELECT public.get_care_unsaved_intent_request(pg_temp.ui(${request(n)})); COMMIT;`); }
 catch(error) { denied=/25001/.test(error.stderr??''); await writeFile(path.join(output,name+'.stderr'),error.stderr??'',{flag:'wx'}); }
 assert.equal(denied,true); results.push({name:isolation,ok:true});
}
const source_sha256={};
for(const file of ['supabase/migrations/00038_lab_submission_recovery.sql','supabase/migrations/00039_lab_provenance_erasure.sql',
 'supabase/migrations/00067_lab_followup_submission_intents.sql','supabase/migrations/00068_care_lab_compositions.sql',
 'supabase/migrations/00074_care_workflow_closure.sql','supabase/migrations/00075_care_unsaved_intent_disposition.sql',
 'supabase/tests/care_unsaved_intent_disposition.sql','scripts/test-care-unsaved-intent.mjs']) source_sha256[file]=createHash('sha256').update(await readFile(file)).digest('hex');
await writeFile(path.join(output,'completion.json'),JSON.stringify({database,run_at:new Date().toISOString(),results,source_sha256,all_ok:true},null,2),{flag:'wx'});
console.log('Unsaved disposition races and isolation: PASS');
