/** Two actual PostgreSQL connections; isolated synthetic clone, never hosted.
 * node scripts/test-notification-retention-concurrency.mjs SOCKET PORT DATABASE NEW_OUTPUT
 * Exact queries, blocking edges, hashes and readbacks are preserved for review.
 */
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import path from 'node:path';
const run = promisify(execFile);
const [socket, port, database, output] = process.argv.slice(2);
assert.ok(socket?.startsWith('/private/tmp/hl-') && /^\d+$/.test(port ?? '')
  && /^n2p3n_retention_races_[a-z0-9_]+$/.test(database ?? '') && path.isAbsolute(output ?? ''), 'Explicit local clone and output required');
const psql = '/opt/homebrew/bin/psql';
const args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-h', socket, '-p', port, '-U', 'postgres', '-d', database];
const raw = async (query) => (await run(psql, [...args, '-c', query], { maxBuffer: 8 * 1024 * 1024 })).stdout.trim();
assert.equal(await raw('SHOW listen_addresses'), '', 'TCP must be disabled');
assert.equal(await raw('SELECT count(*) FROM auth.users'), '0', 'Empty synthetic clone required');
await mkdir(output);
const suiteFile = 'supabase/tests/synthetic_notification_retention.sql';
const migrationFile = 'supabase/migrations/00058_synthetic_notification_retention.sql';
const suite = await readFile(suiteFile, 'utf8');
const uuidHelper = suite.match(/CREATE FUNCTION pg_temp.nr[\s\S]*?\$\$;/)?.[0];
const helperBlock = suite.split('-- HELPERS BEGIN:')[1]?.split('\n').slice(1).join('\n').split('-- HELPERS END')[0];
const fixtureBlock = suite.split('-- FIXTURE BEGIN:')[1]?.split('\n').slice(1).join('\n').split('-- FIXTURE END')[0];
assert.ok(uuidHelper && helperBlock && fixtureBlock, 'Bounded fixture/helper markers required');
const service = `SELECT set_config('request.jwt.claims','{"role":"service_role"}',false);`;
const prefix = uuidHelper + helperBlock + service;
const sql = (query) => raw(prefix + query);
async function capture(label, query, withHelpers = true) {
  const input = (withHelpers ? prefix : '') + query;
  await writeFile(path.join(output, `${label}.sql`), input, { flag: 'wx' });
  const result = await run(psql, [...args, '-c', input], { maxBuffer: 8 * 1024 * 1024 });
  await writeFile(path.join(output, `${label}.stdout`), result.stdout, { flag: 'wx' });
  await writeFile(path.join(output, `${label}.stderr`), result.stderr, { flag: 'wx' });
  return result.stdout.trim();
}
await writeFile(path.join(output, 'bindings.json'), JSON.stringify({ database, socket, port, startedAt: new Date().toISOString(),
  hashes: Object.fromEntries(await Promise.all([suiteFile, migrationFile, 'scripts/test-notification-retention-concurrency.mjs'].map(async (file) =>
    [file, createHash('sha256').update(await readFile(file)).digest('hex')]))),
}, null, 2), { flag: 'wx' });
// Two work items start warning, so escalation actually captures their FIRST intent.
const raceFixtures = fixtureBlock.replace("'critical',ARRAY['weight_gain_3lb_2d']",
  "CASE WHEN n IN(116,117) THEN 'warning' ELSE 'critical' END,ARRAY['weight_gain_3lb_2d']");
