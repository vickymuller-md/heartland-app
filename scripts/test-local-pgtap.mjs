/** Read repository suites, run each rolled-back transaction, preserve exact output.
 * node scripts/test-local-pgtap.mjs SOCKET PORT DATABASE NEW_OUTPUT_DIRECTORY
 * Local Unix socket and an empty synthetic rehearsal database only.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';

const run = promisify(execFile);
const [socket, port, database, output] = process.argv.slice(2);
assert.ok(socket?.startsWith('/private/tmp/hl-') && /^\d+$/.test(port ?? '')
  && /^n2p3[a-z]_[a-z0-9_]+$/.test(database ?? '') && path.isAbsolute(output ?? ''), 'Explicit local rehearsal parameters required');
const args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', socket, '-p', port, '-U', 'postgres', '-d', database];
const sql = async (query) => (await run('/opt/homebrew/bin/psql', [...args, '-c', query])).stdout.trim();
assert.equal(await sql('SHOW listen_addresses'), '', 'TCP must be disabled');
assert.equal(await sql('SELECT count(*) FROM auth.users'), '0', 'Fixture database must start empty');
await mkdir(output); // Refuse overwriting an earlier evidence directory.
const results = [];
for (const filename of (await readdir('supabase/tests')).filter((name) => name.endsWith('.sql')).sort()) {
  const source = path.resolve('supabase/tests', filename);
  const contents = await readFile(source, 'utf8');
  assert.match(contents, /\bBEGIN;/i);
  assert.match(contents, /\bROLLBACK;\s*$/i);
  let result;
  try { result = { ...await run('/opt/homebrew/bin/psql', [...args, '-f', source], { maxBuffer: 8 * 1024 * 1024 }), code: 0 }; }
  catch (error) { result = { stdout: error.stdout ?? '', stderr: error.stderr ?? '', code: error.code ?? -1 }; }
  await writeFile(path.join(output, `${filename}.tap`), result.stdout, { flag: 'wx' });
  await writeFile(path.join(output, `${filename}.err`), result.stderr, { flag: 'wx' });
  const plans = [...result.stdout.matchAll(/^1\.\.(\d+)\s*$/gm)];
  const passed = [...result.stdout.matchAll(/^ok \d+\b/gm)].length;
  const failed = [...result.stdout.matchAll(/^not ok \d+\b/gm)].length;
  const planned = plans.length === 1 ? Number(plans[0][1]) : null;
  const ok = result.code === 0 && planned > 0 && passed === planned && failed === 0 && !result.stderr.includes('ERROR:');
  results.push({ suite: filename, sha256: createHash('sha256').update(contents).digest('hex'), planned, passed, failed, exit: result.code, ok });
  console.log(`${filename}: ${ok ? 'PASS' : 'FAIL'} ${passed}/${planned} (${failed} failed)`);
}
assert.equal(await sql('SELECT count(*) FROM auth.users'), '0', 'Suite fixtures must roll back');
const allOk = results.every((result) => result.ok);
await writeFile(path.join(output, 'pgtap-results.json'), JSON.stringify({ database, run_at: new Date().toISOString(),
  suites: results, passed: results.reduce((sum, result) => sum + result.passed, 0), all_ok: allOk }, null, 2), { flag: 'wx' });
if (!allOk) process.exitCode = 1;
