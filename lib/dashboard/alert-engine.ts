/**
 * HEARTLAND Alert Evaluation Engine -- Pure Functions
 *
 * No Supabase dependency -- importable by both the Next.js app and
 * the Deno Edge Function. All functions are pure and deterministic.
 *
 * Clinical thresholds from HEARTLAND Protocol v3.3 Module 5 Section 5.2:
 *   - Weight gain >= 3 lbs in 2 days -> weight_gain_3lb_2d
 *   - Weight gain >= 5 lbs in 7 days -> weight_gain_5lb_7d
 *   - SBP < 90 mmHg -> sbp_low
 *   - SpO2 < 92% at rest -> spo2_low
 *   - Symptom red_flag = true -> symptom_red_flag
 *   - Dyspnea severity = 3 -> dyspnea_severe
 */

import {
  CRITICAL_THRESHOLDS,
  CRITICAL_FLAGS,
  STATUS_PRIORITY,
  RISK_TIER_PRIORITY,
  PROACTIVE_FLAG_SEVERITY,
} from './constants';
import type {
  AlertFlag,
  AlertSeverity,
  AlertVitalsInput,
  RecentVitalsEntry,
  RecentSymptomInput,
  ExistingAlertForDedup,
  PatientWithStatus,
  SortKey,
} from './types';
import type { AdherenceDay } from '@/lib/medications/types';

// ---------- Constants for time windows ----------
const MS_PER_DAY = 86_400_000;

/**
 * Evaluate vitals + symptoms against HEARTLAND Protocol red flag criteria.
 *
 * @param currentVitals - The newly recorded vitals
 * @param recentVitals  - Previous vitals within the comparison window (ordered by recorded_at ASC)
 * @param recentSymptom - Most recent symptom entry (null if none)
 * @returns Array of triggered AlertFlag names
 */
export function evaluateAlertFlags(
  currentVitals: AlertVitalsInput,
  recentVitals: RecentVitalsEntry[],
  recentSymptom: RecentSymptomInput | null
): AlertFlag[] {
  const flags: AlertFlag[] = [];

  // 1. SBP < 90 mmHg
  if (currentVitals.sbp !== null && currentVitals.sbp < CRITICAL_THRESHOLDS.SBP_LOW) {
    flags.push('sbp_low');
  }

  // 2. SpO2 < 92%
  if (currentVitals.spo2 !== null && currentVitals.spo2 < CRITICAL_THRESHOLDS.SPO2_LOW) {
    flags.push('spo2_low');
  }

  // 3. Weight checks (skip if current weight is null)
  if (currentVitals.weight_lbs !== null) {
    const currentRecordedAt = new Date(currentVitals.recorded_at).getTime();

    // Filter to entries with non-null weight
    const weightEntries = recentVitals.filter(
      (v) => v.weight_lbs !== null
    ) as Array<{ weight_lbs: number; recorded_at: string }>;

    // 3a. Weight gain >= 3 lbs in 2 days
    const twoDayCutoff = currentRecordedAt - 2 * MS_PER_DAY;
    const entriesWithin2d = weightEntries.filter(
      (v) => new Date(v.recorded_at).getTime() >= twoDayCutoff
    );
    if (entriesWithin2d.length > 0) {
      // Compare against the minimum weight in the 2-day window
      // (per Phase 7 decision: compare vs minimum, not average)
      const minWeight2d = Math.min(...entriesWithin2d.map((v) => v.weight_lbs));
      const gain2d = currentVitals.weight_lbs - minWeight2d;
      if (gain2d >= CRITICAL_THRESHOLDS.WEIGHT_GAIN_2D_LBS) {
        flags.push('weight_gain_3lb_2d');
      }
    }

    // 3b. Weight gain >= 5 lbs in 7 days
    const sevenDayCutoff = currentRecordedAt - 7 * MS_PER_DAY;
    const entriesWithin7d = weightEntries.filter(
      (v) => new Date(v.recorded_at).getTime() >= sevenDayCutoff
    );
    if (entriesWithin7d.length > 0) {
      const minWeight7d = Math.min(...entriesWithin7d.map((v) => v.weight_lbs));
      const gain7d = currentVitals.weight_lbs - minWeight7d;
      if (gain7d >= CRITICAL_THRESHOLDS.WEIGHT_GAIN_7D_LBS) {
        flags.push('weight_gain_5lb_7d');
      }
    }
  }

  // 4. Symptom-based flags
  if (recentSymptom) {
    if (recentSymptom.red_flag === true) {
      flags.push('symptom_red_flag');
    }
    if (recentSymptom.dyspnea === 3) {
      flags.push('dyspnea_severe');
    }
  }

  return flags;
}

