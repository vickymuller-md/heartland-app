/** Local synthetic PostgreSQL rehearsal only. Requires a disposable database
 * cloned from an empty 00045 schema. Keeps SQL, outputs and observed wait queries.
 * node scripts/test-vitals-evaluation-concurrency.mjs SOCKET PORT DATABASE OUTPUT [--include-batch]
 */
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
const run = promisify(execFile);
const [socket, port, database, output, batchOption] = process.argv.slice(2);
const includeBatch = batchOption === '--include-batch';
if (!socket?.startsWith('/private/tmp/hl-') || !/^\d+$/.test(port ?? '')
  || !(includeBatch ? /^n2p3c_concurrency_[a-z0-9_]+$/ : /^n2p3b_concurrency_[a-z0-9_]+$/).test(database ?? '')
  || (batchOption && !includeBatch) || !path.isAbsolute(output ?? '')) {
  throw new Error('Only an explicit local rehearsal socket/database/output is allowed');
}
const psql = '/opt/homebrew/bin/psql';
const args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose',
  '-h', socket, '-p', port, '-U', 'postgres', '-d', database];
await mkdir(output); // Refuse to overwrite an earlier evidence directory.
async function sql(statement) { return (await run(psql, [...args, '-c', statement])).stdout.trim(); }
assert.equal(await sql('SHOW listen_addresses'), '', 'TCP must be disabled');
assert.equal(await sql('SELECT count(*) FROM auth.users'), '0', 'requires an empty disposable database');
function session(label) {
  const child = spawn(psql, args, { stdio: 'pipe' });
  const state = { input: '', stdout: '', stderr: '', ended: false };
  child.stdout.on('data', (data) => { state.stdout += data; });
  child.stderr.on('data', (data) => { state.stderr += data; });
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) => { state.ended = true; resolve(code); });
  });
  const send = (command, end = false) => {
    state.input += command;
    if (end) child.stdin.end(command); else child.stdin.write(command);
  };
  async function persist() {
    await Promise.all(['input', 'stdout', 'stderr'].map((kind) => writeFile(
      path.join(output, `${label}.${kind === 'input' ? 'sql' : kind}`), state[kind])));
  }
  return { child, state, send, done, persist };
}
async function until(test, label) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (await test()) return;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error(`Timed out: ${label}`);
}
const results = [];
const service = "SET ROLE service_role; SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',false);";
function id(n) { return `45000000-5555-4000-8000-${String(n).padStart(12, '0')}`; }
async function fixture(index, patientActor = false) {
  const actor = id(index * 10 + 1), patient = patientActor ? actor : id(index * 10 + 2);
  const setup = `BEGIN;
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
('${actor}','race-${index}-actor@example.invalid','{"consent_accepted":true}')
${patientActor ? '' : `,('${patient}','race-${index}-patient@example.invalid','{"consent_accepted":true}')`};
${patientActor ? '' : `UPDATE public.profiles SET role='provider' WHERE id='${actor}';
INSERT INTO public.provider_patient_links(provider_id,patient_id,status,linked_at) VALUES ('${actor}','${patient}','active',now());`}
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"${actor}","role":"authenticated","aal":"${patientActor ? 'aal1' : 'aal2'}"}',true);
SELECT public.submit_vitals_submission('${patient}',(public.prepare_vitals_submission('${patient}')->>'request_id')::uuid,
180,'lbs',120,80,70,90,0,0,false,0);
COMMIT;`;
  await writeFile(path.join(output, `${index}-setup.sql`), setup);
  const response = await sql(setup);
  await writeFile(path.join(output, `${index}-setup.stdout`), response);
  const request = await sql(`SELECT request_id FROM public.vitals_submission_attempts WHERE actor_id='${actor}' AND patient_id='${patient}'`);
  return { actor, patient, request, finish: (flags = "ARRAY['spo2_low']") =>
    `SELECT public.finalize_vitals_submission_evaluation('${request}','${actor}','vitals-frozen-individual-v1',${flags});` };
}
async function race(name, f, first, second, expectedCode = 0, errorState) {
  const a = session(`${name}-a`), b = session(`${name}-b`);
  try {
    a.send(`SELECT 'PID:' || pg_backend_pid(); BEGIN; ${first}\n\\echo HOLDING\n`);
    await until(() => a.state.stdout.includes('HOLDING'), `${name} first transaction`);
    const pid = Number(a.state.stdout.match(/PID:(\d+)/)?.[1]);
    assert.ok(pid);
    b.send(`SELECT 'PID:' || pg_backend_pid(); BEGIN; ${second}\nCOMMIT;\n`, true);
    await until(() => /PID:\d+/.test(b.state.stdout), `${name} second connection`);
    const contender = Number(b.state.stdout.match(/PID:(\d+)/)?.[1]);
    const waitQuery = `SELECT json_build_object('pid',pid,'wait_event_type',wait_event_type,
      'wait_event',wait_event,'blockers',pg_blocking_pids(pid),'query',query)
      FROM pg_stat_activity WHERE pid=${contender} AND ${pid}=ANY(pg_blocking_pids(pid));`;
    let wait;
    await until(async () => { wait = await sql(waitQuery); return Boolean(wait); }, `${name} observed blocking`);
    await writeFile(path.join(output, `${name}-wait.sql`), waitQuery);
    await writeFile(path.join(output, `${name}-wait.json`), wait);
    a.send('COMMIT;\n', true);
    const [aCode, bCode] = await Promise.all([a.done, b.done]);
    assert.equal(aCode, 0); assert.equal(bCode, expectedCode);
    if (errorState) assert.ok(b.state.stderr.includes(errorState), b.state.stderr);
    const readbackQuery = `SELECT json_build_object(
      'evaluations',(SELECT COALESCE(jsonb_agg(to_jsonb(evaluation)),'[]') FROM public.vitals_submission_evaluations evaluation WHERE request_id='${f.request}'),
      'alerts',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'occurrences',occurrence_count)),'[]') FROM public.alerts WHERE patient_id='${f.patient}'),
      'vitals',(SELECT count(*) FROM public.vitals WHERE patient_id='${f.patient}'),
      'symptoms',(SELECT jsonb_agg(red_flag) FROM public.symptoms WHERE patient_id='${f.patient}'));`;
    const readback = JSON.parse(await sql(readbackQuery));
    await writeFile(path.join(output, `${name}-readback.sql`), readbackQuery);
    await writeFile(path.join(output, `${name}-readback.json`), JSON.stringify(readback, null, 2));
    results.push({ name, aCode, bCode, observedWait: JSON.parse(wait), readback });
    return { readback, a: a.state.stdout, b: b.state.stdout };
  } finally {
    if (!a.state.ended) { a.child.kill('SIGTERM'); await a.done; }
    if (!b.state.ended) { b.child.kill('SIGTERM'); await b.done; }
    await Promise.all([a.persist(), b.persist()]);
  }
}

