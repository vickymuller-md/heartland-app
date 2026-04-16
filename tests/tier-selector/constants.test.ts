import { describe, it, expect } from 'vitest';
import {
  CATEGORY_DEFINITIONS,
  QUALITY_METRICS,
  ASM_READINESS_ITEMS,
  TIER_LABELS,
  TIER_COLORS,
} from '@/lib/tier-selector/constants';

// ==========================================================================
// TIER-03: Category Definitions -- 8 protocol components with 3 tiers each
// Protocol v3.3 Module 8, Table 2 (Implementation Tiers Summary)
// ==========================================================================
describe('CATEGORY_DEFINITIONS', () => {
  it('contains exactly 8 category definitions', () => {
    expect(CATEGORY_DEFINITIONS).toHaveLength(8);
  });

  it('each category has id, label, description, protocolComponent, and 3 levels', () => {
    for (const cat of CATEGORY_DEFINITIONS) {
      expect(cat.id).toBeTruthy();
      expect(cat.label).toBeTruthy();
      expect(cat.description).toBeTruthy();
      expect(cat.protocolComponent).toBeTruthy();
      expect(cat.levels[1]).toBeDefined();
      expect(cat.levels[2]).toBeDefined();
      expect(cat.levels[3]).toBeDefined();
    }
  });

  it('category IDs match protocol order', () => {
    const expectedIds = [
      'risk-stratification',
      'gdmt',
      'monitoring',
      'discharge-education',
      'follow-up',
      'staffing',
      'chw',
      'financial',
    ];
    const actualIds = CATEGORY_DEFINITIONS.map((c) => c.id);
    expect(actualIds).toEqual(expectedIds);
  });

  it('risk-stratification Tier 1 description matches protocol', () => {
    const riskStrat = CATEGORY_DEFINITIONS.find((c) => c.id === 'risk-stratification');
    expect(riskStrat).toBeDefined();
    expect(riskStrat!.levels[1].label).toContain('Score at discharge');
  });

  it('gdmt Tier 3 description matches protocol', () => {
    const gdmt = CATEGORY_DEFINITIONS.find((c) => c.id === 'gdmt');
    expect(gdmt).toBeDefined();
    expect(gdmt!.levels[3].label).toContain('Rapid sequence per STRONG-HF');
  });

  it('monitoring Tier 2 description matches protocol', () => {
    const monitoring = CATEGORY_DEFINITIONS.find((c) => c.id === 'monitoring');
    expect(monitoring).toBeDefined();
    expect(monitoring!.levels[2].label).toContain('Dual-track');
  });

  it('each level has non-empty label and description', () => {
    for (const cat of CATEGORY_DEFINITIONS) {
      for (const tier of [1, 2, 3] as const) {
        expect(cat.levels[tier].label).toBeTruthy();
        expect(cat.levels[tier].description).toBeTruthy();
      }
    }
  });

  it('Tier 1 and 2 levels have non-empty upgradeAction', () => {
    for (const cat of CATEGORY_DEFINITIONS) {
      expect(cat.levels[1].upgradeAction).toBeTruthy();
      expect(cat.levels[2].upgradeAction).toBeTruthy();
    }
  });
});

// ==========================================================================
// TIER-04: Quality Metrics -- 5 performance targets by tier
// Protocol v3.3 Module 8, Section 8.1
// ==========================================================================
describe('QUALITY_METRICS', () => {
  it('contains exactly 5 quality metrics', () => {
    expect(QUALITY_METRICS).toHaveLength(5);
  });

  it('metric 1: post-discharge contact', () => {
    expect(QUALITY_METRICS[0].name).toBe('48-72h post-discharge contact');
    expect(QUALITY_METRICS[0].tier1Target).toBe('>70%');
    expect(QUALITY_METRICS[0].tier23Target).toBe('>90%');
  });

  it('metric 2: GDMT classes', () => {
    expect(QUALITY_METRICS[1].name).toContain('GDMT classes at discharge');
    expect(QUALITY_METRICS[1].tier1Target).toBe('>60%');
    expect(QUALITY_METRICS[1].tier23Target).toBe('>80%');
  });

  it('metric 3: 7-day follow-up', () => {
    expect(QUALITY_METRICS[2].name).toBe('7-day follow-up attendance');
    expect(QUALITY_METRICS[2].tier1Target).toBe('>60%');
    expect(QUALITY_METRICS[2].tier23Target).toBe('>85%');
  });

  it('metric 4: 30-day readmission', () => {
    expect(QUALITY_METRICS[3].name).toBe('30-day readmission rate');
    expect(QUALITY_METRICS[3].tier1Target).toBe('Improvement from baseline');
    expect(QUALITY_METRICS[3].tier23Target).toBe('<15%');
  });

  it('metric 5: Teach-back documentation', () => {
    expect(QUALITY_METRICS[4].name).toBe('Teach-back documentation');
    expect(QUALITY_METRICS[4].tier1Target).toBe('>70%');
    expect(QUALITY_METRICS[4].tier23Target).toBe('>90%');
  });
});

// ==========================================================================
// TIER-05: ASM 2027 Readiness -- 6 preparatory items
// Protocol v3.3 Module 8, Section 8.3
// ==========================================================================
describe('ASM_READINESS_ITEMS', () => {
  it('contains exactly 6 ASM readiness items', () => {
    expect(ASM_READINESS_ITEMS).toHaveLength(6);
  });

  it('has expected IDs', () => {
    const expectedIds = [
      'cms-register',
      'baseline-metrics',
      'gdmt-optimization',
      'telehealth',
      'hrrp-review',
      'teleconsult',
    ];
    const actualIds = ASM_READINESS_ITEMS.map((i) => i.id);
    expect(actualIds).toEqual(expectedIds);
  });

  it('each item has id, label, and non-empty description', () => {
    for (const item of ASM_READINESS_ITEMS) {
      expect(item.id).toBeTruthy();
      expect(item.label).toBeTruthy();
      expect(item.description).toBeTruthy();
    }
  });

  it('item 1 label matches protocol', () => {
    expect(ASM_READINESS_ITEMS[0].label).toBe('Register for CMS Innovation Center updates');
  });
});

// ==========================================================================
// Tier display constants
// ==========================================================================
describe('TIER_LABELS', () => {
  it('maps levels to display labels', () => {
    expect(TIER_LABELS[1]).toBe('Tier 1 (Minimal)');
    expect(TIER_LABELS[2]).toBe('Tier 2 (Standard)');
    expect(TIER_LABELS[3]).toBe('Tier 3 (Advanced)');
  });
});

describe('TIER_COLORS', () => {
  it('Tier 1 uses amber', () => {
    expect(TIER_COLORS[1].badge).toContain('amber');
  });

  it('Tier 2 uses blue', () => {
    expect(TIER_COLORS[2].badge).toContain('blue');
  });

  it('Tier 3 uses emerald', () => {
    expect(TIER_COLORS[3].badge).toContain('emerald');
  });
});
