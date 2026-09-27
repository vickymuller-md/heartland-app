import { describe, expect, it } from 'vitest';
import { audioCatalog } from '../../scripts/generate-outreach-audio.mts';
import { staticAudioPlaybackPolicy } from '@/lib/sandbox-ai/static-audio-policy';

describe('historical static audio quarantine', () => {
  it('keeps the complete historical catalogue unavailable without inventing approvals', () => {
    const jobs = audioCatalog();
    expect(jobs).toHaveLength(58);
    expect(jobs.filter(job => job.locale === 'en')).toHaveLength(31);
    expect(jobs.filter(job => job.locale === 'es')).toHaveLength(27);
    for (const job of jobs) {
      expect(staticAudioPlaybackPolicy(job.locale)).toMatchObject({
        canPlay: false,
        reason: 'review_pending',
      });
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
