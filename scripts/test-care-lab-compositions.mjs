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
  && /^n2p3x_composition_races_[a-z0-9_]+$/.test(database ?? '') && path.isAbsolute(output ?? ''));
const args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-h', socket, '-p', port, '-U', 'postgres', '-d', database];
const sql = async (statement) => (await run('/opt/homebrew/bin/psql', [...args, '-c', statement], { maxBuffer: 8 * 1024 * 1024 })).stdout.trim();
assert.equal(await sql('SHOW listen_addresses'), ''); assert.equal(await sql('SELECT count(*) FROM auth.users'), '0');
await mkdir(output);
const source = await readFile('supabase/tests/care_lab_compositions.sql', 'utf8');
const fixtures = source.match(/-- BEGIN COMPOSITION FIXTURES\n([\s\S]*?)-- END COMPOSITION FIXTURES/)[1];
const helper = fixtures.match(/CREATE FUNCTION pg_temp\.cs\([\s\S]*?\$\$;/)[0];
const helpers = source.match(/-- BEGIN COMPOSITION HELPERS\n([\s\S]*?)-- END COMPOSITION HELPERS/)[1];
const prefix = `SET search_path=public,extensions; SET timezone='UTC'; ${helper} ${helpers}\n`;
const auth = (actor = 1) => `SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.cs(${actor}),'aal','aal2')::text,true);`;
const service = `SET LOCAL ROLE service_role; SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);`;
const reset = `UPDATE public.provider_patient_links SET status='active'; UPDATE public.member_authorizations SET expires_at=NULL,revoked_at=NULL;`;
const map = (n) => `pg_temp.cc_mapping(${10000 + n})`;
const apply = (n) => `SELECT public.apply_care_lab_composition(pg_temp.cs(${40000 + n}));`;
const change = (n) => `SELECT pg_temp.cc_change(${50000 + n},${10000 + n});`;
const offer = (n) => `SELECT public.offer_work_item_transfer(pg_temp.cs(${20000 + n}),pg_temp.cs(2));`;
const evaluate = (n) => `SELECT * FROM public.process_lab_alert_event(pg_temp.cs(${5000 + n}));`;
const detail = (n) => `SELECT 'DETAIL:'||public.get_care_lab_composition(pg_temp.cs(${20000 + n}))::text;`;
const prepare = (n) => `SELECT pg_temp.cc_prepare(${40000 + n},${20000 + n},${map(n)});`;
const prepareStep = (n) => `SELECT pg_temp.cs_prepare(${60000 + n},${20000 + n},'record_collection');`;
const prepareIntent = (n) => `DO $intent$ DECLARE submission uuid; flow jsonb; BEGIN
 SELECT request_id INTO submission FROM public.prepare_lab_submission(pg_temp.cs(11));
 flow:=public.get_care_workflow(pg_temp.cs(${20000 + n}));
 PERFORM public.prepare_lab_followup_intent(pg_temp.cs(${70000 + n}),pg_temp.cs(${20000 + n}),pg_temp.cs(90),pg_temp.cs(11),submission,
 (flow->>'revision')::bigint,(flow->>'ownership_revision')::bigint,jsonb_build_object('analytes','["potassium"]'::jsonb,
 'evidence','Synthetic pre-save intention','occurred_at',pg_temp.cs_instant(now()-interval '1 hour'))); END $intent$;`;
async function capture(name, statement) {
  await writeFile(path.join(output, name + '.sql'), statement, { flag: 'wx' });
  const result = await sql(statement); await writeFile(path.join(output, name + '.stdout'), result, { flag: 'wx' }); return result;
}
await capture('fixtures', `BEGIN; ${fixtures}
 INSERT INTO public.lab_results(id,patient_id,collected_at,potassium,creatinine,egfr)
 SELECT pg_temp.cs(n),pg_temp.cs(11),now()-interval '1 day',4.6,1.23,82 FROM generate_series(5000,5199) n; COMMIT;`);
function session(name) {
  const child = spawn('/opt/homebrew/bin/psql', args, { stdio: 'pipe' }); const state = { sql: '', stdout: '', stderr: '', ended: false };
  child.stdout.on('data', (part) => { state.stdout += part; }); child.stderr.on('data', (part) => { state.stderr += part; });
  const done = new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', (code) => { state.ended = true; resolve(code); }); });
  return { child, state, done, send(statement, end = false) { state.sql += statement; if (end) child.stdin.end(statement); else child.stdin.write(statement); },
    async persist() { for (const key of ['sql', 'stdout', 'stderr']) await writeFile(path.join(output, `${name}.${key}`), state[key], { flag: 'wx' }); } };
}
async function until(test, label) { const deadline = Date.now() + 8000;
  while (Date.now() < deadline) { if (await test()) return; await new Promise((resolve) => setTimeout(resolve, 25)); } throw new Error('Timed out: ' + label); }
const cases = [
  { name: 'link-before-correction', first: apply, second: change, linked: true, changed: true, invalidations: 1 },
  { name: 'correction-before-link', first: change, second: apply, code: '40001', changed: true },
  { name: 'replacement-before-old-correction', existing: true, replacement: true, first: apply, second: change, linked: true, changed: true },
  { name: 'old-correction-before-replacement', existing: true, replacement: true, first: change, second: apply, linked: true, changed: true, invalidations: 1 },
  { name: 'unlink-before-correction', existing: true, unlink: true, first: apply, second: change, linked: true, changed: true },
  { name: 'correction-before-unlink', existing: true, unlink: true, first: change, second: apply, linked: true, changed: true, invalidations: 1 },
  { name: 'evaluation-before-link', first: evaluate, firstService: true, second: apply, linked: true, evaluation: true },
  { name: 'link-before-evaluation', first: apply, second: evaluate, secondService: true, linked: true, evaluation: true },
  { name: 'transfer-before-link', first: offer, second: apply, code: '42501', transfer: true },
  { name: 'link-before-transfer', first: apply, second: offer, linked: true, transfer: true },
  { name: 'monitor-expiry-during-profile-wait', first: () => 'SELECT id FROM public.profiles WHERE id=pg_temp.cs(1) FOR UPDATE;',
    firstAdmin: true, second: apply, expiry: true, code: '42501' },
  { name: 'link-revocation-during-profile-wait', first: () => 'SELECT id FROM public.profiles WHERE id=pg_temp.cs(1) FOR UPDATE;', firstAdmin: true,
    second: apply, after: () => "UPDATE public.provider_patient_links SET status='revoked' WHERE provider_id=pg_temp.cs(1);", code: '42501' },
  { name: 'collection-during-reader-wait', existing: true, first: () => 'SELECT public.get_lab_source_context(pg_temp.cs(90),pg_temp.cs(11));',
    second: detail, after: (n) => `SELECT public.prepare_lab_observation_change(pg_temp.cs(${50000 + n}),pg_temp.cs(${10000 + n}),pg_temp.cs(90),pg_temp.cs(11),1,'correct_source',
     jsonb_build_object('reason','Synthetic late collection','evidence','Synthetic corrected source','occurred_at',pg_temp.cs_instant(clock_timestamp()),
     'value','4.2','collected_at',pg_temp.cs_instant(clock_timestamp()))); SELECT public.apply_lab_observation(pg_temp.cs(${50000 + n}));`,
    changed: true, invalidations: 1, read: true },
  { name: 'step-before-composition-prepare', first: prepareStep, second: prepare, code: '23505', prepareRace: 'step' },
  { name: 'composition-before-step-prepare', first: prepare, second: prepareStep, code: '23505', prepareRace: 'step', compositionFirst: true },
  { name: 'intent-before-composition-prepare', first: prepareIntent, second: prepare, code: '23505', prepareRace: 'intent' },
  { name: 'composition-before-intent-prepare', first: prepare, second: prepareIntent, code: '23505', prepareRace: 'intent', compositionFirst: true },
];
const results = [];
async function setup(test, n) {
  await capture(test.name + '-setup', `${prefix} BEGIN; ${reset} ${auth()}
   SELECT pg_temp.cs_new(${20000 + n}); SELECT pg_temp.cc_register(${10000 + n},pg_temp.cs(${5000 + n}));
   ${test.existing ? `SELECT pg_temp.cc_apply(${30000 + n},${20000 + n},${map(n)});` : ''}
   ${test.replacement ? `SELECT pg_temp.cc_register(${11000 + n},pg_temp.cs(${5100 + n}));` : ''}
   ${test.read || test.prepareRace ? '' : `SELECT pg_temp.cc_prepare(${40000 + n},${20000 + n},${test.replacement ? `pg_temp.cc_mapping(${11000 + n})` : test.unlink ? "'{}'::jsonb" : map(n)});`}
   COMMIT;`);
  if (test.expiry) await capture(test.name + '-expiry', `${prefix} UPDATE public.member_authorizations SET expires_at=clock_timestamp()+interval '2 seconds'
   WHERE capability='monitor' AND membership_id IN(SELECT id FROM public.organization_memberships WHERE user_id=pg_temp.cs(1));`);
}
async function readback(test, n) {
  return JSON.parse(await capture(test.name + '-readback', `${prefix} SELECT json_build_object(
   'request_state',(SELECT state FROM public.care_lab_composition_requests WHERE id=pg_temp.cs(${40000 + n})),
   'root_revision',(SELECT max(revision)::text FROM public.lab_observation_versions WHERE root_id=pg_temp.cs(${10000 + n})),
   'invalidations',(SELECT count(*) FROM public.care_lab_source_invalidations i JOIN public.care_lab_composition_entries e ON e.id=i.entry_id
    JOIN public.care_lab_composition_events c ON c.id=e.event_id WHERE c.work_item_id=pg_temp.cs(${20000 + n})),
   'transfer',(SELECT transfer_pending_to IS NOT NULL FROM public.work_items WHERE id=pg_temp.cs(${20000 + n})),
   'evaluation',(SELECT status FROM public.lab_alert_evaluations WHERE lab_result_id=pg_temp.cs(${5000 + n})));`));
}
async function race(test, n) {
  await setup(test, n); const a = session(test.name + '-a'), b = session(test.name + '-b'); let blocking;
  try {
    a.send(`${prefix} SELECT 'PID:'||pg_backend_pid(); BEGIN; SET LOCAL statement_timeout='12s'; ${test.firstAdmin ? '' : test.firstService ? service : auth()} ${test.first(n)}\n\\echo HOLDING\n`);
    await until(() => { if (a.state.ended) throw new Error(a.state.stderr); return a.state.stdout.includes('HOLDING'); }, test.name);
    const holder = Number(a.state.stdout.match(/PID:(\d+)/)[1]);
    b.send(`${prefix} SELECT 'PID:'||pg_backend_pid(); BEGIN; SET LOCAL statement_timeout='12s'; ${test.secondService ? service : auth()} ${test.second(n)} COMMIT;\n`, true);
    await until(() => /PID:\d+/.test(b.state.stdout), test.name + ' contender'); const contender = Number(b.state.stdout.match(/PID:(\d+)/)[1]);
    await until(async () => { if (b.state.ended) throw new Error(b.state.stderr || 'Contender did not block');
      const row = await sql(`SELECT json_build_object('pid',pid,'blockers',pg_blocking_pids(pid),'wait',wait_event) FROM pg_stat_activity
       WHERE pid=${contender} AND ${holder}=ANY(pg_blocking_pids(pid));`); if (row) blocking = JSON.parse(row); return Boolean(blocking); }, test.name + ' actual blocking');
    if (test.expiry) await new Promise((resolve) => setTimeout(resolve, 2200));
    a.send(`${test.after?.(n) ?? ''} COMMIT;\n`, true);
    const codes = await Promise.all([a.done, b.done]); assert.deepEqual(codes, [0, test.code ? 3 : 0], a.state.stderr + b.state.stderr);
    if (test.code) assert.match(b.state.stderr, new RegExp(test.code));
    const proof = await readback(test, n);
    assert.deepEqual(proof, { request_state: test.read || test.prepareRace && !test.compositionFirst ? null : test.linked ? 'applied' : 'prepared', root_revision: test.changed ? '2' : '1',
      invalidations: test.invalidations ?? 0, transfer: test.transfer ?? false, evaluation: test.evaluation ? 'not_required' : 'pending' });
    if (test.read) {
      const projected = JSON.parse(b.state.stdout.match(/DETAIL:(.*)/)[1]);
      const potassium = projected.sources.find((row) => row.analyte === 'potassium');
      assert.equal(potassium.quality, 'available'); assert.equal(potassium.head.revision, '2');
    }
    if (test.prepareRace) {
      const identity = test.prepareRace === 'step' ? 60000 + n : 70000 + n;
      const table = test.prepareRace === 'step' ? 'care_step_requests' : 'lab_followup_submission_intents';
      assert.equal(await capture(test.name + '-other-command', `${prefix} SELECT count(*) FROM public.${table} WHERE id=pg_temp.cs(${identity}) AND state='prepared';`), test.compositionFirst ? '0' : '1');
    }
    results.push({ name: test.name, blocking, codes, proof, ok: true }); console.log(test.name + ': PASS');
  } finally {
    if (!a.state.ended) a.child.kill('SIGTERM'); if (!b.state.ended) b.child.kill('SIGTERM');
    await Promise.all([a.done, b.done]); await Promise.all([a.persist(), b.persist()]);
    await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
  }
}
for (const [n, test] of cases.entries()) await race(test, n);

// Prove fan-out does not wait on dependent work, including implicit FK locks.
const free = { name: 'correction-independent-of-dependent-work', existing: true, read: true };
await setup(free, 50);
const a = session(free.name + '-a'), b = session(free.name + '-b');
try {
  a.send(`${prefix} SELECT 'PID:'||pg_backend_pid(); BEGIN; SELECT id FROM public.work_items WHERE id=pg_temp.cs(20050) FOR UPDATE;\n\\echo HOLDING\n`);
  await until(() => a.state.stdout.includes('HOLDING'), 'work holder');
  b.send(`${prefix} BEGIN; SET LOCAL statement_timeout='2s'; ${auth()} ${change(50)} COMMIT;\n`, true);
  assert.equal(await b.done, 0, b.state.stderr); assert.equal(a.state.ended, false);
  const proof = await readback(free, 50); assert.equal(proof.invalidations, 1); assert.equal(proof.root_revision, '2');
  a.send('COMMIT;\n', true); assert.equal(await a.done, 0);
  results.push({ name: free.name, dependent_work_holder_still_open_at_correction_commit: true, proof, ok: true });
} finally {
  if (!a.state.ended) a.child.kill('SIGTERM'); if (!b.state.ended) b.child.kill('SIGTERM');
  await Promise.all([a.done, b.done]); await Promise.all([a.persist(), b.persist()]);
}

// Independent authorities can correct two sources of the same work concurrently.
const dual = 'distinct-authority-roots-same-work';
await capture(dual + '-setup', `${prefix} BEGIN; ${reset} ${auth()}
 SELECT pg_temp.cs_new(20060); SELECT pg_temp.cc_register(10060,pg_temp.cs(5060));
 ${auth(3)} SELECT pg_temp.cc_register(11060,pg_temp.cs(5160),'creatinine',91);
 ${auth()} SELECT pg_temp.cc_apply(30060,20060,pg_temp.cc_mapping(10060)||pg_temp.cc_mapping(11060,'1','creatinine')); COMMIT;`);
const da = session(dual + '-a'), db = session(dual + '-b');
try {
  da.send(`${prefix} BEGIN; ${auth()} ${change(60)}\n\\echo HOLDING\n`);
  await until(() => { if (da.state.ended) throw new Error(da.state.stderr); return da.state.stdout.includes('HOLDING'); }, dual);
  db.send(`${prefix} BEGIN; SET LOCAL statement_timeout='2s'; ${auth(3)}
   SELECT public.prepare_lab_observation_change(pg_temp.cs(51060),pg_temp.cs(11060),pg_temp.cs(91),pg_temp.cs(11),1,'correct_source',
    jsonb_build_object('reason','Synthetic corrected report','evidence','Synthetic distinct source','occurred_at',pg_temp.cs_instant(now()-interval '1 hour'),
    'value','1.2','collected_at',pg_temp.cs_instant(now()-interval '1 day')));
   SELECT public.apply_lab_observation(pg_temp.cs(51060)); COMMIT;\n`, true);
  assert.equal(await db.done, 0, db.state.stderr); assert.equal(da.state.ended, false);
  da.send('COMMIT;\n', true); assert.equal(await da.done, 0, da.state.stderr);
  const proof = JSON.parse(await capture(dual + '-readback', `${prefix} SELECT json_build_object(
   'roots',(SELECT json_agg(revision::text ORDER BY root_id) FROM public.lab_observation_versions WHERE root_id IN(pg_temp.cs(10060),pg_temp.cs(11060)) AND revision=2),
   'invalidations',(SELECT count(*) FROM public.care_lab_source_invalidations i JOIN public.care_lab_composition_entries e ON e.id=i.entry_id
    JOIN public.care_lab_composition_events c ON c.id=e.event_id WHERE c.work_item_id=pg_temp.cs(20060)));`));
  assert.deepEqual(proof, { roots: ['2', '2'], invalidations: 2 });
  results.push({ name: dual, first_correction_still_open_at_second_commit: true, proof, ok: true });
} finally {
  if (!da.state.ended) da.child.kill('SIGTERM'); if (!db.state.ended) db.child.kill('SIGTERM');
  await Promise.all([da.done, db.done]); await Promise.all([da.persist(), db.persist()]);
}
for (const isolation of ['REPEATABLE READ', 'SERIALIZABLE']) {
  const s = session('isolation-' + isolation.toLowerCase().replaceAll(' ', '-'));
  s.send(`${prefix} BEGIN ISOLATION LEVEL ${isolation}; ${auth()} ${detail(50)} COMMIT;\n`, true);
  assert.equal(await s.done, 3); assert.match(s.state.stderr, /25001/); await s.persist();
}
const hashes = {};
for (const file of ['supabase/migrations/00068_care_lab_compositions.sql','supabase/tests/care_lab_compositions.sql','scripts/test-care-lab-compositions.mjs']) {
  hashes[file] = createHash('sha256').update(await readFile(file)).digest('hex');
}
await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
await writeFile(path.join(output, 'completion.json'), JSON.stringify({ database, completed_at: new Date().toISOString(), actual_blocking_cases: cases.length,
  work_lock_independence_cases: 1, distinct_authority_independence_cases: 1, isolation_denials: 2, hashes, all_ok: true }, null, 2), { flag: 'wx' });
console.log('Laboratory composition concurrency: PASS');
