// @vitest-environment node
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { audioCatalog } from '../../scripts/generate-outreach-audio.mts';
import { buildAudioReviewPacket, prepareAudioReview, renderAudioReviewPacket } from '../../scripts/prepare-audio-review.mts';

const stamp = '2026-09-24T12:00:00.000Z';
const jobs = audioCatalog().map((job) => ({ ...job, state: 'unverified' }));
const audio = new Map(jobs.map((job) => [job.relativePath, Buffer.from(`synthetic bytes ${job.relativePath}`)]));
afterEach(() => vi.unstubAllGlobals());

describe('offline audio review preparation', () => {
  it('binds all58 current sources and file identities without network or approval', () => {
    const fetch = vi.fn(() => { throw new Error('Network forbidden'); });
    vi.stubGlobal('fetch', fetch);
    const packet = buildAudioReviewPacket(jobs, audio, stamp);
    expect(packet.clips).toHaveLength(58);
    expect(packet.clips.filter((clip) => clip.locale === 'es')).toHaveLength(27);
    expect(packet.synthesisRequests).toBe(0);
    expect(packet.playbackEnabled).toBe(false);
    for (const clip of packet.clips) {
      expect(clip.audioSha256).toBe(createHash('sha256').update(audio.get(clip.path)!).digest('hex'));
      expect(clip.sourceTextIsAudioTranscript).toBe(false);
      expect(clip.playbackApproved).toBe(false);
      expect(Object.values(clip.review)).toEqual([null, null, null, null]);
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it('preserves exact dialogue turns and expressive tags without claiming a transcript', () => {
    const packet = buildAudioReviewPacket(jobs, audio, stamp);
    const source = jobs.find((job) => job.relativePath === 'call-maria-redflag.mp3')!;
    const clip = packet.clips.find((entry) => entry.path === source.relativePath)!;
    expect(clip.sourceTexts).toEqual(JSON.parse(source.body).inputs.map((turn: { text: string }) => turn.text));
    expect(clip.sourceTexts.some((text) => text.includes('[tired]'))).toBe(true);
    const markdown = renderAudioReviewPacket(packet);
    expect(markdown).toContain('NOT a transcription');
    expect(markdown).toContain('eight domains are a different content set');
    expect(markdown.match(/^### /gm)).toHaveLength(58);
    expect(markdown.match(/\|Actual recording\/listening comparison\|Unassigned\|Not reviewed\|/g)).toHaveLength(58);
    expect(markdown).not.toContain('<audio');
  });
  it('never treats a matching generation receipt as review or playback approval', () => {
    const packet = buildAudioReviewPacket([{ ...jobs[0], state: 'current' }], audio, stamp, {
      [jobs[0].relativePath]: { sourceSha256: jobs[0].sourceSha256,
        audioSha256: createHash('sha256').update(audio.get(jobs[0].relativePath)!).digest('hex') },
    });
    expect(packet.clips[0].generationIdentity).toBe('source_and_audio_match_receipt');
    expect(packet.clips[0].playbackApproved).toBe(false);
    expect(packet.clips[0].review.listening).toBeNull();
  });
  it('rechecks the receipt against emitted bytes instead of trusting a stale current plan', () => {
    const receiptA = { sourceSha256: jobs[0].sourceSha256, audioSha256: createHash('sha256').update('bytes A').digest('hex') };
    const packet = buildAudioReviewPacket([{ ...jobs[0], state: 'current' }], audio, stamp, { [jobs[0].relativePath]: receiptA });
    expect(packet.clips[0].generationIdentity).toBe('stale');
    expect(packet.clips[0].audioSha256).not.toBe(receiptA.audioSha256);
    expect(packet.clips[0].playbackApproved).toBe(false);
    expect(buildAudioReviewPacket([{ ...jobs[0], state: 'current' }], audio, stamp).clips[0].generationIdentity).toBe('unverified');
  });
  it('records missing files without manufacturing a digest or spoken content', () => {
    const packet = buildAudioReviewPacket([{ ...jobs[0], state: 'missing' }], new Map(), stamp);
    expect(packet.clips[0].audioSha256).toBeNull();
    expect(packet.clips[0].audioBytes).toBeNull();
    expect(renderAudioReviewPacket(packet)).toContain('Audio SHA-256: MISSING');
  });
  it.each(['../secret.mp3', '/absolute.mp3', 'a//b.mp3', 'a/../b.mp3', 'not-audio.json'])('refuses unsafe path %s', (relativePath) => {
    expect(() => buildAudioReviewPacket([{ ...jobs[0], relativePath }], audio, stamp)).toThrow('path');
  });
  it('refuses duplicate paths, source drift, missing bytes and empty files', () => {
    expect(() => buildAudioReviewPacket([jobs[0], jobs[0]], audio, stamp)).toThrow('duplicate');
    expect(() => buildAudioReviewPacket([{ ...jobs[0], body: '{}' }], audio, stamp)).toThrow('identity');
    expect(() => buildAudioReviewPacket(jobs, new Map(), stamp)).toThrow('inventory');
    expect(() => buildAudioReviewPacket([jobs[0]], new Map([[jobs[0].relativePath, Buffer.alloc(0)]]), stamp)).toThrow('inventory');
  });
  it('refuses output inside the deployed app or a relative output', () => {
    expect(() => prepareAudioReview('relative')).toThrow('absolute');
    expect(() => prepareAudioReview(process.cwd())).toThrow('outside');
    expect(() => prepareAudioReview(`${process.cwd()}/public/review`)).toThrow('outside');
  });
  it('refuses an external parent symlink into the deployed public directory before creating output', () => {
    const outside = mkdtempSync(path.join(tmpdir(), 'heartland-audio-review-alias-'));
    const alias = path.join(outside, 'alias');
    symlinkSync(path.join(process.cwd(), 'public'), alias, 'dir');
    const output = path.join(alias, 'must-not-create-audio-review');
    expect(() => prepareAudioReview(output)).toThrow('outside');
    expect(existsSync(output)).toBe(false);
  });
  it('prepares a real offline inventory without networking and never overwrites an existing review', () => {
    const fetch = vi.fn(() => { throw new Error('Network forbidden'); });
    vi.stubGlobal('fetch', fetch);
    const directory = path.join(mkdtempSync(path.join(tmpdir(), 'heartland-audio-review-test-')), 'packet');
    expect(prepareAudioReview(directory)).toMatchObject({ clips: 58, synthesisRequests: 0, playbackEnabled: false });
    const original = readFileSync(path.join(directory, 'AUDIO_REVIEW.md'), 'utf8');
    const receipt = JSON.parse(readFileSync(path.join(directory, 'audio-review.json'), 'utf8'));
    expect(receipt.clips.every((clip: { playbackApproved: boolean }) => !clip.playbackApproved)).toBe(true);
    expect(() => prepareAudioReview(directory)).toThrow(/EEXIST/);
    expect(readFileSync(path.join(directory, 'AUDIO_REVIEW.md'), 'utf8')).toBe(original);
    expect(fetch).not.toHaveBeenCalled();
  });
});