/**
 * Determine alert severity from triggered flags.
 * Critical if any flag is in the CRITICAL_FLAGS set; otherwise warning.
 */
export function determineSeverity(flags: string[]): AlertSeverity {
  const hasCritical = flags.some((f) =>
    (CRITICAL_FLAGS as string[]).includes(f)
  );
  return hasCritical ? 'critical' : 'warning';
}

/**
 * Check if a flag should be deduplicated against existing open alerts.
 * Returns true if an open/acknowledged alert containing this flag
 * was created within the specified hours window.
 *
 * @param flag           - The flag to check
 * @param existingAlerts - Current open/acknowledged alerts for the patient
 * @param hoursWindow    - Deduplication window in hours (default 24)
 * @param now            - Current timestamp (for testing)
 */
export function shouldDeduplicate(
  flag: string,
  existingAlerts: ExistingAlertForDedup[],
  hoursWindow: number = 24,
  now: Date = new Date()
): boolean {
  const cutoff = now.getTime() - hoursWindow * 3_600_000;

  return existingAlerts.some(
    (alert) =>
      (alert.status === 'open' || alert.status === 'acknowledged') &&
      alert.flags.includes(flag) &&
      new Date(alert.created_at).getTime() >= cutoff
  );
}

/**
 * Sort patients by the given key.
 *
 * - 'status':      by STATUS_PRIORITY, then open_alert_count desc
 * - 'vitals_date': by last_vitals_at desc, nulls last
 * - 'risk_tier':   by RISK_TIER_PRIORITY, nulls last
 *
 * Uses a stable sort (Array.prototype.sort in modern engines is stable).
 */
export function sortPatients(
  patients: PatientWithStatus[],
  sortKey: SortKey
): PatientWithStatus[] {
  const sorted = [...patients];

  sorted.sort((a, b) => {
    switch (sortKey) {
      case 'status': {
        const aPriority = STATUS_PRIORITY[a.status] ?? 99;
        const bPriority = STATUS_PRIORITY[b.status] ?? 99;
        if (aPriority !== bPriority) return aPriority - bPriority;
        // Secondary: higher alert count first
        return b.open_alert_count - a.open_alert_count;
      }

      case 'vitals_date': {
        // Nulls last
        if (!a.last_vitals_at && !b.last_vitals_at) return 0;
        if (!a.last_vitals_at) return 1;
        if (!b.last_vitals_at) return -1;
        // Most recent first (descending)
        return new Date(b.last_vitals_at).getTime() - new Date(a.last_vitals_at).getTime();
      }

      case 'risk_tier': {
        const aRisk = a.risk_tier !== null ? (RISK_TIER_PRIORITY[a.risk_tier] ?? 99) : 99;
        const bRisk = b.risk_tier !== null ? (RISK_TIER_PRIORITY[b.risk_tier] ?? 99) : 99;
        return aRisk - bRisk;
      }

      default:
        return 0;
    }
  });

  return sorted;
}

// ---------- Proactive Alert Detection Functions (Phase 14) ----------

/**
 * Detect patients who haven't logged vitals within the threshold period.
 * Includes a grace period for newly created patients.
 *
 * @param lastVitalsAt    - ISO timestamp of last vitals entry (null = never)
 * @param patientCreatedAt - ISO timestamp of patient account creation
 * @param thresholdDays   - Number of days without check-in to trigger (default 3)
 * @param now             - Current timestamp (for testing)
 * @returns true if no check-in detected and grace period has passed
 */
export function evaluateNoCheckin(
  lastVitalsAt: string | null,
  patientCreatedAt: string,
  thresholdDays: number = 3,
  now: Date = new Date()
): boolean {
  const thresholdMs = thresholdDays * MS_PER_DAY;
  const nowMs = now.getTime();

  // Grace period: patient created less than thresholdDays ago -- don't flag
  const createdMs = new Date(patientCreatedAt).getTime();
  if (nowMs - createdMs <= thresholdMs) {
    return false;
  }

  // If never logged vitals and past grace period -> flag
  if (lastVitalsAt === null) {
    return true;
  }

  // Check if last vitals is strictly more than thresholdDays ago
  const lastMs = new Date(lastVitalsAt).getTime();
  return (nowMs - lastMs) > thresholdMs;
}

/**
 * Detect low medication adherence based on adherence day data.
 * Only counts actionable days (excludes no_meds and future).
 *
 * @param adherenceDays - Array of daily adherence records
 * @param thresholdPct  - Percentage below which adherence is "low" (default 70)
 * @returns true if adherence rate is below threshold
 */
