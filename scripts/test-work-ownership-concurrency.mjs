/** Synthetic local PostgreSQL only. Persist exact two-connection waits/readbacks.
 * node scripts/test-work-ownership-concurrency.mjs SOCKET PORT DATABASE OUTPUT
 */
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
const run = promisify(execFile);
const [socket, port, database, output] = process.argv.slice(2);
if (!socket?.startsWith('/private/tmp/hl-') || !/^\d+$/.test(port ?? '')
  || !/^n2p3f_concurrency_[a-z0-9_]+$/.test(database ?? '') || !path.isAbsolute(output ?? '')) {
  throw new Error('Explicit local rehearsal socket/database/output required');
}
const psql = '/opt/homebrew/bin/psql';
const args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-h', socket, '-p', port, '-U', 'postgres', '-d', database];
await mkdir(output);
async function sql(statement) { return (await run(psql, [...args, '-c', statement], { maxBuffer: 8 * 1024 * 1024 })).stdout.trim(); }
assert.equal(await sql('SHOW listen_addresses'), '', 'TCP must be disabled');
assert.equal(await sql('SELECT count(*) FROM auth.users'), '0', 'empty disposable database required');
const id = (n) => `50000000-5555-4000-8000-${String(n).padStart(12, '0')}`;
const fixtures = Array.from({ length: 48 }, (_, i) => ({ actor: id(i * 10 + 1), target: id(i * 10 + 2), patient: id(i * 10 + 3), item: id(i * 10 + 4), request: id(i * 10 + 5), org: id(i * 10 + 6) }));
const setup = 'BEGIN;' + fixtures.map((f, i) => `
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
('${f.actor}','ownership-${i}-manager@example.invalid','{"consent_accepted":true}'),
('${f.target}','ownership-${i}-target@example.invalid','{"consent_accepted":true}'),
('${f.patient}','ownership-${i}-patient@example.invalid','{"consent_accepted":true}');
UPDATE public.profiles SET role='provider' WHERE id IN('${f.actor}','${f.target}');
INSERT INTO public.organizations(id,name,created_by) VALUES('${f.org}','Synthetic ownership race ${i}','${f.actor}');
INSERT INTO public.organization_memberships(organization_id,user_id,role,status,joined_at,created_by)
 VALUES('${f.org}','${f.actor}','owner','active',now(),'${f.actor}'),('${f.org}','${f.target}','clinician','active',now(),'${f.actor}');
INSERT INTO public.member_authorizations(membership_id,capability,granted_by)
 SELECT id,'monitor','${f.actor}' FROM public.organization_memberships WHERE organization_id='${f.org}';
INSERT INTO public.provider_patient_links(provider_id,patient_id,status,linked_at)
 VALUES('${f.actor}','${f.patient}','active',now()),('${f.target}','${f.patient}','active',now());
INSERT INTO public.organization_patient_assignments(organization_id,patient_id,assigned_by) VALUES('${f.org}','${f.patient}','${f.actor}');
INSERT INTO public.work_items(id,organization_id,patient_id,provider_id,assigned_to,source_type,title,reason,priority,severity,accountability_source)
 VALUES('${f.item}','${f.org}','${f.patient}','${f.actor}','${f.actor}','manual','Synthetic item','Synthetic race reason','today','warning','designated');
`).join('') + 'COMMIT;';
await writeFile(path.join(output, 'setup.sql'), setup);
await writeFile(path.join(output, 'setup.stdout'), await sql(setup));
const auth = (user) => `SET ROLE authenticated; SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"${user}","aal":"aal2"}',false);`;
const repair = (f, request = f.request) => auth(f.actor) + `SELECT public.reassign_work_item_recoverable('${request}','${f.item}','${f.actor}',0,'${f.target}','Synthetic reviewed handover');`;
const monitor = (f, user, assignment) => `UPDATE public.member_authorizations SET ${assignment} WHERE capability='monitor' AND membership_id IN(SELECT id FROM public.organization_memberships WHERE organization_id='${f.org}' AND user_id='${user}');`;
const membership = (f, user) => `UPDATE public.organization_memberships SET status='revoked' WHERE organization_id='${f.org}' AND user_id='${user}';`;
const link = (f, user) => `UPDATE public.provider_patient_links SET status='revoked' WHERE provider_id='${user}' AND patient_id='${f.patient}';`;
function session(label) {
  const child = spawn(psql, args, { stdio: 'pipe' });
  const state = { input: '', stdout: '', stderr: '', ended: false };
  child.stdout.on('data', (value) => { state.stdout += value; });
  child.stderr.on('data', (value) => { state.stderr += value; });
  const done = new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', (code) => { state.ended = true; resolve(code); }); });
  return { child, state, done,
    send(command, end = false) { state.input += command; if (end) child.stdin.end(command); else child.stdin.write(command); },
    async persist() { await Promise.all(['input', 'stdout', 'stderr'].map((kind) => writeFile(path.join(output, `${label}.${kind === 'input' ? 'sql' : kind}`), state[kind]))); },
  };
}
async function until(test, label) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) { if (await test()) return; await new Promise((resolve) => setTimeout(resolve, 25)); }
  throw new Error(`Timed out: ${label}`);
}
const results = [];
async function race(name, f, first, second, expected, { errorCode, delay = 0, verify } = {}) {
  const a = session(`${name}-a`), b = session(`${name}-b`);
  try {
    a.send(`SELECT 'PID:'||pg_backend_pid(); BEGIN; ${first}\n\\echo HOLDING\n`);
    await until(() => a.state.stdout.includes('HOLDING'), `${name} holding`);
    const holder = Number(a.state.stdout.match(/PID:(\d+)/)?.[1]); assert.ok(holder);
    b.send(`SELECT 'PID:'||pg_backend_pid(); BEGIN; ${second}\nCOMMIT;\n`, true);
    await until(() => /PID:\d+/.test(b.state.stdout), `${name} contender`);
    const contender = Number(b.state.stdout.match(/PID:(\d+)/)?.[1]);
    const query = `SELECT json_build_object('pid',pid,'wait_event_type',wait_event_type,'wait_event',wait_event,'blockers',pg_blocking_pids(pid),'query',query)
      FROM pg_stat_activity WHERE pid=${contender} AND ${holder}=ANY(pg_blocking_pids(pid));`;
    let wait;
    await until(async () => { wait = await sql(query); return Boolean(wait); }, `${name} observed wait`);
    await writeFile(path.join(output, `${name}-wait.sql`), query);
    await writeFile(path.join(output, `${name}-wait.json`), wait);
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    a.send('COMMIT;\n', true);
    const codes = await Promise.all([a.done, b.done]); assert.deepEqual(codes, [0, errorCode ? 3 : 0], b.state.stderr);
    if (errorCode) assert.ok(b.state.stderr.includes(errorCode), b.state.stderr);
    const readbackQuery = `SELECT json_build_object('assigned',assigned_to,'revision',ownership_revision,'accepted',accepted_at IS NOT NULL,
      'status',status,'receipts',(SELECT count(*) FROM public.work_item_events WHERE work_item_id='${f.item}' AND ownership_request_id IS NOT NULL))
      FROM public.work_items WHERE id='${f.item}';`;
    const readback = JSON.parse(await sql(readbackQuery));
    await writeFile(path.join(output, `${name}-readback.sql`), readbackQuery);
    await writeFile(path.join(output, `${name}-readback.json`), JSON.stringify(readback, null, 2));
    assert.deepEqual(readback, expected);
    if (verify) await verify(a, b);
    results.push({ name, status: 'PASS', codes, wait: JSON.parse(wait), readback });
    console.log(`${name}: PASS`);
  } finally {
    if (!a.state.ended) { a.child.kill('SIGTERM'); await a.done; }
    if (!b.state.ended) { b.child.kill('SIGTERM'); await b.done; }
    await Promise.all([a.persist(), b.persist()]);
    await writeFile(path.join(output, 'concurrency-results.json'), JSON.stringify(results, null, 2));
  }
}
let index = 0;
const unchanged = (f) => ({ assigned: f.actor, revision: 0, accepted: false, status: 'new', receipts: 0 });
const repaired = (f) => ({ assigned: f.target, revision: 1, accepted: false, status: 'new', receipts: 1 });
{
  const f = fixtures[index++];
  await race('identical-command', f, repair(f), repair(f), repaired(f), { verify: async (a, b) => {
    const receipt = (s) => JSON.parse(s.state.stdout.split('\n').find((line) => line.startsWith('{') && line.includes('recorded_revision')));
    assert.deepEqual(receipt(a), receipt(b), 'concurrent replay returns the same immutable receipt');
  } });
}
{
  const f = fixtures[index++];
  await race('stale-distinct-command', f, repair(f), repair(f, id(9001)), repaired(f), { errorCode: '40001' });
}
{
  const f = fixtures[index++];
  await race('replay-target-expires', f, repair(f) + 'RESET ROLE;' + monitor(f, f.target, "expires_at=clock_timestamp()+interval '150 milliseconds'"),
    repair(f), repaired(f), { delay: 220 });
}
const revocations = [
  ['actor-consent', (f) => `UPDATE public.consents SET accepted=false WHERE user_id='${f.actor}';`],
  ['patient-consent', (f) => `UPDATE public.consents SET accepted=false WHERE user_id='${f.patient}';`],
  ['target-consent', (f) => `UPDATE public.consents SET accepted=false WHERE user_id='${f.target}';`],
  ['organization', (f) => `UPDATE public.organizations SET status='suspended' WHERE id='${f.org}';`],
  ['actor-membership', (f) => membership(f, f.actor)],
  ['target-membership', (f) => membership(f, f.target)],
  ['actor-monitor', (f) => monitor(f, f.actor, 'revoked_at=now()')],
  ['target-monitor', (f) => monitor(f, f.target, 'revoked_at=now()')],
  ['actor-link', (f) => link(f, f.actor)],
  ['target-link', (f) => link(f, f.target)],
  ['patient-assignment', (f) => `UPDATE public.organization_patient_assignments SET status='revoked',revoked_at=now() WHERE organization_id='${f.org}' AND patient_id='${f.patient}';`],
  ['target-role', (f) => `UPDATE public.profiles SET role='patient' WHERE id='${f.target}';`],
];
for (const [name, revoke] of revocations) {
  const f = fixtures[index++];
  await race(`${name}-before-repair`, f, revoke(f), repair(f), unchanged(f), { errorCode: '42501' });
}
for (const [name, revoke] of revocations) {
  const f = fixtures[index++];
  await race(`repair-before-${name}`, f, repair(f), revoke(f), repaired(f));
}
{
  const f = fixtures[index++];
  await race('close-before-repair', f, `UPDATE public.work_items SET status='closed',outcome='Synthetic documented close',outcome_code='no_action_needed' WHERE id='${f.item}';`,
    repair(f), { ...unchanged(f), status: 'closed' }, { errorCode: '22023' });
}
{
  const f = fixtures[index++];
  await race('accept-before-repair', f, auth(f.actor) + `SELECT public.accept_work_item('${f.item}');`, repair(f),
    { ...unchanged(f), revision: 1, accepted: true }, { errorCode: '40001' });
}
// All ownership RPCs recheck the same authority after an actual row-lock wait.
for (const command of ['accept', 'offer', 'accept-transfer', 'decline', 'designate']) {
  const f = fixtures[index++];
  const isRecipient = command === 'accept-transfer' || command === 'decline';
  if (isRecipient) await sql(auth(f.actor) + `SELECT public.offer_work_item_transfer('${f.item}','${f.target}','Synthetic prepared offer');`);
  const user = isRecipient ? f.target : f.actor;
  const rpc = {
    accept: `SELECT public.accept_work_item('${f.item}');`,
    offer: `SELECT public.offer_work_item_transfer('${f.item}','${f.target}','Synthetic offer');`,
    'accept-transfer': `SELECT public.accept_work_item_transfer('${f.item}');`,
    decline: `SELECT public.decline_work_item_transfer('${f.item}','Synthetic decline');`,
    designate: `SELECT public.designate_patient_accountable('${f.org}','${f.patient}','${f.target}','Synthetic designation',false);`,
  }[command];
  await race(`${command}-after-monitor-expiry`, f, monitor(f, user, "expires_at=clock_timestamp()+interval '150 milliseconds'"), auth(user) + rpc,
    { ...unchanged(f), revision: isRecipient ? 1 : 0 }, { delay: 220, errorCode: '42501' });
}
{
  const f = fixtures[index++];
  await race('tester-erasure-before-repair', f, `UPDATE public.profiles SET role='tester',sandbox_expires_at=now()-interval '1 day' WHERE id='${f.actor}';
    SET ROLE service_role; SELECT set_config('request.jwt.claims','{"role":"service_role"}',false);
    SELECT * FROM public.purge_expired_tester_provenance('${f.actor}');`, repair(f), unchanged(f), { errorCode: '42501', verify: async () => {
      assert.equal(await sql(`SELECT count(*) FROM public.lab_provenance_erasures WHERE actor_id='${f.actor}';`), '1');
    } });
}
{
  const f = fixtures[index++];
  await race('repair-before-close', f, repair(f), `UPDATE public.work_items SET status='closed',outcome='Synthetic reviewed close',outcome_code='no_action_needed' WHERE id='${f.item}';`,
    { ...repaired(f), status: 'closed' });
}
{
  const f = fixtures[index++];
  await race('repair-before-tester-erasure', f, repair(f), `UPDATE public.profiles SET role='tester',sandbox_expires_at=now()-interval '1 day' WHERE id='${f.actor}';
    SET ROLE service_role; SELECT set_config('request.jwt.claims','{"role":"service_role"}',false);
    SELECT * FROM public.purge_expired_tester_provenance('${f.actor}');`, repaired(f), { verify: async () => {
      assert.equal(await sql(`SELECT count(*) FROM public.lab_provenance_erasures WHERE actor_id='${f.actor}';`), '1');
    } });
}
{
  const f = fixtures[index++];
  await race('offer-before-repair', f, auth(f.actor) + `SELECT public.offer_work_item_transfer('${f.item}','${f.target}','Synthetic offer');`, repair(f),
    { ...unchanged(f), revision: 1 }, { errorCode: '40001' });
}
{
  const f = fixtures[index++];
  await race('caller-revoked-before-context', f, link(f, f.actor), auth(f.actor) + `SELECT public.get_work_reassignment_context('${f.item}');`,
    unchanged(f), { errorCode: '42501' });
}
{
  const f = fixtures[index++];
  await race('context-before-caller-revoked', f, auth(f.actor) + `SELECT public.get_work_reassignment_context('${f.item}');`, link(f, f.actor), unchanged(f));
}
{
  const f = fixtures[index++];
  await race('context-after-monitor-expiry', f, monitor(f, f.actor, "expires_at=clock_timestamp()+interval '150 milliseconds'"),
    auth(f.actor) + `SELECT public.get_work_reassignment_context('${f.item}');`, unchanged(f), { delay: 220, errorCode: '42501' });
}
{
  const f = fixtures[index++];
  await race('context-after-concurrent-repair', f, repair(f), auth(f.actor) + `SELECT public.get_work_reassignment_context('${f.item}');`, repaired(f), { verify: async (_a, b) => {
    const context = JSON.parse(b.state.stdout.split('\n').find((line) => line.startsWith('{') && line.includes('current_revision')));
    assert.equal(context.current_revision, '1');
    assert.equal(context.current_assignee, f.target);
    assert.deepEqual(context.targets.map((target) => target.id), [f.actor]);
  } });
}
assert.equal(results.length, 42);
console.log(`PASS ${results.length} observed two-connection races; synthetic evidence preserved.`);
