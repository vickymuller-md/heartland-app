/** Actual two-session races, disposable local clone only. Never sends messages.
 * node scripts/test-care-workflow-concurrency.mjs SOCKET PORT DATABASE NEW_OUTPUT
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
  && /^n2p3o_care_races_[a-z0-9_]+$/.test(database ?? '') && path.isAbsolute(output ?? ''), 'Explicit local clone required');
const args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-h', socket, '-p', port, '-U', 'postgres', '-d', database];
const raw = async (sql) => (await run('/opt/homebrew/bin/psql', [...args, '-c', sql])).stdout.trim();
assert.equal(await raw('SHOW listen_addresses'), '');
assert.equal(await raw('SELECT count(*) FROM auth.users'), '0');
await mkdir(output);
const source = await readFile('supabase/tests/care_workflow_requests.sql', 'utf8');
const fixtures = source.match(/-- BEGIN CARE FIXTURES\n([\s\S]*?)-- END CARE FIXTURES/)[1];
const uuidHelper = fixtures.match(/CREATE FUNCTION pg_temp\.cw\([\s\S]*?\$\$;/)[0];
const prefix = `SET search_path=public,extensions; SET timezone='UTC'; ${uuidHelper}\n`;
async function capture(name, sql) {
  await writeFile(path.join(output, name + '.sql'), sql, { flag: 'wx' });
  const result = await raw(sql);
  await writeFile(path.join(output, name + '.stdout'), result, { flag: 'wx' });
  return result;
}
await capture('fixtures', `BEGIN; ${fixtures}
 INSERT INTO public.member_authorizations(membership_id,capability,granted_by)
 SELECT id,'clinical_disposition',pg_temp.cw(1) FROM public.organization_memberships
 WHERE organization_id=pg_temp.cw(90) AND user_id=pg_temp.cw(1); COMMIT;`);
const auth = `SET LOCAL ROLE authenticated;
 SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.cw(1),'aal','aal2')::text,true);`;
const payload = JSON.stringify({ kind: 'laboratory_order', source: 'external_documented',
  purpose: 'Synthetic race request', evidence: 'Synthetic test source only',
  occurred_at: new Date(Date.now() - 3600000).toISOString(), next_review_at: new Date(Date.now() + 86400000).toISOString(),
  analytes: ['potassium', 'creatinine', 'egfr'] });
const prepare = (n, clinical = false, changed = false) => `SELECT public.prepare_care_workflow_request(pg_temp.cw(${n}),pg_temp.cw(${n + 1000}),
 pg_temp.cw(90),pg_temp.cw(11),'${payload}'::jsonb${clinical ? `||'{"source":"professional_decision"}'` : ''}${changed ? `||'{"purpose":"Different synthetic request"}'` : ''});`;
const apply = (n) => `SELECT public.apply_care_workflow_request(pg_temp.cw(${n}));`;
const cancel = (n) => `SELECT public.cancel_care_workflow_request(pg_temp.cw(${n}));`;
const revokeLink = `UPDATE public.provider_patient_links SET status='revoked' WHERE provider_id=pg_temp.cw(1) AND patient_id=pg_temp.cw(11);`;
const revokeGrant = `UPDATE public.member_authorizations SET revoked_at=clock_timestamp() WHERE capability='clinical_disposition';`;
const suspendMember = `UPDATE public.organization_memberships SET status='suspended' WHERE organization_id=pg_temp.cw(90) AND user_id=pg_temp.cw(1);`;
const reset = `UPDATE public.provider_patient_links SET status='active' WHERE provider_id=pg_temp.cw(1) AND patient_id=pg_temp.cw(11);
 UPDATE public.member_authorizations SET revoked_at=NULL,expires_at=NULL WHERE capability='clinical_disposition';
 UPDATE public.organization_memberships SET status='active' WHERE organization_id=pg_temp.cw(90) AND user_id=pg_temp.cw(1);`;
const cases = [
  { name: 'prepare-replay', first: (n) => prepare(n), second: (n) => prepare(n), state: 'prepared', work: 0 },
  { name: 'prepare-conflicting-payload', first: (n) => prepare(n), second: (n) => prepare(n, false, true), secondCode: '23505', state: 'prepared', work: 0 },
  { name: 'apply-replay', prepared: true, first: apply, second: apply, state: 'applied', work: 1 },
  { name: 'apply-before-cancel', prepared: true, first: apply, second: cancel, state: 'applied', work: 1 },
  { name: 'cancel-before-apply', prepared: true, first: cancel, second: apply, secondCode: '22023', state: 'cancelled', work: 0 },
  { name: 'cancel-replay', prepared: true, first: cancel, second: cancel, state: 'cancelled', work: 0 },
  { name: 'apply-before-link-revocation', prepared: true, first: apply, second: () => revokeLink, secondAdmin: true, state: 'applied', work: 1 },
  { name: 'link-revocation-before-apply', prepared: true, first: () => revokeLink, firstAdmin: true, second: apply, secondCode: '42501', state: 'prepared', work: 0 },
  { name: 'apply-before-clinical-revocation', prepared: true, clinical: true, first: apply, second: () => revokeGrant, secondAdmin: true, state: 'applied', work: 1 },
  { name: 'clinical-revocation-before-apply', prepared: true, clinical: true, first: () => revokeGrant, firstAdmin: true, second: apply, secondCode: '42501', state: 'prepared', work: 0 },
  { name: 'member-suspended-before-apply', prepared: true, first: () => suspendMember, firstAdmin: true, second: apply, secondCode: '42501', state: 'prepared', work: 0 },
  { name: 'clinical-expiry-during-wait', prepared: true, clinical: true, expires: true, firstAdmin: true,
    first: () => `SELECT pg_advisory_xact_lock(hashtextextended('heartland:work-ownership:'||pg_temp.cw(90)||':'||pg_temp.cw(11),0));`,
    second: apply, secondCode: '42501', state: 'prepared', work: 0 },
];
function session(label) {
  const child = spawn('/opt/homebrew/bin/psql', args, { stdio: 'pipe' });
  const state = { sql: '', stdout: '', stderr: '', ended: false };
  child.stdout.on('data', (chunk) => { state.stdout += chunk; });
  child.stderr.on('data', (chunk) => { state.stderr += chunk; });
  const done = new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', (code) => { state.ended = true; resolve(code); }); });
  return { child, state, done,
    send(sql, end = false) { state.sql += sql; if (end) child.stdin.end(sql); else child.stdin.write(sql); },
    async persist() { for (const field of ['sql', 'stdout', 'stderr']) await writeFile(path.join(output, `${label}.${field}`), state[field], { flag: 'wx' }); },
  };
}
async function until(test, name) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (await test()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Timed out: ' + name);
}
const results = [];
for (const [index, test] of cases.entries()) {
  const n = 300 + index;
  await capture(test.name + '-prepare', `${prefix} BEGIN; ${reset}
   ${test.expires ? `UPDATE public.member_authorizations SET expires_at=clock_timestamp()+interval '2 seconds' WHERE capability='clinical_disposition';` : ''}
   ${test.prepared ? auth + prepare(n, test.clinical) : ''} COMMIT;`);
  const a = session(test.name + '-a'); const b = session(test.name + '-b');
  let blocking;
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
      if (b.state.ended) throw new Error(b.state.stderr || 'Contender failed to wait');
      const row = await raw(`SELECT json_build_object('pid',pid,'blockers',pg_blocking_pids(pid),'wait',wait_event)
        FROM pg_stat_activity WHERE pid=${contender} AND ${holder}=ANY(pg_blocking_pids(pid));`);
      if (row) blocking = JSON.parse(row);
      return Boolean(blocking);
    }, test.name + ' blocking edge');
    if (test.expires) await new Promise((resolve) => setTimeout(resolve, 2200));
    a.send('COMMIT;\n', true);
    const codes = await Promise.all([a.done, b.done]);
    assert.deepEqual(codes, [0, test.secondCode ? 3 : 0], a.state.stderr + b.state.stderr);
    if (test.secondCode) assert.match(b.state.stderr, new RegExp(test.secondCode));
    const read = await capture(test.name + '-readback', `${prefix} SELECT json_build_object(
      'state',(SELECT state FROM public.care_workflow_requests WHERE id=pg_temp.cw(${n})),
      'work',(SELECT count(*) FROM public.care_workflows WHERE work_item_id=pg_temp.cw(${n + 1000})),
      'events',(SELECT count(*) FROM public.care_workflow_events WHERE work_item_id=pg_temp.cw(${n + 1000})),
      'context',(SELECT count(*) FROM public.care_workflow_write_context));`);
    const readback = JSON.parse(read);
    assert.deepEqual(readback, { state: test.state, work: test.work, events: test.work, context: 0 });
    results.push({ name: test.name, codes, blocking, readback, ok: true });
    console.log(test.name + ': PASS');
  } finally {
    if (!a.state.ended) a.child.kill('SIGTERM');
    if (!b.state.ended) b.child.kill('SIGTERM');
    await Promise.all([a.done, b.done]);
    await Promise.all([a.persist(), b.persist()]);
    await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
  }
}
await capture('restore-fixture-eligibility', prefix + reset);
for (const isolation of ['REPEATABLE READ', 'SERIALIZABLE']) {
  const s = session('isolation-' + isolation.toLowerCase().replaceAll(' ', '-'));
  s.send(`${prefix} BEGIN ISOLATION LEVEL ${isolation}; ${auth} ${prepare(500)} COMMIT;\n`, true);
  assert.equal(await s.done, 3); assert.match(s.state.stderr, /25001/); await s.persist();
  results.push({ name: isolation + ' rejected', ok: true });
}
const migration = await readFile('supabase/migrations/00059_care_workflow_requests.sql');
await writeFile(path.join(output, 'completion.json'), JSON.stringify({ database, timestamp: new Date().toISOString(),
  migration_sha256: createHash('sha256').update(migration).digest('hex'), race_count: cases.length,
  isolation_checks: 2, all_ok: results.every((row) => row.ok) }, null, 2), { flag: 'wx' });
console.log('All local care-request races passed.');
