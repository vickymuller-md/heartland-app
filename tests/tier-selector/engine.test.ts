import { describe, it, expect } from 'vitest';
import { assessTier } from '@/lib/tier-selector/engine';
import type { CategoryAssessment } from '@/lib/tier-selector/types';
import { TIER_LABELS, CATEGORY_DEFINITIONS } from '@/lib/tier-selector/constants';

// ==========================================================================
// TIER-01, TIER-02: Floor-Tier Algorithm -- assessTier() pure function
// Protocol v3.3 Module 8, Implementation Tiering System
// Overall tier = minimum (floor) of all 8 category tiers
// ==========================================================================

/** Helper: create 8 CategoryAssessment entries all at the same tier level */
function makeCategories(level: 1 | 2 | 3): CategoryAssessment[] {
  return CATEGORY_DEFINITIONS.map((cat) => ({
    categoryId: cat.id,
    categoryLabel: cat.label,
    selectedLevel: level,
    description: cat.levels[level].description,
  }));
}

/** Helper: create 8 categories with one override */
function makeCategoriesWithOverride(
  baseLevel: 1 | 2 | 3,
  overrideId: string,
  overrideLevel: 1 | 2 | 3,
): CategoryAssessment[] {
  return CATEGORY_DEFINITIONS.map((cat) => ({
    categoryId: cat.id,
    categoryLabel: cat.label,
    selectedLevel: cat.id === overrideId ? overrideLevel : baseLevel,
    description: cat.levels[cat.id === overrideId ? overrideLevel : baseLevel].description,
  }));
}

describe('assessTier', () => {
  it('returns Tier 1 when all 8 categories are Tier 1', () => {
    const result = assessTier(makeCategories(1));
    expect(result.overallTier).toBe(1);
    expect(result.tierLabel).toBe('Tier 1 (Minimal)');
  });

  it('returns Tier 2 when all 8 categories are Tier 2', () => {
    const result = assessTier(makeCategories(2));
    expect(result.overallTier).toBe(2);
    expect(result.tierLabel).toBe('Tier 2 (Standard)');
  });

  it('returns Tier 3 when all 8 categories are Tier 3', () => {
    const result = assessTier(makeCategories(3));
    expect(result.overallTier).toBe(3);
    expect(result.tierLabel).toBe('Tier 3 (Advanced)');
  });

  it('returns Tier 1 (floor) when 7 categories are Tier 3 and 1 is Tier 1', () => {
    const categories = makeCategoriesWithOverride(3, 'financial', 1);
    const result = assessTier(categories);
    expect(result.overallTier).toBe(1);
    expect(result.tierLabel).toBe('Tier 1 (Minimal)');
  });

  it('returns Tier 2 (floor) when mixed Tier 2 and Tier 3 categories', () => {
    const categories = makeCategoriesWithOverride(3, 'staffing', 2);
    const result = assessTier(categories);
    expect(result.overallTier).toBe(2);
  });

  it('identifies limiting categories correctly -- single limiting category', () => {
    const categories = makeCategoriesWithOverride(3, 'gdmt', 1);
    const result = assessTier(categories);
    expect(result.limitingCategories).toHaveLength(1);
    expect(result.limitingCategories[0].categoryId).toBe('gdmt');
  });

  it('identifies limiting categories correctly -- multiple limiting categories', () => {
    const categories = CATEGORY_DEFINITIONS.map((cat) => ({
      categoryId: cat.id,
      categoryLabel: cat.label,
      selectedLevel: (cat.id === 'gdmt' || cat.id === 'staffing' ? 1 : 3) as 1 | 2 | 3,
      description: cat.levels[cat.id === 'gdmt' || cat.id === 'staffing' ? 1 : 3].description,
    }));
    const result = assessTier(categories);
    expect(result.limitingCategories).toHaveLength(2);
    const limitingIds = result.limitingCategories.map((c) => c.categoryId);
    expect(limitingIds).toContain('gdmt');
    expect(limitingIds).toContain('staffing');
  });

  it('generates upgrade recommendations for categories below Tier 3', () => {
    const categories = makeCategoriesWithOverride(3, 'chw', 1);
    const result = assessTier(categories);
    expect(result.upgradeRecommendations.length).toBeGreaterThanOrEqual(1);
    const chwRec = result.upgradeRecommendations.find((r) => r.category === 'chw');
    expect(chwRec).toBeDefined();
    expect(chwRec!.currentLevel).toBe(1);
    expect(chwRec!.targetLevel).toBe(2);
    expect(chwRec!.action).toBeTruthy();
  });

  it('generates no upgrade recommendations when all categories are Tier 3', () => {
    const result = assessTier(makeCategories(3));
    expect(result.upgradeRecommendations).toHaveLength(0);
  });

  it('generates rationale mentioning limiting categories by name', () => {
    const categories = makeCategoriesWithOverride(3, 'monitoring', 1);
    const result = assessTier(categories);
    expect(result.rationale).toContain('Monitoring');
  });

  it('generates rationale "meets all Tier 3 requirements" when all are Tier 3', () => {
    const result = assessTier(makeCategories(3));
    expect(result.rationale).toContain('meets all Tier 3 requirements');
  });

  it('throws Error when categories array length is not 8', () => {
    expect(() => assessTier([])).toThrow();
    expect(() =>
      assessTier([
        {
          categoryId: 'gdmt',
          categoryLabel: 'GDMT',
          selectedLevel: 1,
          description: 'test',
        },
      ]),
    ).toThrow();
  });

  it('returns categoryBreakdown with all 8 entries preserving input order', () => {
    const categories = makeCategories(2);
    const result = assessTier(categories);
    expect(result.categoryBreakdown).toHaveLength(8);
    result.categoryBreakdown.forEach((entry, i) => {
      expect(entry.categoryId).toBe(categories[i].categoryId);
    });
  });

  it('tierLabel matches TIER_LABELS constant for each possible tier', () => {
    expect(assessTier(makeCategories(1)).tierLabel).toBe(TIER_LABELS[1]);
    expect(assessTier(makeCategories(2)).tierLabel).toBe(TIER_LABELS[2]);
    expect(assessTier(makeCategories(3)).tierLabel).toBe(TIER_LABELS[3]);
  });
});
