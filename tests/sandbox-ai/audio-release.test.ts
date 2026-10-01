import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import manifest from '@/lib/sandbox-ai/static-audio-release.json';
import { audioReleaseSchema, audioReleaseDecision, REVIEW_ROLES, type AudioRelease } from '@/lib/sandbox-ai/static-audio-release-schema';
import { staticAudioPlaybackPolicy } from '@/lib/sandbox-ai/static-audio-policy';
import { audioCatalog } from '../../scripts/generate-outreach-audio.mts';
import { verifyAudioRelease, publicPlaybackProjection } from '../../scripts/verify-audio-release.mts';
import publicPlayback from '@/lib/sandbox-ai/static-audio-playback.generated.json';

const parse = () => audioReleaseSchema.parse(structuredClone(manifest));
const read = (relative: string) => readFileSync(path.resolve('public/outreach-audio', relative));
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const actualEvidence = (relative: string) => readFileSync(path.resolve('reference/audio-releases', relative));

// This in-memory approval is deliberately fictitious. It is never written to a release.
function approvedFixture() {
  const release = parse();
  const clip = release.clips.find(c => c.path === 'prompts/fillers/en/filler_2.mp3')!;
  const evidence = new Map<string, Buffer>();
  clip.technical.asrFinding = 'reconciled';
  for (const kind of ['clinical', 'linguistic', 'listening', 'activation'] as const) {
    const decision = {
      dimension: kind, state: 'approved' as const, reviewer: 'Synthetic test reviewer', role: REVIEW_ROLES[kind],
      reviewedAt: '2026-09-30T12:00:00Z', humanReviewed: true as const,
      sourceSha256: clip.sourceSha256, audioSha256: clip.audioSha256,
      scope: release.scope, locale: clip.locale,
    };
    const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, kind: 'audio_review_decision', decision }));
    const evidenceSha256 = sha(bytes);
    const evidenceRef = `${evidenceSha256}.json`;
    evidence.set(evidenceRef, bytes);
    clip.decisions[kind] = { ...decision, evidenceRef, evidenceSha256 };
  }
  return { release, clip, asset: `/outreach-audio/${clip.path}`,
    evidence: (relative: string) => evidence.get(relative) ?? actualEvidence(relative) };
}

