/** Disposable local PostgreSQL only. Actual blocking pairs, no external services.
 * node scripts/test-care-step-concurrency.mjs SOCKET PORT DATABASE NEW_OUTPUT
 */
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
const run = promisify(execFile);
const [socket, port, database, output] = process.argv.slice(2);
assert.ok(socket?.startsWith('/private/tmp/hl-') && /^\d+$/.test(port ?? '')
  && /^n2p3p_steps_races_[a-z0-9_]+$/.test(database ?? '') && path.isAbsolute(output ?? ''), 'Explicit local clone required');
const args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-h', socket, '-p', port, '-U', 'postgres', '-d', database];
const raw = async (sql) => (await run('/opt/homebrew/bin/psql', [...args, '-c', sql])).stdout.trim();
assert.equal(await raw('SHOW listen_addresses'), '');
assert.equal(await raw('SELECT count(*) FROM auth.users'), '0');
await mkdir(output);
const source = await readFile('supabase/tests/care_workflow_steps.sql', 'utf8');
const fixtures = source.match(/-- BEGIN STEP FIXTURES\n([\s\S]*?)-- END STEP FIXTURES/)[1];
const uuidHelper = fixtures.match(/CREATE FUNCTION pg_temp\.cs\([\s\S]*?\$\$;/)[0];
const helpers = source.match(/-- BEGIN STEP HELPERS\n([\s\S]*?)-- END STEP HELPERS/)[1];
const prefix = `SET search_path=public,extensions; SET timezone='UTC'; ${uuidHelper} ${helpers}\n`;
async function capture(name, sql) {
  await writeFile(path.join(output, name + '.sql'), sql, { flag: 'wx' });
  const result = await raw(sql);
  await writeFile(path.join(output, name + '.stdout'), result, { flag: 'wx' });
  return result;
}
await capture('fixtures', `BEGIN; ${fixtures} COMMIT;`);
const auth = `SET LOCAL ROLE authenticated;
 SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.cs(1),'aal','aal2')::text,true);`;
const payload = JSON.stringify({ occurred_at: new Date(Date.now() - 3600000).toISOString(),
  evidence: 'Synthetic step race evidence', next_action: 'Review synthetic follow-up',
  next_review_at: new Date(Date.now() + 86400000).toISOString(), details: {} });
const prepare = (n, changed = false) => `SELECT public.prepare_care_step(pg_temp.cs(${n + 2000}),pg_temp.cs(${n}),1,1,
 'record_collection','${payload}'::jsonb${changed ? `||'{"evidence":"Changed synthetic evidence"}'` : ''});`;
const apply = (n) => `SELECT public.apply_care_step(pg_temp.cs(${n + 2000}));`;
const cancel = (n) => `SELECT public.cancel_care_step(pg_temp.cs(${n + 2000}));`;
const offer = (n) => `SELECT public.offer_work_item_transfer(pg_temp.cs(${n}),pg_temp.cs(2));`;
const reassign = (n) => `SELECT public.reassign_work_item_recoverable(pg_temp.cs(${n + 3000}),pg_temp.cs(${n}),pg_temp.cs(1),1,pg_temp.cs(2),'Synthetic race reassignment');`;
const revokeLink = `UPDATE public.provider_patient_links SET status='revoked' WHERE provider_id=pg_temp.cs(1) AND patient_id=pg_temp.cs(11);`;
const revokeMonitor = `UPDATE public.member_authorizations SET revoked_at=clock_timestamp() WHERE capability='monitor'
 AND membership_id IN(SELECT id FROM public.organization_memberships WHERE user_id=pg_temp.cs(1) AND organization_id=pg_temp.cs(90));`;
const revokeConsent = `UPDATE public.consents SET accepted=false WHERE user_id=pg_temp.cs(1) AND consent_type='registration';`;
const suspendMember = `UPDATE public.organization_memberships SET status='suspended' WHERE organization_id=pg_temp.cs(90) AND user_id=pg_temp.cs(1);`;
const reset = `UPDATE public.provider_patient_links SET status='active' WHERE provider_id=pg_temp.cs(1) AND patient_id=pg_temp.cs(11);
 UPDATE public.member_authorizations SET revoked_at=NULL,expires_at=NULL WHERE capability='monitor';
 UPDATE public.consents SET accepted=true WHERE user_id=pg_temp.cs(1) AND consent_type='registration';
 UPDATE public.organization_memberships SET status='active' WHERE organization_id=pg_temp.cs(90) AND user_id=pg_temp.cs(1);`;
const holdScope = () => `SELECT pg_advisory_xact_lock(hashtextextended('heartland:work-ownership:'||pg_temp.cs(90)||':'||pg_temp.cs(11),0));`;
const barrier = (n, offset, revision = 1) => `SELECT public.prepare_care_step(pg_temp.cs(${n + offset}),pg_temp.cs(${n}),${revision},1,
 'record_exception','${payload}'::jsonb||jsonb_build_object('details',jsonb_build_object(
  'exception_id',pg_temp.cs(${n + offset + 5000}),'code','no_answer','reason','Synthetic concurrent barrier')));`;
const cases = [
  { name: 'prepare-replay', first: prepare, second: prepare, state: 'prepared' },
  { name: 'prepare-conflict', first: prepare, second: (n) => prepare(n, true), secondCode: '23505', state: 'prepared' },
  { name: 'apply-replay', prepared: true, first: apply, second: apply, state: 'applied' },
  { name: 'apply-before-cancel', prepared: true, first: apply, second: cancel, state: 'applied' },
  { name: 'cancel-before-apply', prepared: true, first: cancel, second: apply, secondCode: '22023', state: 'cancelled' },
  { name: 'cancel-replay', prepared: true, first: cancel, second: cancel, state: 'cancelled' },
  { name: 'apply-before-transfer-offer', prepared: true, first: apply, second: offer, state: 'applied' },
  { name: 'transfer-offer-before-apply', prepared: true, first: offer, second: apply, secondCode: '42501', state: 'prepared' },
  { name: 'apply-before-reassignment', prepared: true, reassignment: true, first: apply, second: reassign, state: 'applied' },
  { name: 'reassignment-before-apply', prepared: true, reassignment: true, first: reassign, second: apply, secondCode: '42501', state: 'prepared' },
  { name: 'apply-before-link-revocation', prepared: true, first: apply, second: () => revokeLink, secondAdmin: true, state: 'applied' },
  { name: 'link-revocation-before-apply', prepared: true, first: () => revokeLink, firstAdmin: true, second: apply, secondCode: '42501', state: 'prepared' },
  { name: 'apply-before-monitor-revocation', prepared: true, first: apply, second: () => revokeMonitor, secondAdmin: true, state: 'applied' },
  { name: 'monitor-revocation-before-apply', prepared: true, first: () => revokeMonitor, firstAdmin: true, second: apply, secondCode: '42501', state: 'prepared' },
  { name: 'consent-revocation-before-apply', prepared: true, first: () => revokeConsent, firstAdmin: true, second: apply, secondCode: '42501', state: 'prepared' },
  { name: 'membership-suspended-before-apply', prepared: true, first: () => suspendMember, firstAdmin: true, second: apply, secondCode: '42501', state: 'prepared' },
  { name: 'monitor-expiry-during-wait', prepared: true, expiry: 'monitor', first: holdScope, firstAdmin: true, second: apply, secondCode: '42501', state: 'prepared' },
  { name: 'deadline-expiry-during-wait', prepared: true, expiry: 'deadline', first: holdScope, firstAdmin: true, second: apply, secondCode: '22023', state: 'prepared' },
  { name: 'concurrent-exceptions-preserve-first', first: (n) => barrier(n, 2000) + apply(n),
    second: (n) => barrier(n, 4000), secondCode: '40001', state: 'applied', barrier: true },
];
function session(label) {
  const child = spawn('/opt/homebrew/bin/psql', args, { stdio: 'pipe' });
  const state = { sql: '', stdout: '', stderr: '', ended: false };
  child.stdout.on('data', (chunk) => { state.stdout += chunk; }); child.stderr.on('data', (chunk) => { state.stderr += chunk; });
  const done = new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', (code) => { state.ended = true; resolve(code); }); });
  return { child, state, done,
    send(sql, end = false) { state.sql += sql; if (end) child.stdin.end(sql); else child.stdin.write(sql); },
    async persist() { for (const field of ['sql', 'stdout', 'stderr']) await writeFile(path.join(output, `${label}.${field}`), state[field], { flag: 'wx' }); },
  };
}
async function until(test, name) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) { if (await test()) return; await new Promise((resolve) => setTimeout(resolve, 25)); }
  throw new Error('Timed out: ' + name);
}
const results = [];
for (const [index, test] of cases.entries()) {
  const n = 300 + index;
  await capture(test.name + '-prepare', `${prefix} BEGIN; ${reset} ${auth} SELECT pg_temp.cs_new(${n});
   ${test.reassignment ? `SELECT public.prepare_work_reassignment(pg_temp.cs(${n + 3000}),pg_temp.cs(${n}),pg_temp.cs(1),1,pg_temp.cs(2),'Synthetic race reassignment');` : ''}
   ${test.prepared ? test.expiry === 'deadline'
    ? `SELECT public.prepare_care_step(pg_temp.cs(${n + 2000}),pg_temp.cs(${n}),1,1,'record_collection',
      '${payload}'::jsonb||jsonb_build_object('next_review_at',pg_temp.cs_instant(clock_timestamp()+interval '2 seconds')));`
    : prepare(n) : ''} RESET ROLE;
   ${test.expiry === 'monitor' ? `UPDATE public.member_authorizations SET expires_at=clock_timestamp()+interval '2 seconds' WHERE capability='monitor'
    AND membership_id IN(SELECT id FROM public.organization_memberships WHERE user_id=pg_temp.cs(1) AND organization_id=pg_temp.cs(90));` : ''} COMMIT;`);
  const a = session(test.name + '-a'); const b = session(test.name + '-b'); let blocking;
  try {
    a.send(`${prefix} SELECT 'PID:'||pg_backend_pid(); BEGIN; SET LOCAL statement_timeout='12s';
      ${test.firstAdmin ? '' : auth} ${test.first(n)}\n\\echo HOLDING\n`);
    await until(() => { if (a.state.ended) throw new Error(a.state.stderr); return a.state.stdout.includes('HOLDING'); }, test.name + ' holder');
    const holder = Number(a.state.stdout.match(/PID:(\d+)/)?.[1]); assert.ok(holder);
    b.send(`${prefix} SELECT 'PID:'||pg_backend_pid(); BEGIN; SET LOCAL statement_timeout='12s';
      ${test.secondAdmin ? '' : auth} ${test.second(n)} COMMIT;\n`, true);
    await until(() => /PID:\d+/.test(b.state.stdout), test.name + ' contender');
    const contender = Number(b.state.stdout.match(/PID:(\d+)/)?.[1]);
    await until(async () => {
      if (b.state.ended) throw new Error(b.state.stderr || 'Contender did not wait');
      const row = await raw(`SELECT json_build_object('pid',pid,'blockers',pg_blocking_pids(pid),'wait',wait_event)
       FROM pg_stat_activity WHERE pid=${contender} AND ${holder}=ANY(pg_blocking_pids(pid));`);
      if (row) blocking = JSON.parse(row); return Boolean(blocking);
    }, test.name + ' blocking edge');
    if (test.expiry) await new Promise((resolve) => setTimeout(resolve, 2200));
    a.send('COMMIT;\n', true);
    const codes = await Promise.all([a.done, b.done]); assert.deepEqual(codes, [0, test.secondCode ? 3 : 0], a.state.stderr + b.state.stderr);
    if (test.secondCode) assert.match(b.state.stderr, new RegExp(test.secondCode));
    const readback = JSON.parse(await capture(test.name + '-readback', `${prefix} SELECT json_build_object(
     'state',(SELECT state FROM public.care_step_requests WHERE id=pg_temp.cs(${n + 2000})),
     'revision',(SELECT revision FROM public.care_workflows WHERE work_item_id=pg_temp.cs(${n})),
     'stage',(SELECT stage FROM public.care_workflows WHERE work_item_id=pg_temp.cs(${n})),
     'events',(SELECT count(*) FROM public.care_step_events WHERE work_item_id=pg_temp.cs(${n})),
     'context',(SELECT count(*) FROM public.care_workflow_write_context));`));
    const applied = test.state === 'applied';
    assert.deepEqual(readback, { state: test.state, revision: applied ? 2 : 1,
      stage: applied && !test.barrier ? 'collected' : 'requested', events: applied ? 1 : 0, context: 0 });
    if (test.barrier) {
      // After the explicit revision conflict, a fresh command records the second
      // independent barrier; it must not replace or resolve the first one.
      await capture(test.name + '-fresh-second', `${prefix} BEGIN; ${auth} ${barrier(n, 4000, 2)}
        SELECT public.apply_care_step(pg_temp.cs(${n + 4000})); COMMIT;`);
      const barriers = JSON.parse(await capture(test.name + '-barriers', `${prefix} SELECT jsonb_build_object(
        'count',(SELECT count(*) FROM public.care_workflow_exceptions WHERE work_item_id=pg_temp.cs(${n})),
        'identities',(SELECT count(DISTINCT origin_event_id) FROM public.care_workflow_exceptions WHERE work_item_id=pg_temp.cs(${n})),
        'revision',(SELECT revision FROM public.care_workflows WHERE work_item_id=pg_temp.cs(${n})));`));
      assert.deepEqual(barriers, { count: 2, identities: 2, revision: 3 });
      readback.concurrent_barriers = barriers;
    }
    results.push({ name: test.name, codes, blocking, readback, ok: true }); console.log(test.name + ': PASS');
  } finally {
    if (!a.state.ended) a.child.kill('SIGTERM'); if (!b.state.ended) b.child.kill('SIGTERM');
    await Promise.all([a.done, b.done]); await Promise.all([a.persist(), b.persist()]);
    await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
  }
}
await capture('restore-fixture-eligibility', prefix + reset);
for (const isolation of ['REPEATABLE READ', 'SERIALIZABLE']) {
  const s = session('isolation-' + isolation.toLowerCase().replaceAll(' ', '-'));
  s.send(`${prefix} BEGIN ISOLATION LEVEL ${isolation}; ${auth} SELECT public.get_care_step_request(pg_temp.cs(2300)); COMMIT;\n`, true);
  assert.equal(await s.done, 3); assert.match(s.state.stderr, /25001/); await s.persist();
}
const hashes = {};
for (const filename of ['supabase/migrations/00060_care_workflow_steps.sql', 'supabase/tests/care_workflow_steps.sql', 'scripts/test-care-step-concurrency.mjs']) {
  hashes[filename] = createHash('sha256').update(await readFile(filename)).digest('hex');
}
await writeFile(path.join(output, 'completion.json'), JSON.stringify({ database, timestamp: new Date().toISOString(), hashes,
  race_count: cases.length, isolation_checks: 2, all_ok: results.every((row) => row.ok) }, null, 2), { flag: 'wx' });
console.log('All local care-step races passed.');
