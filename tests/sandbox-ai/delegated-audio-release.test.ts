// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import manifest from '@/lib/sandbox-ai/static-audio-release.json';
import { audioReleaseSchema, audioReleaseDecision, REVIEW_ROLES, type AudioRelease } from '@/lib/sandbox-ai/static-audio-release-schema';
import { audioCatalog } from '../../scripts/generate-outreach-audio.mts';
import { verifyAudioRelease } from '../../scripts/verify-audio-release.mts';

const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const readAudio = (relative: string) => readFileSync(path.resolve('public/outreach-audio', relative));
const actualEvidence = (relative: string) => readFileSync(path.resolve('reference/audio-releases', relative));
const receipts = JSON.parse(readAudio('generation-manifest.json').toString()).clips;
const fresh = () => audioReleaseSchema.parse(structuredClone(manifest));
const decision = (release: AudioRelease) => audioReleaseDecision(release, `/outreach-audio/${release.clips[0].path}`, release.clips[0].locale);

function changedEvidence(release: AudioRelease, mutate: (row: Record<string, unknown>) => void) {
  const rows = actualEvidence(release.evidence.file).toString().trim().split('\n').map(line => JSON.parse(line));
  mutate(rows[0]);
  const technical = Buffer.from(rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  release.evidence.sha256 = sha(technical);
  const files = new Map<string, Buffer>([[release.evidence.file, technical]]);
  for (const clip of release.clips) {
    clip.technical.evidenceSha256 = release.evidence.sha256;
    const verification = clip.delegatedVerification!;
    verification.technicalEvidenceSha256 = release.evidence.sha256;
    const { evidenceRef: _ref, evidenceSha256: _digest, ...body } = verification;
    const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, kind: 'synthetic_audio_verification', verification: body }));
    verification.evidenceSha256 = sha(bytes); verification.evidenceRef = `${verification.evidenceSha256}.json`;
    files.set(verification.evidenceRef, bytes);
  }
  return (relative: string) => files.get(relative) ?? actualEvidence(relative);
}