assert.notEqual(raceFixtures, fixtureBlock);
await capture('fixtures', `BEGIN; ${uuidHelper} ${raceFixtures} COMMIT;`, false);
const erase = (n) => `SELECT 'ERASE:'||pg_temp.erase(${n});`;
const age = (n) => `SELECT pg_temp.age(${n},interval '31 days');`;
const close = (n) => `SELECT pg_temp.close_work(${n});`;
const coalesce = (n) => `UPDATE public.alerts SET occurrence_count=occurrence_count+1,last_seen_at=clock_timestamp() WHERE id=pg_temp.nr(${n});`;
const auth = (n) => `SELECT set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.nr(${n}),'role','authenticated','aal','aal2')::text,true);`;
const transfer = (n) => auth(2) + `SELECT public.accept_work_item_transfer(pg_temp.work(${n}));`;
const profileLock = () => 'SELECT id FROM public.profiles WHERE id=pg_temp.nr(1) FOR UPDATE;';
const profileDelete = () => 'DELETE FROM public.profiles WHERE id=pg_temp.nr(1);';
const escalate = (n) => `UPDATE public.alerts SET severity='critical',last_seen_at=clock_timestamp() WHERE id=pg_temp.nr(${n});`;
const scenarios = [
  { name: 'purge-before-claim', n: 101, setup: (n) => close(n) + age(n), first: erase,
    second: (n) => `SELECT public.claim_notification_dispatch(pg_temp.intent(${n}));`, skips: true, intents: 0 },
  { name: 'claim-before-purge', n: 102, setup: (n) => close(n) + age(n),
    first: (n) => `SELECT public.claim_notification_dispatch(pg_temp.intent(${n}));`, second: erase, intents: 0 },
  { name: 'start-before-purge', n: 103, setup: (n) => `SELECT pg_temp.prepare(${n});`,
    first: (n) => `SELECT pg_temp.start(${n});`, second: erase, intents: 1, attempt: 'sending' },
  { name: 'purge-before-start', n: 104, setup: (n) => `SELECT pg_temp.prepare(${n});` + close(n) + age(n),
    first: erase, second: (n) => `SELECT pg_temp.start(${n});`, skips: true, intents: 0 },
  { name: 'finish-before-purge', n: 105, setup: (n) => `SELECT pg_temp.prepare(${n}); SELECT pg_temp.start(${n});` + close(n),
    first: (n) => `SELECT pg_temp.finish(${n},'accepted','accepted',201);`, second: erase, intents: 1, attempt: 'accepted' },
  { name: 'purge-before-finish', n: 106, setup: (n) => `SELECT pg_temp.prepare(${n}); SELECT pg_temp.start(${n});` + close(n),
    first: erase, second: (n) => `SELECT pg_temp.finish(${n},'accepted','accepted',201);`, intents: 1, attempt: 'accepted' },
  { name: 'close-before-purge', n: 107, first: close, second: erase, intents: 1 },
  { name: 'purge-before-close', n: 108, first: erase, second: close, intents: 1 },
  { name: 'signal-before-purge', n: 109, setup: (n) => close(n) + age(n), first: coalesce, second: erase, intents: 1, routing: 1 },
  { name: 'purge-before-signal', n: 110, setup: (n) => close(n) + age(n), first: erase, second: coalesce, intents: 0, routing: 1 },
  { name: 'transfer-before-purge', n: 111, offer: true, first: transfer, second: erase, intents: 2 },
  { name: 'purge-before-transfer', n: 112, offer: true, first: erase, second: transfer, intents: 2 },
  { name: 'hold-before-purge', n: 113, setup: (n) => close(n) + age(n),
    first: (n) => `SELECT public.set_synthetic_notification_hold(pg_temp.work(${n}),true);`, second: erase, intents: 1 },
  { name: 'purge-before-hold', n: 114, setup: (n) => close(n) + age(n),
    first: erase, second: (n) => `SELECT public.set_synthetic_notification_hold(pg_temp.work(${n}),true);`, intents: 0 },
  { name: 'purge-before-purge', n: 115, setup: (n) => close(n) + age(n), first: erase, second: erase, intents: 0 },
  { name: 'capture-before-profile-delete', n: 116, first: escalate, second: profileDelete, codes: [0, 3], intents: 1 },
  { name: 'profile-delete-before-capture', n: 117, first: profileLock, second: escalate,
    afterWait: profileDelete, skips: true, codes: [3, 0], intents: 1 },
  { name: 'transfer-before-profile-delete', n: 118, offer: true, first: transfer, second: profileDelete, codes: [0, 3], intents: 2 },
  { name: 'profile-delete-before-transfer', n: 119, offer: true, first: profileLock, second: transfer,
    afterWait: profileDelete, codes: [3, 0], intents: 2 },
];
function session(label) {
  const child = spawn(psql, args, { stdio: 'pipe' });
  const state = { input: '', stdout: '', stderr: '', ended: false };
  child.stdout.on('data', (v) => { state.stdout += v; });
  child.stderr.on('data', (v) => { state.stderr += v; });
  const done = new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', (code) => { state.ended = true; resolve(code); }); });
  return { child, state, done,
    send(query, end = false) { state.input += query; if (end) child.stdin.end(query); else child.stdin.write(query); },
    async persist() { await Promise.all(['input', 'stdout', 'stderr'].map((key) => writeFile(
      path.join(output, `${label}.${key === 'input' ? 'sql' : key}`), state[key], { flag: 'wx' }))); },
  };
}
async function until(test, label) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) { if (await test()) return; await new Promise((resolve) => setTimeout(resolve, 25)); }
  throw new Error(`Timed out: ${label}`);
}
const results = [];
for (const s of scenarios) {
  const n = s.n;
  await capture(`${s.name}-setup`, `BEGIN; SELECT pg_temp.enroll(${n}); ${s.setup?.(n) ?? ''}
    ${s.offer ? auth(1) + `SELECT public.offer_work_item_transfer(pg_temp.work(${n}),pg_temp.nr(2),'Synthetic handover');` : ''} COMMIT;`);
  // Stable work ID is resolved before transfer or erasure changes projections.
  const work = (await sql(`SELECT 'WORK:'||pg_temp.work(${n});`)).match(/WORK:([0-9a-f-]{36})/)?.[1];
  assert.ok(work);
  const a = session(`${s.name}-a`), b = session(`${s.name}-b`);
  let wait = null, codes, readback;
  try {
    a.send(`${prefix} SELECT 'PID:'||pg_backend_pid(); BEGIN; SET LOCAL statement_timeout='12s'; ${s.first(n)}\n\\echo HOLDING\n`);
    await until(() => { if (a.state.ended) throw new Error(a.state.stderr); return a.state.stdout.includes('HOLDING'); }, s.name + ' holder');
    const holder = Number(a.state.stdout.match(/PID:(\d+)/)?.[1]); assert.ok(holder);
    // Exact target, including after transfer when pg_temp.work(n) no longer uses owner1.
    const second = s.second === erase ? `SELECT 'ERASE:'||(public.erase_synthetic_notification_work('${work}','authorized_synthetic_erasure')->>'status');` : s.second(n);
    b.send(`${prefix} SELECT 'PID:'||pg_backend_pid(); BEGIN; SET LOCAL statement_timeout='12s'; ${second} COMMIT;\n`, true);
    if (s.skips) {
      await until(() => b.state.ended, s.name + ' skip-locked return');
    } else {
      await until(() => /PID:\d+/.test(b.state.stdout), s.name + ' contender PID');
      const contender = Number(b.state.stdout.match(/PID:(\d+)/)?.[1]);
      await until(async () => {
        if (b.state.ended) throw new Error(b.state.stderr || 'Contender did not wait');
        const row = await raw(`SELECT json_build_object('pid',pid,'blockers',pg_blocking_pids(pid),'wait',wait_event,'query',query)
          FROM pg_stat_activity WHERE pid=${contender} AND ${holder}=ANY(pg_blocking_pids(pid));`);
        if (row) wait = JSON.parse(row); return Boolean(wait);
      }, s.name + ' blocking edge');
    }
    a.send(`${s.afterWait?.(n) ?? ''} COMMIT;\n`, true);
    codes = await Promise.all([a.done, b.done]); assert.deepEqual(codes, s.codes ?? [0, 0], a.state.stderr + b.state.stderr);
    if (s.codes) assert.match(a.state.stderr + b.state.stderr, /23503.*Notification subject evidence requires explicit disposition/s);
    const read = await capture(`${s.name}-readback`, `SELECT 'READ:'||json_build_object(
      'work_exists',EXISTS(SELECT 1 FROM public.work_items WHERE id='${work}'),
      'source_exists',EXISTS(SELECT 1 FROM public.notification_source_state WHERE alert_id=pg_temp.nr(${n})),
      'intents',(SELECT count(*) FROM public.notification_intents WHERE work_item_id='${work}'),
      'attempts',(SELECT COALESCE(json_agg(a.state),'[]') FROM public.notification_dispatch_attempts a JOIN public.notification_intents i ON i.id=a.intent_id WHERE i.work_item_id='${work}'),
      'routing',(SELECT count(*) FROM public.notification_routing_exceptions WHERE work_item_id='${work}'),
      'erased',(SELECT erased_at IS NOT NULL FROM public.notification_retention_scopes WHERE work_item_id='${work}'),
      'owner_exists',EXISTS(SELECT 1 FROM public.profiles WHERE id=pg_temp.nr(1)),
      'subject_audits',(SELECT count(*) FROM public.lab_provenance_erasures WHERE actor_id=pg_temp.nr(1)),
      'scope_leaks',(SELECT count(*) FROM public.notification_erasure_context));`);
    readback = JSON.parse(read.split('READ:')[1]);
    assert.equal(readback.work_exists, true); assert.equal(readback.source_exists, true);
    assert.equal(readback.intents, s.intents); assert.equal(readback.routing, s.routing ?? 0);
    assert.equal(readback.erased, s.intents === 0); assert.equal(readback.scope_leaks, 0);
    assert.equal(readback.owner_exists, true); assert.equal(readback.subject_audits, 0);
    if (s.attempt) assert.deepEqual(readback.attempts, [s.attempt]);
    if (s.name === 'purge-before-purge') assert.match(b.state.stdout, /already_erased/);
    results.push({ name: s.name, status: 'PASS', codes, wait, readback }); console.log(`${s.name}: PASS`);
  } catch (error) {
    results.push({ name: s.name, status: 'FAIL', codes, wait, readback, error: String(error) }); throw error;
  } finally {
    if (!a.state.ended) { a.child.kill('SIGTERM'); await a.done; }
    if (!b.state.ended) { b.child.kill('SIGTERM'); await b.done; }
    await Promise.all([a.persist(), b.persist()]);
    await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
  }
}
// Separate transactions are necessary: isolation cannot be changed after a
// pgTAP suite has queried data. Rejections are actual SQL execution, not text checks.
for (const isolation of ['REPEATABLE READ', 'SERIALIZABLE']) {
  for (const [kind, query] of [
    ['preflight', "SELECT public.check_synthetic_notification_erasure(pg_temp.work(120),'retention_expired');"],
    ['profile-delete', profileDelete()],
  ]) {
    const name = `${isolation.toLowerCase().replace(' ', '-')}-${kind}`;
    const input = `${prefix} BEGIN ISOLATION LEVEL ${isolation}; ${query} COMMIT;`;
    await writeFile(path.join(output, `${name}.sql`), input, { flag: 'wx' });
    let failure;
    // Separate -c calls commit helper DDL before setting transaction isolation.
    try { await run(psql, [...args, '-c', prefix, '-c', `BEGIN ISOLATION LEVEL ${isolation}; ${query} COMMIT;`]); } catch (error) { failure = error; }
    await writeFile(path.join(output, `${name}.stderr`), failure?.stderr ?? 'No SQL error returned', { flag: 'wx' });
    assert.equal(failure?.code, 1, 'psql -c must report SQL failure');
    assert.match(failure.stderr, /25001.*Notification lifecycle requires READ COMMITTED/s);
    results.push({ name, status: 'PASS', expectedRejection: '25001' }); console.log(`${name}: PASS`);
  }
}
await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
await writeFile(path.join(output, 'completion.json'), JSON.stringify({ passed: results.length, completedAt: new Date().toISOString(), database }), { flag: 'wx' });
