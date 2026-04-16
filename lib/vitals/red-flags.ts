/**
 * HEARTLAND Patient Vitals -- Red Flag Detection Engine
 *
 * Pure function that evaluates current vitals against protocol-defined
 * thresholds. No side effects, no DB access -- purely deterministic.
 *
 * Source: HEARTLAND Protocol v3.3, Module 5, Section 5.2 Red Flag Alert Criteria
 *
 * Thresholds:
 *   1. Weight gain >= 3 lbs in 2 days (warning)
 *   2. Weight gain >= 5 lbs in 7 days (critical)
 *   3. SBP < 90 mmHg with symptoms (critical)
 *   4. SpO2 < 92% (critical)
 *   5. Severe dyspnea at rest, severity 3 (critical)
 */

import { isAfter, subDays } from 'date-fns';
import { RED_FLAG_CRITERIA } from './constants';
import type { RedFlag } from './types';

/**
 * Evaluate red flag criteria against current vitals and recent history.
 *
 * @param current - Current vitals submission (weight in lbs, SBP, SpO2)
 * @param recentHistory - Recent vitals records for trend comparison (DESC order)
 * @param symptoms - Current symptom severity values
 * @returns Array of triggered red flags (empty = no alerts)
 */
export function evaluateRedFlags(
  current: { weight_lbs: number; sbp: number; spo2: number | null },
  recentHistory: Array<{ weight_lbs: number; recorded_at: string }>,
  symptoms: {
    dyspnea: number;
    edema: number;
    orthopnea: boolean;
    fatigue: number;
  }
): RedFlag[] {
  const flags: RedFlag[] = [];

  // --- Weight-trend checks (skip if no history -- first entry) ---
  if (recentHistory.length > 0) {
    // 1. Weight gain >= 3 lbs in 2 days (warning)
    const twoDayCutoff = subDays(new Date(), RED_FLAG_CRITERIA.weight_gain_3lb_2d.windowDays);
    const twoDayEntries = recentHistory.filter((v) =>
      isAfter(new Date(v.recorded_at), twoDayCutoff)
    );
    if (twoDayEntries.length > 0) {
      const minWeight2d = Math.min(...twoDayEntries.map((v) => v.weight_lbs));
      if (current.weight_lbs - minWeight2d >= RED_FLAG_CRITERIA.weight_gain_3lb_2d.threshold) {
        const c = RED_FLAG_CRITERIA.weight_gain_3lb_2d;
        flags.push({ id: c.id, severity: c.severity, message: c.message, action: c.action });
      }
    }

    // 2. Weight gain >= 5 lbs in 7 days (critical)
    const sevenDayCutoff = subDays(new Date(), RED_FLAG_CRITERIA.weight_gain_5lb_7d.windowDays);
    const sevenDayEntries = recentHistory.filter((v) =>
      isAfter(new Date(v.recorded_at), sevenDayCutoff)
    );
    if (sevenDayEntries.length > 0) {
      const minWeight7d = Math.min(...sevenDayEntries.map((v) => v.weight_lbs));
      if (current.weight_lbs - minWeight7d >= RED_FLAG_CRITERIA.weight_gain_5lb_7d.threshold) {
        const c = RED_FLAG_CRITERIA.weight_gain_5lb_7d;
        flags.push({ id: c.id, severity: c.severity, message: c.message, action: c.action });
      }
    }
  }

  // 3. SBP < 90 with symptoms (critical)
  // Only triggers if SBP < threshold AND patient has symptoms (dyspnea > 0 OR fatigue > 1)
  if (
    current.sbp < RED_FLAG_CRITERIA.sbp_low_symptomatic.threshold &&
    (symptoms.dyspnea > 0 || symptoms.fatigue > 1)
  ) {
    const c = RED_FLAG_CRITERIA.sbp_low_symptomatic;
    flags.push({ id: c.id, severity: c.severity, message: c.message, action: c.action });
  }

  // 4. SpO2 < 92% (critical) -- skip if null (not provided)
  if (current.spo2 !== null && current.spo2 < RED_FLAG_CRITERIA.spo2_low.threshold) {
    const c = RED_FLAG_CRITERIA.spo2_low;
    flags.push({ id: c.id, severity: c.severity, message: c.message, action: c.action });
  }

  // 5. Severe dyspnea at rest (critical) -- severity level 3
  if (symptoms.dyspnea >= RED_FLAG_CRITERIA.dyspnea_rest.threshold) {
    const c = RED_FLAG_CRITERIA.dyspnea_rest;
    flags.push({ id: c.id, severity: c.severity, message: c.message, action: c.action });
  }

  return flags;
}
