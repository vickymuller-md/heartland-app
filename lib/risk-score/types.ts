/**
 * HEARTLAND Risk Score — Type Definitions
 *
 * All types match Protocol v3.3 Table 1 and clinical_content.md.
 * These are consumed by the scoring engine (engine.ts), constants, schema, and UI.
 */

/** 10 binary clinical input variables for the HEARTLAND Risk Score */
export interface RiskInput {
  ageOver75: boolean;
  priorHfHospitalization: boolean;
  egfrBelow45: boolean;
  elevatedNatriuretic: boolean;
  sbpBelow100: boolean;
  diabetes: boolean;
  lvefBelow30: boolean;
  ckmStage3or4: boolean;
  distanceOver50Miles: boolean;
  livesAloneOrLimitedSupport: boolean;
}

/** Risk tier classification: Low (0-4), Moderate (5-8), High (>=9) */
export type RiskTier = 'low' | 'moderate' | 'high';

/** Complete result from the scoring engine */
export interface RiskResult {
  totalScore: number;
  maxScore: number;
  tier: RiskTier;
  tierLabel: string;
  carePathway: CarePathway;
  breakdown: ScoreBreakdown[];
}

/** Tier-specific care pathway recommendation from clinical_content.md */
export interface CarePathway {
  tier: RiskTier;
  followUp: string;
  monitoring: string;
  support: string;
  description: string;
}

/** Individual variable contribution to the total score */
export interface ScoreBreakdown {
  variable: string;
  present: boolean;
  points: number;
}