describe('explicit owner-delegated synthetic audio release', () => {
  it('keeps reported clinical acceptance, automated verification and authorization distinct', () => {
    const release = fresh();
    expect(release.delegatedRelease).toMatchObject({ clinicalBasis: 'owner_reported_clinical_source_acceptance',
      signedByClinician: false, humanListening: false, scope: 'synthetic_sandbox_only' });
    expect(release.clips.every(clip => Object.values(clip.decisions).every(value => value === null))).toBe(true);
    expect(verifyAudioRelease(release, audioCatalog(), readAudio, actualEvidence, receipts)).toEqual({ catalog: 58, approved: 58, paused: 0 });
  });

  it.each(['signedByClinician', 'humanListening'] as const)('cannot claim %s in the delegated authority', field => {
    const release = structuredClone(manifest);
    (release.delegatedRelease as unknown as Record<string, unknown>)[field] = true;
    expect(audioReleaseSchema.safeParse(release).success).toBe(false);
  });

  it('requires schema 2, the exact clinical-source catalog and a real authorization', () => {
    const release = fresh(); release.schemaVersion = 1;
    expect(audioReleaseSchema.safeParse(release).success).toBe(false);
    release.schemaVersion = 2; release.delegatedRelease!.catalogSha256 = 'a'.repeat(64);
    expect(() => verifyAudioRelease(release, audioCatalog(), readAudio, actualEvidence, receipts)).toThrow('Delegated authority catalog or date invalid');
    delete release.delegatedRelease;
    expect(decision(release).canPlay).toBe(false);
  });

  it.each(['sourceSha256', 'clinicalScriptSha256', 'audioSha256', 'technicalEvidenceSha256', 'documentaryEvidenceSha256'] as const)('binds delegated %s', field => {
    const release = fresh(); release.clips[0].delegatedVerification![field] = 'a'.repeat(64);
    expect(decision(release)).toMatchObject({ canPlay: false, reason: 'stale_decision' });
  });

  it('binds locale and rejects a clinical script changed beneath its approval', () => {
    const release = fresh(); release.clips[0].delegatedVerification!.locale = 'es';
    expect(decision(release).canPlay).toBe(false);
    release.clips[0].clinicalScriptSha256 = 'a'.repeat(64);
    expect(() => verifyAudioRelease(release, audioCatalog(), readAudio, actualEvidence, receipts)).toThrow('Clinical script identity changed');
  });

  it.each(['uncertain', 'failed', 'revoked'] as const)('never plays a %s technical verification', state => {
    const release = fresh(); release.clips[0].delegatedVerification!.state = state;
    expect(decision(release).canPlay).toBe(false);
  });

  it.each(['clinical', 'linguistic', 'listening', 'activation'] as const)('does not bypass a partial, rejected or revoked human %s decision', dimension => {
    for (const state of ['approved', 'rejected', 'revoked'] as const) {
      const release = fresh(); const clip = release.clips[0];
      clip.decisions[dimension] = { dimension, state, reviewer: 'Fictitious test identity', role: REVIEW_ROLES[dimension],
        reviewedAt: clip.observedAt, humanReviewed: true, evidenceRef: `${'a'.repeat(64)}.json`, evidenceSha256: 'a'.repeat(64),
        sourceSha256: clip.sourceSha256, audioSha256: clip.audioSha256, locale: clip.locale, scope: release.scope };
      expect(decision(release).canPlay).toBe(false);
    }
  });

  it.each(['authority', 'verification'] as const)('honors %s revocation even if another route has four human approvals', which => {
    const release = fresh(); const clip = release.clips[0];
    for (const dimension of Object.keys(REVIEW_ROLES) as Array<keyof typeof REVIEW_ROLES>) {
      clip.decisions[dimension] = { dimension, state: 'approved', reviewer: 'Fictitious test identity', role: REVIEW_ROLES[dimension],
        reviewedAt: clip.observedAt, humanReviewed: true, evidenceRef: `${'a'.repeat(64)}.json`, evidenceSha256: 'a'.repeat(64),
        sourceSha256: clip.sourceSha256, audioSha256: clip.audioSha256, locale: clip.locale, scope: release.scope };
    }
    if (which === 'authority') release.delegatedRelease!.state = 'revoked';
    else clip.delegatedVerification!.state = 'revoked';
    expect(decision(release)).toEqual({ canPlay: false, reason: 'revoked' });
  });

  it.each(['transcript', 'segments', 'decoder', 'decoded', 'engineVersion', 'model', 'sourceTexts', 'humanListening'] as const)('rejects inventory evidence missing %s even with rehashed certificates', field => {
    const release = fresh(); const evidence = changedEvidence(release, row => { delete row[field]; });
    expect(() => verifyAudioRelease(release, audioCatalog(), readAudio, evidence, receipts)).toThrow();
  });

  it.each([
    (row: Record<string, unknown>) => { row.transcript = ''; },
    (row: Record<string, unknown>) => { row.transcript = 'A fabricated replacement transcript.'; },
    (row: Record<string, unknown>) => { row.sourceTexts = ['A different clinical script.']; },
    (row: Record<string, unknown>) => { row.segments = []; },
    (row: Record<string, unknown>) => { (row.segments as Array<{ end: number }>)[0].end = 100000; },
    (row: Record<string, unknown>) => { row.humanListening = true; },
    (row: Record<string, unknown>) => { row.decoded = false; },
  ])('rejects incomplete or altered ASR content', mutate => {
    const release = fresh(); const evidence = changedEvidence(release, mutate);
    expect(() => verifyAudioRelease(release, audioCatalog(), readAudio, evidence, receipts)).toThrow();
  });

  it('rejects evidence tampering, future authority and verification before observation', () => {
    const release = fresh();
    expect(() => verifyAudioRelease(release, audioCatalog(), readAudio, name => name.endsWith('.json') ? Buffer.from('{}') : actualEvidence(name), receipts)).toThrow('Delegated evidence digest mismatch');
    release.delegatedRelease!.recordedAt = '2099-01-01T00:00:00Z';
    expect(() => verifyAudioRelease(release, audioCatalog(), readAudio, actualEvidence, receipts)).toThrow('Delegated authority catalog or date invalid');
    const early = fresh(); early.clips[0].delegatedVerification!.recordedAt = '2020-01-01T00:00:00Z';
    expect(() => verifyAudioRelease(early, audioCatalog(), readAudio, actualEvidence, receipts)).toThrow('Delegated verification authority or date invalid');
  });

  it('rejects a generation receipt dated after the recording observation', () => {
    const release = fresh(); const late = structuredClone(receipts); const clip = release.clips[0];
    late[clip.path].generatedAt = new Date(Date.parse(clip.observedAt) + 1000).toISOString();
    expect(() => verifyAudioRelease(release, audioCatalog(), readAudio, actualEvidence, late)).toThrow('Generation receipt missing or stale');
  });
});
