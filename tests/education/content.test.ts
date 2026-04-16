/**
 * Education Domain Content Tests
 * Requirements: EDUC-01, EDUC-02, EDUC-04
 *
 * Verifies: 8 domains exist, tier assignments correct,
 * all domains have track-aware content and valid questions.
 */

import { describe, it, expect } from 'vitest';
import { EDUCATION_DOMAINS } from '@/lib/education/constants';
import type { EducationDomain } from '@/lib/education/types';

describe('EDUCATION_DOMAINS', () => {
  it('contains exactly 8 education domains', () => {
    expect(EDUCATION_DOMAINS).toHaveLength(8);
  });

  it('has 3 core domains: daily_weight, medications, warning_signs', () => {
    const coreDomains = EDUCATION_DOMAINS.filter((d) => d.tier === 'core');
    expect(coreDomains).toHaveLength(3);
    const coreIds = coreDomains.map((d) => d.id);
    expect(coreIds).toContain('daily_weight');
    expect(coreIds).toContain('medications');
    expect(coreIds).toContain('warning_signs');
  });

  it('has 5 extended domains: what_is_hf, sodium_restriction, fluid_management, when_to_call, activity_guidance', () => {
    const extDomains = EDUCATION_DOMAINS.filter((d) => d.tier === 'extended');
    expect(extDomains).toHaveLength(5);
    const extIds = extDomains.map((d) => d.id);
    expect(extIds).toContain('what_is_hf');
    expect(extIds).toContain('sodium_restriction');
    expect(extIds).toContain('fluid_management');
    expect(extIds).toContain('when_to_call');
    expect(extIds).toContain('activity_guidance');
  });

  it('every domain has required fields: id, title, tier, icon, content, question', () => {
    EDUCATION_DOMAINS.forEach((domain) => {
      expect(domain.id).toBeTruthy();
      expect(domain.title).toBeTruthy();
      expect(['core', 'extended']).toContain(domain.tier);
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

  it('core domains are listed before extended domains', () => {
    const firstExtIndex = EDUCATION_DOMAINS.findIndex(
      (d) => d.tier === 'extended'
    );
    const lastCoreIndex = EDUCATION_DOMAINS.reduce(
      (last, d, i) => (d.tier === 'core' ? i : last),
      -1
    );
    expect(lastCoreIndex).toBeLessThan(firstExtIndex);
  });

  it('each domain has a unique id', () => {
    const ids = EDUCATION_DOMAINS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('Tier filtering', () => {
  it('facility_tier 1 shows only core domains (3)', () => {
    const filtered = EDUCATION_DOMAINS.filter(
      (d) => d.tier === 'core' || 1 >= 2
    );
    expect(filtered).toHaveLength(3);
    expect(filtered.every((d) => d.tier === 'core')).toBe(true);
  });

  it('facility_tier 2 shows all 8 domains (core + extended)', () => {
    const filtered = EDUCATION_DOMAINS.filter(
      (d) => d.tier === 'core' || 2 >= 2
    );
    expect(filtered).toHaveLength(8);
  });

  it('facility_tier 3 shows all 8 domains (core + extended)', () => {
    const filtered = EDUCATION_DOMAINS.filter(
      (d) => d.tier === 'core' || 3 >= 2
    );
    expect(filtered).toHaveLength(8);
  });
});