export function evaluateLowAdherence(
  adherenceDays: AdherenceDay[],
  thresholdPct: number = 70
): boolean {
  // Filter to actionable days only (not no_meds or future)
  const actionable = adherenceDays.filter(
    (d) => d.status !== 'no_meds' && d.status !== 'future'
  );

  // No actionable days -> no meaningful adherence to evaluate
  if (actionable.length === 0) return false;

  const completeDays = actionable.filter((d) => d.status === 'complete').length;
  const rate = (completeDays / actionable.length) * 100;

  return rate < thresholdPct;
}

/**
 * Detect gradual weight gain trend over a 7-day window.
 * Sorts entries by recorded_at to ensure correct oldest/newest comparison.
 *
 * @param vitalsWindow   - Weight entries within the window
 * @param gainThreshold  - Pounds gain to trigger (default 2, strictly greater than)
 * @returns true if weight gain from oldest to newest exceeds threshold
 */
export function evaluateWeightTrend7d(
  vitalsWindow: Array<{ weight_lbs: number; recorded_at: string }>,
  gainThreshold: number = 2
): boolean {
  if (vitalsWindow.length < 2) return false;

  // Sort by recorded_at ascending (oldest first)
  const sorted = [...vitalsWindow].sort(
    (a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
  );

  const oldest = sorted[0].weight_lbs;
  const newest = sorted[sorted.length - 1].weight_lbs;
  const gain = newest - oldest;

  return gain > gainThreshold;
}

/**
 * Detect critical lab values that require provider attention.
 *
 * @param lab - Object with potassium (mEq/L) and eGFR (mL/min) values
 * @returns Array of triggered flag names ('hyperkalemia', 'low_egfr')
 */
export function evaluateCriticalLabs(lab: {
  potassium: number | null;
  egfr: number | null;
}): string[] {
  const flags: string[] = [];

  if (lab.potassium !== null && lab.potassium > 5.5) {
    flags.push('hyperkalemia');
  }

  if (lab.egfr !== null && lab.egfr < 30) {
    flags.push('low_egfr');
  }

  return flags;
}

/**
 * Detect follow-ups that are due within the specified time window.
 *
 * @param scheduledAt  - ISO timestamp of the scheduled follow-up
 * @param completed    - Whether the follow-up has been completed
 * @param hoursWindow  - Hours before the follow-up to start alerting (default 24)
 * @param now          - Current timestamp (for testing)
 * @returns true if follow-up is due within window and not completed
 */
export function evaluateFollowupDue(
  scheduledAt: string,
  completed: boolean,
  hoursWindow: number = 24,
  now: Date = new Date()
): boolean {
  if (completed) return false;

  const scheduledMs = new Date(scheduledAt).getTime();
  const nowMs = now.getTime();
  const windowMs = hoursWindow * 3_600_000;

  // Follow-up is due if it's within the window from now
  const timeUntil = scheduledMs - nowMs;
  return timeUntil >= 0 && timeUntil <= windowMs;
}

/**
 * Detect follow-ups that are overdue (past scheduled time, not completed).
 * Returns severity based on how overdue:
 *   - 24h-72h overdue -> 'warning'
 *   - >72h overdue -> 'critical'
 *
 * SAFE-05: Catches dropped post-discharge calls already past due.
 *
 * @param scheduledAt  - ISO timestamp of the scheduled follow-up
 * @param completed    - Whether the follow-up has been completed
 * @param now          - Current timestamp (for testing)
 * @returns { severity } or null if not overdue
 */
export function evaluateFollowupOverdue(
  scheduledAt: string,
  completed: boolean,
  now: Date = new Date()
): { overdue: boolean; severity: 'warning' | 'critical' } | null {
  if (completed) return null;

  const overdueMs = now.getTime() - new Date(scheduledAt).getTime();
  if (overdueMs <= 0) return null; // not yet past due

  const overdueHours = overdueMs / 3_600_000;
  if (overdueHours >= 72) return { overdue: true, severity: 'critical' };
  if (overdueHours >= 24) return { overdue: true, severity: 'warning' };
  return null; // overdue but less than 24h, not yet alert-worthy
}

/**
 * Classify a proactive alert flag into its severity level.
 * Looks up PROACTIVE_FLAG_SEVERITY map, falls back to 'informational'.
 *
 * @param flag - The proactive alert flag name
 * @returns AlertSeverity level
 */
export function classifyProactiveSeverity(flag: string): AlertSeverity {
  return PROACTIVE_FLAG_SEVERITY[flag] ?? 'informational';
}
