/** Synthetic 00052 read/revocation races in a new local-only disposable clone.
 * node scripts/test-ownership-context-concurrency.mjs SOCKET PORT DATABASE NEW_OUTPUT_DIRECTORY
 * Each case observes two actual connections and a pg_blocking_pids edge.
 * Does not create/drop databases or alter migrations and earlier harnesses.
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
  && /^n2p3h_concurrency_[a-z0-9_]+$/.test(database ?? '') && path.isAbsolute(output ?? ''),
'Explicit local 00052 concurrency clone and new evidence directory required');
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
await mkdir(output); // Never overwrite evidence from another run.
async function capture(label, statement, expectedCode = 0) {
  await writeFile(path.join(output, `${label}.sql`), statement, { flag: 'wx' });
  let result;
  try { result = { ...await run(psql, [...args, '-c', statement], { maxBuffer: 8 * 1024 * 1024 }), code: 0 }; }
  catch (error) { result = { stdout: error.stdout ?? '', stderr: error.stderr ?? '', code: error.code ?? -1 }; }
  await writeFile(path.join(output, `${label}.stdout`), result.stdout, { flag: 'wx' });
  await writeFile(path.join(output, `${label}.stderr`), result.stderr, { flag: 'wx' });
  assert.equal(result.code, expectedCode, result.stderr);
  return result;
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = ['scripts/test-ownership-context-concurrency.mjs',
  'supabase/migrations/00050_recoverable_work_reassignment.sql',
  'supabase/migrations/00052_eligible_ownership_contexts.sql', 'supabase/tests/eligible_ownership_contexts.sql'];
await writeFile(path.join(output, 'bindings.json'), JSON.stringify({ database, socket, port,
  started_at: new Date().toISOString(), listen_addresses: '', initial_users: 0, initial_events: 0,
  files: Object.fromEntries(await Promise.all(files.map(async (file) => [file,
    createHash('sha256').update(await readFile(path.join(root, file))).digest('hex')]))),
}, null, 2), { flag: 'wx' });
await capture('function-bindings', `SELECT oid::regprocedure::text,md5(pg_get_functiondef(oid))
 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN(
 'get_work_transfer_context','get_patient_designation_context','work_ownership_target_page',
 'require_work_ownership_scope','lock_work_ownership_scope','work_ownership_member_eligible')
 ORDER BY oid::regprocedure::text;`);

const id = (n) => `52000000-5555-4000-8000-${String(n).padStart(12, '0')}`;
const scenarios = ['transfer', 'designation'].flatMap((kind) =>
  ['revoke-first', 'read-first', 'expiry-during-wait'].map((mode) => ({ kind, mode })));
const fixtures = scenarios.map((scenario, i) => ({ ...scenario, actor: id(i * 10 + 1),
  target: id(i * 10 + 2), patient: id(i * 10 + 3), org: id(i * 10 + 4), item: id(i * 10 + 5) }));
await capture('setup', 'BEGIN;' + fixtures.map((f, i) => `
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('${f.actor}','selector-race-${i}-actor@example.invalid','{"consent_accepted":true}'),
 ('${f.target}','selector-race-${i}-target@example.invalid','{"consent_accepted":true}'),
 ('${f.patient}','selector-race-${i}-patient@example.invalid','{"consent_accepted":true}');
UPDATE public.profiles SET role='provider',full_name='Synthetic selector provider' WHERE id IN('${f.actor}','${f.target}');
INSERT INTO public.organizations(id,name,created_by) VALUES('${f.org}','Synthetic selector race ${i}','${f.actor}');
INSERT INTO public.organization_memberships(organization_id,user_id,role,status,joined_at,created_by)
 VALUES('${f.org}','${f.actor}','owner','active',now(),'${f.actor}'),('${f.org}','${f.target}','clinician','active',now(),'${f.actor}');
INSERT INTO public.member_authorizations(membership_id,capability,granted_by)
 SELECT id,'monitor','${f.actor}' FROM public.organization_memberships WHERE organization_id='${f.org}';
INSERT INTO public.organization_patient_assignments(organization_id,patient_id,assigned_by)
 VALUES('${f.org}','${f.patient}','${f.actor}');
INSERT INTO public.provider_patient_links(provider_id,patient_id,status,linked_at)
 VALUES('${f.actor}','${f.patient}','active',now()),('${f.target}','${f.patient}','active',now());
INSERT INTO public.work_items(id,organization_id,patient_id,provider_id,assigned_to,source_type,title,reason,priority,severity,accountability_source)
 VALUES('${f.item}','${f.org}','${f.patient}','${f.actor}','${f.actor}','manual','Synthetic selector item','Synthetic reason','today','warning','designated');
INSERT INTO public.patient_accountability(organization_id,patient_id,accountable_id,designated_by)
 VALUES('${f.org}','${f.patient}','${f.target}','${f.actor}');
`).join('') + 'COMMIT;');
const preservationQuery = `SELECT json_build_object(
 'work',md5((SELECT jsonb_agg(to_jsonb(w) ORDER BY id)::text FROM public.work_items w)),
 'events',md5((SELECT jsonb_agg(to_jsonb(e) ORDER BY id)::text FROM public.work_item_events e)),
 'designations',md5((SELECT jsonb_agg(to_jsonb(d) ORDER BY id)::text FROM public.patient_accountability d)),
 'links',md5((SELECT jsonb_agg(to_jsonb(l) ORDER BY id)::text FROM public.provider_patient_links l)));`;
const baseline = JSON.parse((await capture('preservation-before', preservationQuery)).stdout);
const auth = (f) => `SET ROLE authenticated; SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"${f.actor}","aal":"aal2"}',false);`;
const read = (f) => auth(f) + (f.kind === 'transfer'
  ? `SELECT public.get_work_transfer_context('${f.item}');`
  : `SELECT public.get_patient_designation_context('${f.org}','${f.patient}');`);
const monitorWhere = (f) => `capability='monitor' AND membership_id IN(SELECT id FROM public.organization_memberships
 WHERE organization_id='${f.org}' AND user_id='${f.actor}')`;
const revoke = (f) => `UPDATE public.member_authorizations SET revoked_at=clock_timestamp() WHERE ${monitorWhere(f)};`;
const serialize = (f) => `SELECT pg_advisory_xact_lock(hashtextextended('heartland:work-ownership:${f.org}:${f.patient}',0));`;
const jsonLines = (stdout) => stdout.split('\n').filter((line) => line.startsWith('{')).map((line) => JSON.parse(line));
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
const tap = ['TAP version 13', `1..${fixtures.length}`];
for (const f of fixtures) {
  const name = `${f.kind}-${f.mode}`;
  const a = session(`${name}-a`), b = session(`${name}-b`);
  let codes, wait, clockEvidence, readback;
  try {
    if (f.mode === 'expiry-during-wait') {
      await capture(`${name}-set-expiry`, `UPDATE public.member_authorizations SET expires_at=clock_timestamp()+interval '3 seconds'
       WHERE ${monitorWhere(f)} RETURNING expires_at;`);
    }
    const first = f.mode === 'read-first' ? read(f) : f.mode === 'revoke-first' ? revoke(f) : serialize(f);
    const second = f.mode === 'read-first' ? revoke(f) : read(f);
    a.send(`SELECT 'PID:'||pg_backend_pid(); BEGIN; ${first}\n\\echo HOLDING\n`);
    await until(() => {
      if (a.state.ended) throw new Error(a.state.stderr || 'Holder exited before observation');
      return a.state.stdout.includes('HOLDING');
    }, `${name} holder`);
    const holder = Number(a.state.stdout.match(/PID:(\d+)/)?.[1]); assert.ok(holder);
    // Transaction timestamp must precede expiry, proving the final gate uses actual time.
    b.send(`SELECT 'PID:'||pg_backend_pid(); BEGIN;
 SELECT json_build_object('transaction_started_at',now()); ${second}\nCOMMIT;\n`, true);
    await until(() => /PID:\d+/.test(b.state.stdout), `${name} contender`);
    const contender = Number(b.state.stdout.match(/PID:(\d+)/)?.[1]); assert.ok(contender);
    const waitQuery = `SELECT json_build_object('pid',pid,'wait_event_type',wait_event_type,'wait_event',wait_event,
      'blockers',pg_blocking_pids(pid),'query',query) FROM pg_stat_activity
      WHERE pid=${contender} AND ${holder}=ANY(pg_blocking_pids(pid));`;
    await until(async () => {
      if (b.state.ended) throw new Error(`Contender did not wait: ${b.state.stderr}`);
      const observed = await sql(waitQuery); if (observed) wait = JSON.parse(observed);
      return Boolean(wait);
    }, `${name} blocking edge`);
    await writeFile(path.join(output, `${name}-wait.sql`), waitQuery, { flag: 'wx' });
    await writeFile(path.join(output, `${name}-wait.json`), JSON.stringify(wait, null, 2), { flag: 'wx' });
    if (f.mode === 'expiry-during-wait') {
      await until(async () => (await sql(`SELECT clock_timestamp()>expires_at FROM public.member_authorizations WHERE ${monitorWhere(f)}`)) === 't', `${name} actual expiry`);
      clockEvidence = JSON.parse((await capture(`${name}-clock`, `SELECT json_build_object('expires_at',expires_at,
       'observed_at',clock_timestamp(),'expired',clock_timestamp()>expires_at) FROM public.member_authorizations WHERE ${monitorWhere(f)};`)).stdout);
      const started = jsonLines(b.state.stdout).find((line) => line.transaction_started_at)?.transaction_started_at;
      assert.ok(started && new Date(started) < new Date(clockEvidence.expires_at), 'RPC transaction must begin while authorization remains valid');
      assert.equal(clockEvidence.expired, true);
    }
    a.send('COMMIT;\n', true);
    codes = await Promise.all([a.done, b.done]);
    assert.deepEqual(codes, [0, f.mode === 'read-first' ? 0 : 3], b.state.stderr);
    if (f.mode !== 'read-first') {
      assert.match(b.state.stderr, /^ERROR:\s+42501:.*Work ownership operation not authorized/m);
      assert.equal(jsonLines(b.state.stdout).filter((row) => row.targets).length, 0, 'denied read must expose no target page');
    } else {
      const context = jsonLines(a.state.stdout).find((row) => row.targets);
      assert.ok(context, 'successful read must return context before revocation');
      assert.deepEqual(context.targets.map((target) => target.id).sort(),
        (f.kind === 'transfer' ? [f.target] : [f.actor, f.target]).sort());
      if (f.kind === 'transfer') {
        assert.equal(context.work_item_id, f.item); assert.equal(context.current_assignee, f.actor);
        assert.equal(context.eligible, true);
      } else {
        assert.equal(context.organization_id, f.org); assert.equal(context.patient_id, f.patient);
        assert.equal(context.current.id, f.target);
      }
    }
    const after = await capture(`${name}-subsequent-read`, read(f), 1);
    assert.match(after.stderr, /^ERROR:\s+42501:.*Work ownership operation not authorized/m);
    readback = JSON.parse((await capture(`${name}-preservation`, preservationQuery)).stdout);
    assert.deepEqual(readback, baseline, 'scope races must not mutate work, events, links or designations');
    results.push({ name, status: 'PASS', codes, wait, clockEvidence, readback });
    tap.push(`ok ${results.length} - ${name}`);
    console.log(tap.at(-1));
  } catch (error) {
    results.push({ name, status: 'FAIL', codes, wait, clockEvidence, readback, error: String(error) });
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
assert.equal(results.length, fixtures.length);
assert.ok(results.every((result) => result.status === 'PASS'));
await writeFile(path.join(output, 'completion.json'), JSON.stringify({ completed_at: new Date().toISOString(),
  database, cases: results.length, passed: results.length, listen_addresses: await sql('SHOW listen_addresses'),
  synthetic_users: Number(await sql('SELECT count(*) FROM auth.users')),
  final_preservation: JSON.parse(await sql(preservationQuery)),
}, null, 2), { flag: 'wx' });
