/**
 * Education Domain Content Tests
 * Requirements: EDUC-01, EDUC-02, EDUC-04
 *
 * Verifies: 8 domains exist and are available at every facility tier,
 * all domains have track-aware content and valid questions.
 */

import { describe, it, expect } from 'vitest';
import { EDUCATION_DOMAINS } from '@/lib/education/constants';
import type { EducationDomain } from '@/lib/education/types';

describe('EDUCATION_DOMAINS', () => {
  it('contains exactly 8 education domains', () => {
    expect(EDUCATION_DOMAINS).toHaveLength(8);
  });

  it('contains every protocol domain', () => {
    const ids = EDUCATION_DOMAINS.map((d) => d.id);
    expect(ids).toEqual([
      'daily_weight',
      'medications',
      'warning_signs',
      'what_is_hf',
      'sodium_restriction',
      'fluid_management',
      'when_to_call',
      'activity_guidance',
    ]);
  });

  it('carries no facility-tier marker on any domain', () => {
    EDUCATION_DOMAINS.forEach((domain) => {
      expect(domain).not.toHaveProperty('tier');
    });
  });

  it('every domain has required fields: id, title, icon, content, question', () => {
    EDUCATION_DOMAINS.forEach((domain) => {
      expect(domain.id).toBeTruthy();
      expect(domain.title).toBeTruthy();
      expect(domain.icon).toBeTruthy();
      expect(domain.content).toBeDefined();
      expect(domain.question).toBeDefined();
    });
  });

  it('every domain has common, track_a, and track_b content arrays', () => {
    EDUCATION_DOMAINS.forEach((domain) => {
      expect(Array.isArray(domain.content.common)).toBe(true);
      expect(domain.content.common.length).toBeGreaterThan(0);
      expect(Array.isArray(domain.content.track_a)).toBe(true);
      expect(domain.content.track_a.length).toBeGreaterThan(0);
      expect(Array.isArray(domain.content.track_b)).toBe(true);
      expect(domain.content.track_b.length).toBeGreaterThan(0);
    });
  });

  it('every question has 3-4 options with exactly one correct answer', () => {
    EDUCATION_DOMAINS.forEach((domain) => {
      const q = domain.question;
      expect(q.text).toBeTruthy();
      expect(q.options.length).toBeGreaterThanOrEqual(3);
      expect(q.options.length).toBeLessThanOrEqual(4);
      expect(q.correctIndex).toBeGreaterThanOrEqual(0);
      expect(q.correctIndex).toBeLessThan(q.options.length);
      expect(q.explanation).toBeTruthy();
    });
  });

  it('Track A content mentions app-specific guidance for all domains', () => {
    EDUCATION_DOMAINS.forEach((domain) => {
      const trackAText = domain.content.track_a.join(' ').toLowerCase();
      expect(
        trackAText.includes('app') || trackAText.includes('digital')
      ).toBe(true);
    });
  });

  it('Track B content mentions paper diary or analog instructions for all domains', () => {
    EDUCATION_DOMAINS.forEach((domain) => {
      const trackBText = domain.content.track_b.join(' ').toLowerCase();
      expect(
        trackBText.includes('paper') ||
          trackBText.includes('diary') ||
          trackBText.includes('phone') ||
          trackBText.includes('written') ||
          trackBText.includes('call')
      ).toBe(true);
    });
  });

  it('each domain has a unique id', () => {
    const ids = EDUCATION_DOMAINS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