let f = await fixture(1);
let result = await race('same-evaluation', f, service + f.finish(), service + f.finish());
assert.equal(result.readback.alerts.length, 1); assert.equal(result.readback.alerts[0].occurrences, 1);
assert.equal(result.readback.evaluations[0].attempts, 1); assert.equal(result.readback.vitals, 1);
const receiptLine = (value) => value.split('\n').find((line) => line.startsWith('{') && line.includes('rule_version'));
assert.equal(receiptLine(result.a), receiptLine(result.b));

f = await fixture(2);
result = await race('different-evaluation', f, service + f.finish(), service + f.finish('ARRAY[]::text[]'), 3, '23505');
assert.equal(result.readback.alerts[0].occurrences, 1); assert.equal(result.readback.evaluations[0].attempts, 1);

f = await fixture(3);
result = await race('revocation-first', f,
  `UPDATE public.provider_patient_links SET status='revoked' WHERE provider_id='${f.actor}' AND patient_id='${f.patient}';`,
  service + f.finish(), 3, '42501');
assert.equal(result.readback.alerts.length, 0); assert.equal(result.readback.evaluations[0].status, 'pending');
assert.deepEqual(result.readback.symptoms, [null]);

f = await fixture(4);
result = await race('evaluation-first', f, service + f.finish(),
  `UPDATE public.provider_patient_links SET status='revoked' WHERE provider_id='${f.actor}' AND patient_id='${f.patient}';`);
assert.equal(result.readback.alerts[0].occurrences, 1); assert.equal(result.readback.evaluations[0].status, 'complete');

f = await fixture(5, true);
result = await race('erasure-first', f,
  `UPDATE public.profiles SET role='tester',sandbox_expires_at=now()-interval '1 hour' WHERE id='${f.actor}';
  ${service} SELECT public.purge_expired_tester_provenance('${f.actor}');`, service + f.finish(), 3, '42501');
assert.equal(result.readback.alerts.length, 0); assert.equal(result.readback.evaluations.length, 0);
assert.equal(result.readback.vitals, 1); assert.deepEqual(result.readback.symptoms, [null]);