describe('recording-specific release gate', () => {
  it('binds all 58 historical files to source and byte identities without approvals', () => {
    expect(verifyAudioRelease(manifest, audioCatalog(), read)).toEqual({ catalog: 58, approved: 0, paused: 58 });
    const release = parse();
    expect(release.blockedAudio).toHaveLength(24);
    expect(release.clips.filter(c => c.technical.asrFinding === 'uncertain')).toHaveLength(4);
    expect(release.clips.every(c => Object.values(c.decisions).every(d => d === null))).toBe(true);
    expect(release.evidence.humanListening).toBe(false);
  });

  it('fails closed for unknown paths, arbitrary URLs and mismatched locale', () => {
    for (const asset of ['https://example.test/clip.mp3', '/outreach-audio/../escape.mp3', '/unknown.mp3']) {
      expect(staticAudioPlaybackPolicy('en', asset)).toMatchObject({ canPlay: false, reason: 'unknown_asset' });
      expect(staticAudioPlaybackPolicy('en', asset).url).toBeUndefined();
    }
    expect(staticAudioPlaybackPolicy('es', '/outreach-audio/call-james-stable.mp3')).toMatchObject({ canPlay: false, reason: 'locale_mismatch' });
  });

  it('releases only the exact fully reviewed recording at a content-addressed URL', () => {
    const { release, clip, asset, evidence } = approvedFixture();
    expect(audioReleaseDecision(release, asset, 'en')).toEqual({ canPlay: true, reason: 'approved', url: `/outreach-audio/releases/${clip.audioSha256}.mp3` });
    expect(audioReleaseDecision(release, '/outreach-audio/prompts/fillers/en/filler_3.mp3', 'en').canPlay).toBe(false);
    expect(verifyAudioRelease(release, audioCatalog(), relative => relative.startsWith('releases/') ? read(clip.path) : read(relative), evidence).approved).toBe(1);
  });

  it.each(['clinical', 'linguistic', 'listening', 'activation'] as const)('never skips the %s decision', kind => {
    const { release, clip, asset } = approvedFixture();
    clip.decisions[kind] = null;
    expect(audioReleaseDecision(release, asset, 'en').canPlay).toBe(false);
  });

  it.each(['rejected', 'revoked'] as const)('does not reuse a %s decision', state => {
    const { release, clip, asset } = approvedFixture();
    clip.decisions.clinical!.state = state;
    expect(audioReleaseDecision(release, asset, 'en').canPlay).toBe(false);
    expect(() => verifyAudioRelease(release, audioCatalog(), read)).toThrow();
  });

  it.each(['sourceSha256', 'audioSha256', 'locale'] as const)('rejects a decision for a different %s', field => {
    const { release, clip, asset } = approvedFixture();
    if (field === 'locale') clip.decisions.listening![field] = 'es';
    else clip.decisions.listening![field] = 'b'.repeat(64);
    expect(audioReleaseDecision(release, asset, 'en')).toEqual({ canPlay: false, reason: 'stale_decision' });
  });

  it('does not turn ASR, decode or a provenance receipt into release authority', () => {
    const release = parse();
    const clip = release.clips.find(c => c.technical.asrFinding === 'review_pending')!;
    clip.provenance = 'generation_receipt';
    clip.technical.asrFinding = 'reconciled';
    expect(audioReleaseDecision(release, `/outreach-audio/${clip.path}`, clip.locale).canPlay).toBe(false);
  });

  it('keeps a blocked hash blocked even if its record is otherwise approved', () => {
    const { release, clip, asset } = approvedFixture();
    release.blockedAudio.push({ audioSha256: clip.audioSha256, reason: 'source_mismatch' });
    expect(audioReleaseDecision(release, asset, 'en')).toEqual({ canPlay: false, reason: 'source_mismatch' });
  });

  it('requires reconciled speech, not four approvals pasted over an ASR discrepancy', () => {
    const { release, clip, asset } = approvedFixture();
    clip.technical.asrFinding = 'uncertain';
    expect(audioReleaseDecision(release, asset, 'en').canPlay).toBe(false);
  });

  it('rejects duplicate, missing or foreign catalog entries', () => {
    for (const mutate of [
      (release: AudioRelease) => { release.clips.pop(); },
      (release: AudioRelease) => { release.clips[1] = release.clips[0]; },
      (release: AudioRelease) => { release.clips[0].path = 'foreign.mp3'; },
    ]) {
      const release = parse(); mutate(release);
      expect(() => verifyAudioRelease(release, audioCatalog(), read)).toThrow();
    }
  });

  it('fails a build when current source, MP3 or immutable copy changes', () => {
    const changed = audioCatalog(); changed[0].sourceSha256 = 'b'.repeat(64);
    expect(() => verifyAudioRelease(manifest, changed, read)).toThrow('Source identity changed');
    expect(() => verifyAudioRelease(manifest, audioCatalog(), () => Buffer.from('different'))).toThrow('Recording identity changed');
    const { release, evidence } = approvedFixture();
    expect(() => verifyAudioRelease(release, audioCatalog(), relative => relative.startsWith('releases/') ? Buffer.from('different') : read(relative), evidence)).toThrow('Immutable release bytes changed');
  });

  it('binds technical evidence and rejects fabricated schema fields or absent human-review identity', () => {
    const { release, clip } = approvedFixture();
    clip.technical.evidenceSha256 = sha(Buffer.from('different evidence'));
    expect(() => verifyAudioRelease(release, audioCatalog(), read)).toThrow('Technical evidence identity changed');
    expect(audioReleaseSchema.safeParse({ ...manifest, approved: true }).success).toBe(false);
    clip.decisions.clinical!.reviewer = '';
    expect(audioReleaseSchema.safeParse(release).success).toBe(false);
  });

  it('verifies evidence bytes, actual recording observation and decision dimension/date', () => {
    const { release, clip, evidence } = approvedFixture();
    expect(() => verifyAudioRelease(release, audioCatalog(), read, () => Buffer.from('changed'))).toThrow('Technical evidence file digest mismatch');
    expect(() => verifyAudioRelease(release, audioCatalog(), read, name => name.endsWith('.json') ? Buffer.from('{}') : evidence(name))).toThrow('Decision evidence digest mismatch');
    clip.decisions.clinical!.reviewedAt = '2099-01-01T00:00:00Z';
    expect(() => verifyAudioRelease(release, audioCatalog(), read, evidence)).toThrow('Decision date or dimension invalid');
    clip.decisions.clinical!.reviewedAt = '2026-09-30T12:00:00Z';
    clip.decisions.clinical!.dimension = 'activation';
    expect(() => verifyAudioRelease(release, audioCatalog(), read, evidence)).toThrow('Decision date or dimension invalid');
    const unobserved = parse(); unobserved.clips[0].duration += 1;
    expect(() => verifyAudioRelease(unobserved, audioCatalog(), read)).toThrow('Technical evidence does not bind this recording');
  });

  it('does not accept a receipt claim without the corresponding generation manifest entry', () => {
    const release = parse(); release.clips[0].provenance = 'generation_receipt';
    expect(() => verifyAudioRelease(release, audioCatalog(), read)).toThrow('Generation receipt missing or stale');
  });

  it('publishes no reviewer identity or evidence reference to the browser', () => {
    expect(publicPlaybackProjection(parse())).toEqual(publicPlayback);
    const { release } = approvedFixture();
    const client = JSON.stringify(publicPlaybackProjection(release));
    for (const privateField of ['reviewer', 'evidenceRef', 'humanReviewed', 'Synthetic test reviewer']) expect(client).not.toContain(privateField);
  });
});
