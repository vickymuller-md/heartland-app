// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pack = readFileSync(new URL('../../public/resources/heartland-local-readiness-training.md', import.meta.url), 'utf8');
const guide = readFileSync(new URL('../../app/(public)/guide/_components/guide-content.tsx', import.meta.url), 'utf8');
describe('public readiness pack', () => {
  it('retains twelve distinct scenarios and usable blank worksheets', () => {
    const ids = [...pack.matchAll(/^\|(S\d{2}) —/gm)].map((match) => match[1]);
    expect(ids).toEqual(Array.from({ length: 12 }, (_, i) => `S${String(i + 1).padStart(2, '0')}`));
    for (const heading of ['Role and authority map', 'Contact log', 'Observer sheet', 'Remediation and readiness decision']) expect(pack).toContain(heading);
  });
  it('separates current synthetic playback from the hypothetical unverified recording', () => {
    expect(pack).toContain('58 synthetic clips (31 English, 27 Spanish)');
    expect(pack).toContain('Scenario S10 concerns a hypothetical unverified recording');
    expect(pack).toContain('not human listening');
    expect(pack).not.toContain('The58 historical EN/ES MP3 files remain unverified/held');
  });
  it('does not export private maintenance paths, identities or approval claims', () => {
    expect(pack).not.toMatch(/\/Users\/|backups\/|## 12\.|Rodrigo|SUBMISSAO_APROVACAO/);
    expect(pack).toContain('Do not prefill signatures, attendance or passing results');
    expect(pack).toContain('patient pilot');
    expect(pack).toContain('respectfully, politely and gratefully');
  });
  it('removes contradictory legacy education and offline-write promises from the public guide', () => {
    expect(guide).not.toContain('Tier 2/3 patients receive 5 additional modules');
    expect(guide).not.toContain('The app works fully offline');
    expect(guide).not.toContain('vitals may be queued offline');
    expect(guide).toContain('institution-gated background processes remain disabled');
  });
});
