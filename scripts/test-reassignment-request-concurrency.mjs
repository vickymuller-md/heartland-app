/** Committed, synthetic 00051 races in a new local-only disposable clone.
 * node scripts/test-reassignment-request-concurrency.mjs SOCKET PORT DATABASE NEW_OUTPUT_DIRECTORY
 * Preserves each session, observed blocking edge, readback and TAP result.
 * Does not modify the 00050 concurrency harness or create/drop databases.
 */
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import path from 'node:path';

const run = promisify(execFile);
const [socket, port, database, output] = process.argv.slice(2);
assert.ok(socket?.startsWith('/private/tmp/hl-') && /^\d+$/.test(port ?? '')
  && /^n2p3g_concurrency_[a-z0-9_]+$/.test(database ?? '') && path.isAbsolute(output ?? ''),
'Explicit local 00051 concurrency clone and new evidence directory required');
const psql = '/opt/homebrew/bin/psql';
const args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose',
  '-h', socket, '-p', port, '-U', 'postgres', '-d', database];
async function sql(statement) {
  return (await run(psql, [...args, '-c', statement], { maxBuffer: 8 * 1024 * 1024 })).stdout.trim();
}
assert.equal(await sql('SELECT current_database()'), database);
assert.equal(await sql('SHOW listen_addresses'), '', 'TCP must be disabled');
assert.equal(await sql('SELECT count(*) FROM auth.users'), '0', 'clone must start empty');
assert.equal(await sql('SELECT count(*) FROM public.work_item_events'), '0', 'event trail must start empty');
await mkdir(output); // Refuse overwriting any earlier evidence.
async function capture(label, statement) {
  await writeFile(path.join(output, `${label}.sql`), statement, { flag: 'wx' });
  let result;
  try { result = { ...await run(psql, [...args, '-c', statement], { maxBuffer: 8 * 1024 * 1024 }), code: 0 }; }
  catch (error) { result = { stdout: error.stdout ?? '', stderr: error.stderr ?? '', code: error.code ?? -1 }; }
  await writeFile(path.join(output, `${label}.stdout`), result.stdout, { flag: 'wx' });
  await writeFile(path.join(output, `${label}.stderr`), result.stderr, { flag: 'wx' });
  assert.equal(result.code, 0, result.stderr);
  return result.stdout.trim();
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const boundFiles = ['scripts/test-reassignment-request-concurrency.mjs',
  'scripts/test-work-ownership-concurrency.mjs', 'supabase/migrations/00050_recoverable_work_reassignment.sql',
  'supabase/migrations/00051_durable_reassignment_requests.sql'];
await writeFile(path.join(output, 'bindings.json'), JSON.stringify({ database, socket, port,
  started_at: new Date().toISOString(), listen_addresses: '', initial_users: 0, initial_events: 0,
  files: Object.fromEntries(await Promise.all(boundFiles.map(async (file) => [file,
    createHash('sha256').update(await readFile(path.join(root, file))).digest('hex')]))),
}, null, 2), { flag: 'wx' });
await capture('function-bindings', `SELECT oid::regprocedure::text,md5(pg_get_functiondef(oid))
 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN(
 'prepare_work_reassignment','recover_work_reassignment','finish_work_reassignment_request',
 'get_my_work_reassignment_requests','reassign_work_item_recoverable','work_reassignment_request_state',
 'unresolved_work_reassignment','lock_work_ownership_scope') ORDER BY oid::regprocedure::text;`);

const planned = 11;
const id = (n) => `51000000-5555-4000-8000-${String(n).padStart(12, '0')}`;
const fixtures = Array.from({ length: planned }, (_, i) => ({ actor: id(i * 20 + 1), target: id(i * 20 + 2),
  patient: id(i * 20 + 3), item: id(i * 20 + 4), request: id(i * 20 + 5), org: id(i * 20 + 6),
  nextRequest: id(i * 20 + 7), otherPatient: id(i * 20 + 8), otherItem: id(i * 20 + 9) }));
await capture('setup', 'BEGIN;' + fixtures.map((f, i) => `
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('${f.actor}','request-${i}-manager@example.invalid','{"consent_accepted":true}'),
 ('${f.target}','request-${i}-target@example.invalid','{"consent_accepted":true}'),
 ('${f.patient}','request-${i}-patient@example.invalid','{"consent_accepted":true}'),
 ('${f.otherPatient}','request-${i}-other-patient@example.invalid','{"consent_accepted":true}');
UPDATE public.profiles SET role='provider' WHERE id IN('${f.actor}','${f.target}');
INSERT INTO public.organizations(id,name,created_by) VALUES('${f.org}','Synthetic request race ${i}','${f.actor}');
INSERT INTO public.organization_memberships(organization_id,user_id,role,status,joined_at,created_by)
 VALUES('${f.org}','${f.actor}','owner','active',now(),'${f.actor}'),('${f.org}','${f.target}','clinician','active',now(),'${f.actor}');
INSERT INTO public.member_authorizations(membership_id,capability,granted_by)
 SELECT id,'monitor','${f.actor}' FROM public.organization_memberships WHERE organization_id='${f.org}';
INSERT INTO public.provider_patient_links(provider_id,patient_id,status,linked_at)
 SELECT provider,patient,'active',now() FROM unnest(ARRAY['${f.actor}'::uuid,'${f.target}'::uuid]) provider
 CROSS JOIN unnest(ARRAY['${f.patient}'::uuid,'${f.otherPatient}'::uuid]) patient;
INSERT INTO public.organization_patient_assignments(organization_id,patient_id,assigned_by)
 VALUES('${f.org}','${f.patient}','${f.actor}'),('${f.org}','${f.otherPatient}','${f.actor}');
INSERT INTO public.work_items(id,organization_id,patient_id,provider_id,assigned_to,source_type,title,reason,priority,severity,accountability_source)
 VALUES('${f.item}','${f.org}','${f.patient}','${f.actor}','${f.actor}','manual','Synthetic item','Synthetic reason','today','warning','designated'),
 ('${f.otherItem}','${f.org}','${f.otherPatient}','${f.actor}','${f.actor}','manual','Other synthetic item','Synthetic reason','today','warning','designated');
`).join('') + 'COMMIT;');

const auth = (user) => `SET ROLE authenticated; SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"${user}","aal":"aal2"}',false);`;
const payload = (f, options = {}) => ({ request: f.request, item: f.item, owner: f.actor, revision: '0',
  target: f.target, reason: 'Synthetic reviewed handover', ...options });
function command(name, f, options) {
  const p = payload(f, options);
  return auth(f.actor) + `SELECT public.${name}('${p.request}','${p.item}','${p.owner}',${p.revision},'${p.target}','${p.reason}');`;
}
const prepare = (f, options) => command('prepare_work_reassignment', f, options);
const apply = (f, options) => command('reassign_work_item_recoverable', f, options);
const cancel = (f, request = f.request) => auth(f.actor) + `SELECT public.finish_work_reassignment_request('${request}',NULL,true);`;
const acknowledge = (f) => auth(f.actor) + `SELECT public.finish_work_reassignment_request('${f.request}',
 (SELECT id FROM public.work_item_events WHERE actor_id='${f.actor}' AND ownership_request_id='${f.request}' AND event_type='assigned'),false);`;
const recover = (f) => auth(f.actor) + `SELECT public.recover_work_reassignment('${f.item}');`;
const serialize = (f) => `SELECT pg_advisory_xact_lock(hashtextextended('heartland:work-ownership:${f.org}:${f.patient}',0));`;
const revokeTarget = (f) => `UPDATE public.member_authorizations SET revoked_at=clock_timestamp()
 WHERE capability='monitor' AND membership_id IN(SELECT id FROM public.organization_memberships
 WHERE organization_id='${f.org}' AND user_id='${f.target}');`;
function jsonLines(stdout) {
  return stdout.split('\n').filter((line) => line.startsWith('{') || line.startsWith('[')).map((line) => JSON.parse(line));
}
function returnedState(connection) {
  const state = jsonLines(connection.state.stdout).find((value) => value.state && value.request);
  assert.ok(state, 'RPC must return an explicit request state');
  return state;
}
function returnedReceipt(connection) {
  const receipt = jsonLines(connection.state.stdout).find((value) => value.event_id && value.recorded_revision);
  assert.ok(receipt, 'Apply must return an explicit recorded receipt');
  return receipt;
}
const expected = (f, changes = {}) => ({ assigned: f.actor, revision: '0', accepted: false, status: 'new',
  requested: 1, receipts: 0, seen: 0, cancelled: 0, pending: f.request, actor_requested: 1, ...changes });
const applied = (f, changes = {}) => expected(f, { assigned: f.target, revision: '1', receipts: 1, ...changes });
const newer = (f) => ({ request: f.nextRequest, owner: f.target, revision: '1', target: f.actor });

function session(label) {
  const child = spawn(psql, args, { stdio: 'pipe' });
  const state = { input: '', stdout: '', stderr: '', ended: false };
  child.stdout.on('data', (value) => { state.stdout += value; });
  child.stderr.on('data', (value) => { state.stderr += value; });
  const done = new Promise((resolve, reject) => {
    child.on('error', reject); child.on('exit', (code) => { state.ended = true; resolve(code); });
  });
  return { child, state, done,
    send(statement, end = false) { state.input += statement; if (end) child.stdin.end(statement); else child.stdin.write(statement); },
    async persist() {
      await Promise.all(['input', 'stdout', 'stderr'].map((kind) => writeFile(
        path.join(output, `${label}.${kind === 'input' ? 'sql' : kind}`), state[kind], { flag: 'wx' })));
    },
  };
}
async function until(test, label) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (await test()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out: ${label}`);
}
const results = [];
const tap = ['TAP version 13', `1..${planned}`];
async function race(name, f, first, second, want, { errorCode, verify } = {}) {
  const a = session(`${name}-a`), b = session(`${name}-b`);
  let codes, wait, readback;
  try {
    a.send(`SELECT 'PID:'||pg_backend_pid(); BEGIN; ${first}\n\\echo HOLDING\n`);
    await until(() => {
      if (a.state.ended) throw new Error(a.state.stderr || 'Holder ended before observation');
      return a.state.stdout.includes('HOLDING');
    }, `${name} holder`);
    const holder = Number(a.state.stdout.match(/PID:(\d+)/)?.[1]); assert.ok(holder);
    b.send(`SELECT 'PID:'||pg_backend_pid(); BEGIN; ${second}\nCOMMIT;\n`, true);
    await until(() => /PID:\d+/.test(b.state.stdout), `${name} contender`);
    const contender = Number(b.state.stdout.match(/PID:(\d+)/)?.[1]); assert.ok(contender);
    const waitQuery = `SELECT json_build_object('pid',pid,'wait_event_type',wait_event_type,'wait_event',wait_event,
      'blockers',pg_blocking_pids(pid),'query',query) FROM pg_stat_activity
      WHERE pid=${contender} AND ${holder}=ANY(pg_blocking_pids(pid));`;
    await until(async () => {
      if (b.state.ended) throw new Error(`Contender did not wait: ${b.state.stderr}`);
      const observed = await sql(waitQuery); if (observed) wait = JSON.parse(observed);
      return Boolean(wait);
    }, `${name} observed blocking edge`);
    await writeFile(path.join(output, `${name}-wait.sql`), waitQuery, { flag: 'wx' });
    await writeFile(path.join(output, `${name}-wait.json`), JSON.stringify(wait, null, 2), { flag: 'wx' });
    a.send('COMMIT;\n', true);
    codes = await Promise.all([a.done, b.done]);
    assert.deepEqual(codes, [0, errorCode ? 3 : 0], b.state.stderr);
    if (errorCode) assert.match(b.state.stderr, new RegExp(`^ERROR:\\s+${errorCode}:`, 'm'));
    const query = `SELECT json_build_object('assigned',assigned_to,'revision',ownership_revision::text,
      'accepted',accepted_at IS NOT NULL,'status',status,
      'requested',(SELECT count(*) FROM public.work_item_events WHERE work_item_id='${f.item}' AND event_type='reassignment_requested'),
      'receipts',(SELECT count(*) FROM public.work_item_events WHERE work_item_id='${f.item}' AND event_type='assigned' AND ownership_request_id IS NOT NULL),
      'seen',(SELECT count(*) FROM public.work_item_events WHERE work_item_id='${f.item}' AND event_type='reassignment_seen'),
      'cancelled',(SELECT count(*) FROM public.work_item_events WHERE work_item_id='${f.item}' AND event_type='reassignment_cancelled'),
      'pending',public.unresolved_work_reassignment('${f.actor}','${f.item}'),
      'actor_requested',(SELECT count(*) FROM public.work_item_events WHERE actor_id='${f.actor}' AND event_type='reassignment_requested'))
      FROM public.work_items WHERE id='${f.item}';`;
    readback = JSON.parse(await capture(`${name}-readback`, query));
    assert.deepEqual(readback, want);
    if (verify) await verify(a, b);
    results.push({ name, status: 'PASS', codes, wait, readback });
    tap.push(`ok ${results.length} - ${name}`);
    console.log(tap.at(-1));
  } catch (error) {
    results.push({ name, status: 'FAIL', codes, wait, readback, error: String(error) });
    tap.push(`not ok ${results.length} - ${name}`, `# ${String(error).split('\n')[0]}`);
    throw error;
  } finally {
    if (!a.state.ended) { a.child.kill('SIGTERM'); await a.done; }
    if (!b.state.ended) { b.child.kill('SIGTERM'); await b.done; }
    await Promise.all([a.persist(), b.persist()]);
    await writeFile(path.join(output, 'concurrency-results.json'), JSON.stringify(results, null, 2));
    await writeFile(path.join(output, 'concurrency-results.tap'), tap.join('\n') + '\n');
  }
}

