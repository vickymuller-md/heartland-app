import { describe, expect, it } from 'vitest';
import { audioCatalog } from '../../scripts/generate-outreach-audio.mts';
import { staticAudioPlaybackPolicy } from '@/lib/sandbox-ai/static-audio-policy';

describe('recording-specific static audio release', () => {
  it('serves the 58 authorized synthetic recordings only at immutable byte identities', () => {
    const jobs = audioCatalog();
    expect(jobs).toHaveLength(58);
    expect(jobs.filter(job => job.locale === 'en')).toHaveLength(31);
    expect(jobs.filter(job => job.locale === 'es')).toHaveLength(27);
    for (const job of jobs) {
      expect(staticAudioPlaybackPolicy(job.locale)).toMatchObject({
        canPlay: false,
        reason: 'review_pending',
      });
      const asset = staticAudioPlaybackPolicy(job.locale, `/outreach-audio/${job.relativePath}`);
      expect(asset.canPlay).toBe(true);
      expect(asset.url).toMatch(/^\/outreach-audio\/releases\/[a-f0-9]{64}\.mp3$/);
    }
  });

  it.each(['en', 'es'] as const)('explains the text fallback in %s', locale => {
    const policy = staticAudioPlaybackPolicy(locale);
    expect(policy.canPlay).toBe(false);
    expect(policy.message).toMatch(locale === 'es' ? /simulación.*texto/ : /simulation.*text/);
  });

  it('defaults to the English interface and does not claim verification', () => {
    expect(staticAudioPlaybackPolicy()).toEqual(staticAudioPlaybackPolicy('en'));
    expect(staticAudioPlaybackPolicy().message).not.toMatch(/approved|verified audio/i);
  });
});
