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

describe('Clinical wording boundaries', () => {
  const byId = (id: string) => EDUCATION_DOMAINS.find((d) => d.id === id)!;

  it('sodium content points at the care plan instead of a universal target', () => {
    const domain = byId('sodium_restriction');
    const text = domain.content.common.join(' ');
    expect(text).toMatch(/care plan/i);
    expect(text).toMatch(/commonly used target/i);
  });

  it('the sodium quiz answer is the care plan, not a number', () => {
    const { options, correctIndex } = byId('sodium_restriction').question;
    expect(options[correctIndex]).toMatch(/care plan/i);
    expect(options[correctIndex]).not.toMatch(/\d{3,}\s*mg/i);
  });

  it('fluid content states a limit only when the care plan sets one', () => {
    const domain = byId('fluid_management');
    const text = domain.content.common.join(' ');
    expect(text).toMatch(/not advice for everyone/i);
    expect(text).toMatch(/care plan/i);
    expect(text).not.toMatch(/1\.5|2 liters|6 to 8 cups/i);
  });

  it('the fluid quiz answer is conditional on the care plan', () => {
    const { options, correctIndex } = byId('fluid_management').question;
    expect(options[correctIndex]).toMatch(/only if my care team wrote a limit/i);
  });

  it('the what_is_hf answer covers both HFrEF and HFpEF', () => {
    const { options, correctIndex, explanation } = byId('what_is_hf').question;
    expect(options[correctIndex]).toMatch(/weak/i);
    expect(options[correctIndex]).toMatch(/stiff/i);
    expect(explanation).toMatch(/HFpEF/);
  });

  it('activity content keeps the stability qualifier and the precautions', () => {
    const text = byId('activity_guidance').content.common.join(' ');
    expect(text).toMatch(/stable/i);
    expect(text).toMatch(/precautions/i);
    expect(text).toMatch(/cardiac rehabilitation/i);
  });
});