if (includeBatch) {
  async function batchFixture(index, prepare = true) {
    const actor = id(index * 10 + 1), patient = id(index * 10 + 2);
    const auth = `SET ROLE authenticated; SELECT set_config('request.jwt.claims','{"sub":"${actor}","role":"authenticated","aal":"aal2"}',false);`;
    const setup = `BEGIN; INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
      ('${actor}','batch-race-${index}-actor@example.invalid','{"consent_accepted":true}'),
      ('${patient}','batch-race-${index}-patient@example.invalid','{"consent_accepted":true}');
      UPDATE public.profiles SET role='provider' WHERE id='${actor}';
      INSERT INTO public.provider_patient_links(provider_id,patient_id,status,linked_at) VALUES('${actor}','${patient}','active',now());
      ${auth} ${prepare ? `SELECT public.prepare_vitals_batch('${patient}');` : ''} COMMIT;`;
    await writeFile(path.join(output, `${index}-setup.sql`), setup);
    await writeFile(path.join(output, `${index}-setup.stdout`), await sql(setup));
    const batch = prepare ? await sql(`SELECT batch_id FROM public.vitals_submission_batches WHERE actor_id='${actor}'`) : null;
    const row = { weight: 180, weight_unit: 'lbs', sbp: 120, dbp: 80, heart_rate: 70, spo2: 90, dyspnea: 0, recorded_at: '2026-09-23T12:00:00Z' };
    const payload = JSON.stringify([row, { ...row, weight: 181 }, null, null, null, null, null]);
    return { actor, patient, request: id(index * 10 + 9), batch, auth,
      save: `${auth} SELECT public.submit_vitals_batch('${patient}','${batch}','${payload}'::jsonb);`,
      cancel: `${auth} SELECT public.cancel_vitals_batch('${patient}','${batch}');` };
  }
  async function batchReadback(name, fixture) {
    const query = `SELECT json_build_object('batches',(SELECT jsonb_agg(to_jsonb(b)) FROM public.vitals_submission_batches b WHERE actor_id='${fixture.actor}'),
      'rows',(SELECT count(*) FROM public.vitals_submission_batch_rows r JOIN public.vitals_submission_batches b USING(batch_id) WHERE b.actor_id='${fixture.actor}'),
      'attempts',(SELECT count(*) FROM public.vitals_submission_attempts WHERE actor_id='${fixture.actor}'))`;
    const value = JSON.parse(await sql(query));
    await writeFile(path.join(output, `${name}-batch-readback.sql`), query);
    await writeFile(path.join(output, `${name}-batch-readback.json`), JSON.stringify(value, null, 2));
    results.at(-1).batchReadback = value;
    return value;
  }
  let batch = await batchFixture(6);
  result = await race('batch-save-save', batch, batch.save, batch.save);
  assert.equal(result.readback.vitals, 2); assert.equal(receiptLine(result.a), receiptLine(result.b));
  assert.equal((await batchReadback('batch-save-save', batch)).rows, 2);

  batch = await batchFixture(7);
  result = await race('batch-cancel-save', batch, batch.cancel, batch.save, 3, '23505');
  assert.equal(result.readback.vitals, 0);
  assert.equal((await batchReadback('batch-cancel-save', batch)).batches[0].closed_status, 'cancelled');

  batch = await batchFixture(8);
  result = await race('batch-save-cancel', batch, batch.save, batch.cancel);
  assert.equal(result.readback.vitals, 2); assert.equal(receiptLine(result.a), receiptLine(result.b));
  assert.equal((await batchReadback('batch-save-cancel', batch)).batches[0].closed_status, null);

  batch = await batchFixture(9, false);
  result = await race('individual-prepare-batch-prepare', batch,
    `${batch.auth} SELECT public.prepare_vitals_submission('${batch.patient}');`,
    `${batch.auth} SELECT public.prepare_vitals_batch('${batch.patient}');`, 3, '23505');
  assert.equal(result.readback.vitals, 0);
  const modeState = await batchReadback('individual-prepare-batch-prepare', batch);
  assert.equal(modeState.batches, null); assert.equal(modeState.attempts, 1);

  batch = await batchFixture(10);
  result = await race('batch-revocation-save', batch,
    `UPDATE public.provider_patient_links SET status='revoked' WHERE provider_id='${batch.actor}' AND patient_id='${batch.patient}';`, batch.save, 3, '42501');
  assert.equal(result.readback.vitals, 0); assert.equal((await batchReadback('batch-revocation-save', batch)).rows, 0);

  batch = await batchFixture(11);
  result = await race('batch-save-revocation', batch, batch.save,
    `UPDATE public.provider_patient_links SET status='revoked' WHERE provider_id='${batch.actor}' AND patient_id='${batch.patient}';`);
  assert.equal(result.readback.vitals, 2); assert.equal((await batchReadback('batch-save-revocation', batch)).rows, 2);

  batch = await batchFixture(12);
  result = await race('batch-erasure-save', batch,
    `UPDATE public.profiles SET role='tester',sandbox_expires_at=now()-interval '1 hour' WHERE id='${batch.actor}';
    ${service} SELECT public.purge_expired_tester_provenance('${batch.actor}');`, batch.save, 3, '42501');
  assert.equal(result.readback.vitals, 0); assert.equal((await batchReadback('batch-erasure-save', batch)).batches, null);
}
await writeFile(path.join(output, 'concurrency-results.json'), JSON.stringify({ database, cases: results }, null, 2));
process.stdout.write(JSON.stringify({ cases: results.length, passed: true, output }) + '\n');
