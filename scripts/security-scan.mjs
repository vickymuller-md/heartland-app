import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const files = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { encoding: 'utf8' },
).split('\0').filter(Boolean);

const ignoredPrefixes = ['.codex/', 'graphify-out/', '.next/', 'node_modules/'];
const ignoredFiles = new Set(['package-lock.json', 'reference/HEARTLAND_SECURITY_PLAN.md']);
const patterns = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ['GitHub token', /\b(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g],
  ['AWS access key', /\bAKIA[A-Z0-9]{16}\b/g],
  ['live payment key', /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/g],
  ['assigned service-role secret', /SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*["'][^"'$<]{20,}["']/g],
  ['assigned auth token', /(?:ACCESS_TOKEN|AUTH_TOKEN|API_KEY)\s*[:=]\s*["'][^"'$<]{24,}["']/g],
];

const findings = [];
for (const file of files) {
  if (ignoredPrefixes.some((prefix) => file.startsWith(prefix)) || ignoredFiles.has(file)) continue;
  let stats;
  try { stats = statSync(file); } catch { continue; }
  if (!stats.isFile() || stats.size > 2_000_000) continue;
  let content;
  try { content = readFileSync(file, 'utf8'); } catch { continue; }
  if (content.includes('\0')) continue;
  for (const [label, pattern] of patterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const line = content.slice(0, match.index).split('\n').length;
      findings.push(`${file}:${line} (${label})`);
    }
  }
}

if (findings.length) {
  console.error('Potential committed secret patterns found:');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log(`Security scan passed across ${files.length} repository files.`);