let index = 0;
{
  const f = fixtures[index++];
  await race('prepare-distinct-identities-one-slot', f, prepare(f), prepare(f, { request: f.nextRequest }), expected(f), {
    verify: async (a, b) => {
      assert.deepEqual(returnedState(a), returnedState(b));
      assert.equal(returnedState(b).request.requestId, f.request);
    },
  });
}
{
  const f = fixtures[index++];
  await race('same-identity-different-patients', f, prepare(f), prepare(f, { item: f.otherItem }), expected(f), {
    errorCode: '23505', verify: async () => {
      const other = JSON.parse(await capture('same-identity-other-item', `SELECT json_build_object('assigned',assigned_to,
        'revision',ownership_revision::text,'requested',(SELECT count(*) FROM public.work_item_events
        WHERE work_item_id='${f.otherItem}' AND ownership_request_id IS NOT NULL)) FROM public.work_items WHERE id='${f.otherItem}';`));
      assert.deepEqual(other, { assigned: f.actor, revision: '0', requested: 0 });
    },
  });
}
{
  const f = fixtures[index++];
  await capture('cancel-first-preparation', prepare(f));
  await race('cancel-before-late-apply', f, cancel(f), apply(f), expected(f, { cancelled: 1, pending: null }), { errorCode: '55000' });
}
{
  const f = fixtures[index++];
  await capture('apply-first-preparation', prepare(f));
  await race('apply-before-cancel', f, apply(f), cancel(f), applied(f), {
    verify: async (a, b) => {
      assert.equal(returnedState(b).state, 'applied');
      assert.deepEqual(returnedState(b).receipt, returnedReceipt(a));
      const projection = jsonLines(await capture('applied-outside-own-queue', auth(f.actor) + `
        SELECT json_build_object('own_queue',(SELECT count(*) FROM public.work_items WHERE id='${f.item}' AND assigned_to='${f.actor}'),
        'pending',public.get_my_work_reassignment_requests(NULL,25));`)).at(-1);
      assert.equal(projection.own_queue, 0);
      assert.equal(projection.pending.items.length, 1);
      assert.deepEqual(projection.pending.items[0].receipt, returnedReceipt(a));
    },
  });
}
{
  const f = fixtures[index++];
  await capture('exact-apply-preparation', prepare(f));
  await race('identical-apply-exact-receipt', f, apply(f), apply(f), applied(f), {
    verify: async (a, b) => assert.deepEqual(returnedReceipt(a), returnedReceipt(b)),
  });
}
{
  const f = fixtures[index++];
  await capture('ack-first-original', prepare(f) + apply(f));
  await race('ack-before-new-request', f, acknowledge(f), prepare(f, newer(f)),
    applied(f, { requested: 2, seen: 1, pending: f.nextRequest, actor_requested: 2 }), {
      verify: async (a, b) => {
        assert.equal(returnedState(a).state, 'seen');
        assert.equal(returnedState(b).request.requestId, f.nextRequest);
        assert.equal(returnedState(b).state, 'prepared');
      },
    });
}
{
  const f = fixtures[index++];
  await capture('old-ack-terminal', prepare(f) + apply(f) + acknowledge(f));
  await race('new-request-before-old-ack-replay', f, prepare(f, newer(f)), acknowledge(f),
    applied(f, { requested: 2, seen: 1, pending: f.nextRequest, actor_requested: 2 }), {
      verify: async (_a, b) => {
        assert.equal(returnedState(b).state, 'seen');
        assert.equal(returnedState(b).request.requestId, f.request);
      },
    });
}
for (const operation of ['read', 'cancel']) {
  const f = fixtures[index++];
  const original = jsonLines(await capture(`target-revoked-${operation}-preparation`, prepare(f))).at(-1);
  // Hold the shared serialization lock so the caller-only operation must observe
  // the committed revocation; target authorization itself must not be required.
  await race(`target-revoked-before-${operation}`, f, serialize(f) + revokeTarget(f), operation === 'read' ? recover(f) : cancel(f),
    expected(f, operation === 'cancel' ? { cancelled: 1, pending: null } : {}), {
      verify: async (_a, b) => {
        const state = returnedState(b);
        assert.deepEqual(state.request, original.request);
        assert.equal(state.state, operation === 'read' ? 'prepared' : 'cancelled');
        assert.equal(await capture(`target-revoked-${operation}-grant`, `SELECT count(*) FROM public.member_authorizations
          WHERE revoked_at IS NOT NULL AND membership_id IN(SELECT id FROM public.organization_memberships
          WHERE organization_id='${f.org}' AND user_id='${f.target}');`), '1');
      },
    });
}
{
  const f = fixtures[index++];
  await capture('old-cancel-terminal', prepare(f) + cancel(f));
  await race('new-request-before-old-cancel-replay', f, prepare(f, { request: f.nextRequest }), cancel(f),
    expected(f, { requested: 2, cancelled: 1, pending: f.nextRequest, actor_requested: 2 }), {
      verify: async (_a, b) => {
        assert.equal(returnedState(b).state, 'cancelled');
        assert.equal(returnedState(b).request.requestId, f.request);
      },
    });
}
{
  const f = fixtures[index++];
  await race('same-identity-conflicting-payload', f, prepare(f), prepare(f, { reason: 'Different synthetic handover' }),
    expected(f), { errorCode: '23505' });
}
assert.equal(index, planned);
assert.equal(results.length, planned);
assert.ok(results.every((result) => result.status === 'PASS'));
await writeFile(path.join(output, 'completion.json'), JSON.stringify({ database, completed_at: new Date().toISOString(),
  planned, passed: results.length, failed: 0, all_ok: true, fixtures_retained: true,
  final_users: Number(await sql('SELECT count(*) FROM auth.users')),
}, null, 2), { flag: 'wx' });
console.log(`PASS ${planned} observed two-connection races. Synthetic clone and exact evidence retained.`);
