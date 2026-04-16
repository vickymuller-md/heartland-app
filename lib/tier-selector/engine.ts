/**
 * Implementation Tier Selector -- Floor-Tier Algorithm
 *
 * Pure function: assessTier(categories) -> TierResult
 * Protocol v3.3 Module 8: overall tier = min of all category tiers.
 *
 * The "floor-tier" principle means a facility is only as strong as its
 * weakest component. One Tier 1 category forces overall Tier 1.
 */

import type {
  CategoryAssessment,
  TierLevel,
  TierResult,
  UpgradeRecommendation,
} from './types';
import { TIER_LABELS, CATEGORY_DEFINITIONS } from './constants';

/**
 * Assess facility implementation tier using floor-tier algorithm.
 *
 * @param categories - Array of exactly 8 CategoryAssessment entries
 * @returns TierResult with overall tier, rationale, breakdown, and recommendations
 * @throws Error if categories.length !== 8
 */
export function assessTier(categories: CategoryAssessment[]): TierResult {
  if (categories.length !== 8) {
    throw new Error(
      `Expected exactly 8 categories, received ${categories.length}`,
    );
  }

  // Floor-tier: overall = minimum of all category levels
  const overallTier = Math.min(
    ...categories.map((c) => c.selectedLevel),
  ) as TierLevel;

  const tierLabel = TIER_LABELS[overallTier];

  // Limiting categories: those at the floor tier level
  const limitingCategories = categories.filter(
    (c) => c.selectedLevel === overallTier,
  );

  // Upgrade recommendations: categories below Tier 3
  const upgradeRecommendations: UpgradeRecommendation[] = categories
    .filter((c) => c.selectedLevel < 3)
    .map((c) => {
      const nextLevel = (c.selectedLevel + 1) as TierLevel;
      const catDef = CATEGORY_DEFINITIONS.find(
        (def) => def.id === c.categoryId,
      );
      const upgradeAction =
        catDef?.levels[c.selectedLevel]?.upgradeAction ??
        `Upgrade ${c.categoryLabel} to ${TIER_LABELS[nextLevel]}`;

      return {
        category: c.categoryId,
        currentLevel: c.selectedLevel,
        targetLevel: nextLevel,
        action: upgradeAction,
      };
    });

  // Generate rationale
  let rationale: string;
  if (overallTier === 3) {
    rationale =
      'Your facility meets all Tier 3 requirements across all 8 implementation categories. ' +
      'This represents the most advanced implementation level with comprehensive HF program capabilities.';
  } else {
    const limitingNames = limitingCategories
      .map((c) => c.categoryLabel)
      .join(', ');
    const allAtFloor = limitingCategories.length === 8;
    if (allAtFloor) {
      rationale =
        `All categories are at ${TIER_LABELS[overallTier]}. ` +
        'Consider upgrading the categories with the highest impact on patient outcomes first.';
    } else {
      rationale =
        `Overall tier limited to ${TIER_LABELS[overallTier]} by: ${limitingNames}. ` +
        'Upgrading these categories would raise the overall implementation tier.';
    }
  }

  return {
    overallTier,
    tierLabel,
    rationale,
    categoryBreakdown: [...categories],
    limitingCategories,
    upgradeRecommendations,
  };
}
