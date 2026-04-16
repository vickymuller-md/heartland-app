/**
 * HEARTLAND Risk Score — Scoring Engine
 *
 * Pure functions with zero async, zero server/API imports.
 * Input: 10 boolean clinical variables
 * Output: Total score (0-18), tier (Low/Moderate/High), care pathway, breakdown
 *
 * Source: Protocol v3.3 Table 1 (clinical_content.md Section 1.2)
 */

import { RISK_VARIABLES, CARE_PATHWAYS } from './constants';
import type { RiskInput, RiskResult, RiskTier, ScoreBreakdown } from './types';

/**
 * Classify a numeric score into a risk tier.
 *
 * @param score - Total risk score (0-18)
 * @returns Risk tier: 'low' (0-4), 'moderate' (5-8), 'high' (>=9)
 */
export function classifyTier(score: number): RiskTier {
  if (score <= 4) return 'low';
  if (score <= 8) return 'moderate';
  return 'high';
}

/**
 * Calculate the HEARTLAND Risk Score from 10 binary clinical inputs.
 *
 * Maps each variable to its protocol-defined point value, sums the total,
 * classifies the tier, and returns the full result with care pathway.
 *
 * @param input - 10 boolean clinical variables (RiskInput)
 * @returns Complete scoring result (RiskResult)
 */
export function calculateRiskScore(input: RiskInput): RiskResult {
  const breakdown: ScoreBreakdown[] = RISK_VARIABLES.map((v) => ({
    variable: v.label,
    present: input[v.key],
    points: input[v.key] ? v.points : 0,
  }));

  const totalScore = breakdown.reduce((sum, b) => sum + b.points, 0);
  const tier = classifyTier(totalScore);

  return {
    totalScore,
    maxScore: 18,
    tier,
    tierLabel: tier.charAt(0).toUpperCase() + tier.slice(1),
    carePathway: CARE_PATHWAYS[tier],
    breakdown,
  };
}
