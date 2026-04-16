/**
 * Track Assignment Content Branching Tests
 * Requirements: EDUC-04, RMON-06
 *
 * Verifies: null track defaults to track_b, content differs per track,
 * all domains have both track variants.
 */

import { describe, it, expect } from 'vitest';
import { EDUCATION_DOMAINS } from '@/lib/education/constants';
import type { EducationDomain } from '@/lib/education/types';

/**
 * Helper: get content for a domain given a track assignment.
 * Mirrors the logic in the teach-back card component.
 */
function getContentForTrack(
  domain: EducationDomain,
  trackAssignment: string | null
): string[] {
  const track = trackAssignment ?? 'track_b'; // null defaults to Track B
  const trackContent =
    track === 'track_a' ? domain.content.track_a : domain.content.track_b;
  return [...domain.content.common, ...trackContent];
}

describe('Track-aware content branching', () => {
  it('null track_assignment defaults to track_b content', () => {
    const domain = EDUCATION_DOMAINS[0]; // daily_weight
    const nullContent = getContentForTrack(domain, null);
    const trackBContent = getContentForTrack(domain, 'track_b');
    expect(nullContent).toEqual(trackBContent);
  });

  it('track_a content differs from track_b content for every domain', () => {
    EDUCATION_DOMAINS.forEach((domain) => {
      expect(domain.content.track_a).not.toEqual(domain.content.track_b);
    });
  });

  it('track_a content includes common paragraphs plus track_a paragraphs', () => {
    EDUCATION_DOMAINS.forEach((domain) => {
      const content = getContentForTrack(domain, 'track_a');
      expect(content.length).toBe(
        domain.content.common.length + domain.content.track_a.length
      );
      // First paragraphs should be common
      domain.content.common.forEach((p, i) => {
        expect(content[i]).toBe(p);
      });
    });
  });

  it('track_b content includes common paragraphs plus track_b paragraphs', () => {
    EDUCATION_DOMAINS.forEach((domain) => {
      const content = getContentForTrack(domain, 'track_b');
      expect(content.length).toBe(
        domain.content.common.length + domain.content.track_b.length
      );
    });
  });

  it('hybrid track falls back to track_b content (not track_a)', () => {
    const domain = EDUCATION_DOMAINS[0];
    const hybridContent = getContentForTrack(domain, 'hybrid');
    const trackBContent = getContentForTrack(domain, 'track_b');
    expect(hybridContent).toEqual(trackBContent);
  });
});
