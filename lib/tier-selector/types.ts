/**
 * Implementation Tier Selector -- TypeScript Interfaces
 *
 * Protocol v3.3 Module 8: Implementation Guidance
 * Sections 8.1 (Quality Metrics), 8.2 (Tier Summary), 8.3 (ASM 2027)
 */

/** Tier levels: 1 = Minimal, 2 = Standard, 3 = Advanced */
export type TierLevel = 1 | 2 | 3;

/** A single category assessment from the questionnaire */
export interface CategoryAssessment {
  categoryId: string;
  categoryLabel: string;
  selectedLevel: TierLevel;
  description: string;
}

/** Result from the floor-tier algorithm */
export interface TierResult {
  overallTier: TierLevel;
  tierLabel: string;
  rationale: string;
  categoryBreakdown: CategoryAssessment[];
  limitingCategories: CategoryAssessment[];
  upgradeRecommendations: UpgradeRecommendation[];
}

/** Recommendation to upgrade a specific category */
export interface UpgradeRecommendation {
  category: string;
  currentLevel: TierLevel;
  targetLevel: TierLevel;
  action: string;
}

/** Quality metric with tier-specific targets */
export interface QualityMetric {
  name: string;
  tier1Target: string;
  tier23Target: string;
}

/** ASM 2027 readiness checklist item */
export interface ASMReadinessItem {
  id: string;
  label: string;
  description: string;
}

/** Level descriptor within a category definition */
export interface LevelDefinition {
  label: string;
  description: string;
  upgradeAction: string;
}

/** Full category definition with 3 tier levels */
export interface CategoryDefinition {
  id: string;
  label: string;
  description: string;
  protocolComponent: string;
  levels: Record<TierLevel, LevelDefinition>;
}
