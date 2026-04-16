/**
 * HEARTLAND Patient Vitals & Symptoms -- Constants
 *
 * Red flag thresholds, severity configurations, and symptom labels.
 * Source: HEARTLAND Protocol v3.3, Module 5, Section 5.2
 */

import type { RedFlag } from './types';

/**
 * Red Flag Alert Criteria
 * HEARTLAND Protocol v3.3, Module 5, Section 5.2
 *
 * Each criterion defines the threshold, detection window, severity level,
 * patient-facing message, and action guidance.
 */
export const RED_FLAG_CRITERIA = {
  weight_gain_3lb_2d: {
    id: 'weight_gain_3lb_2d',
    threshold: 3, // lbs
    windowDays: 2,
    severity: 'warning' as const,
    message: 'Weight gain of 3+ lbs in 2 days detected',
    action: 'Call your clinic today',
  },
  weight_gain_5lb_7d: {
    id: 'weight_gain_5lb_7d',
    threshold: 5, // lbs
    windowDays: 7,
    severity: 'critical' as const,
    message: 'Weight gain of 5+ lbs in 1 week detected',
    action: 'Seek urgent evaluation within 24 hours',
  },
  sbp_low_symptomatic: {
    id: 'sbp_low_symptomatic',
    threshold: 90, // mmHg (below this)
    severity: 'critical' as const,
    message: 'Low blood pressure with symptoms',
    action: 'Hold GDMT medications and call your provider immediately',
  },
  spo2_low: {
    id: 'spo2_low',
    threshold: 92, // % (below this)
    severity: 'critical' as const,
    message: 'Low oxygen saturation (<92%)',
    action: 'Seek urgent evaluation',
  },
  dyspnea_rest: {
    id: 'dyspnea_rest',
    threshold: 3, // severity level (severe / at rest)
    severity: 'critical' as const,
    message: 'Severe shortness of breath at rest',
    action: 'Seek same-day evaluation',
  },
} as const satisfies Record<
  string,
  {
    id: string;
    threshold?: number;
    windowDays?: number;
    severity: 'warning' | 'critical';
    message: string;
    action: string;
  }
>;

/**
 * Plausibility boundaries -- values outside these are suspicious and trigger
 * a "verify measurement" warning but do NOT block submission. Distinct from
 * the harder Zod bounds (which prevent obviously broken input like HR=0).
 *
 * Rationale: a lone HR=185 reading or a 30-lb overnight weight jump is far
 * more likely to be a fat-finger or malfunctioning device than a real event.
 * Firing a critical alert on these creates alarm fatigue; silently accepting
 * them corrupts trend data.
 */
export const PLAUSIBILITY_BOUNDS = {
  weight_lbs: { min: 80, max: 400 },
  sbp: { min: 70, max: 210 },
  dbp: { min: 35, max: 130 },
  heart_rate: { min: 35, max: 170 },
  spo2: { min: 80, max: 100 },
  /** Relative weight delta (fraction of prior weight) suggesting scale error. */
  weight_delta_pct: 0.2,
} as const;

/**
 * Severity configuration for red flag display styling
 */
export const SEVERITY_CONFIG = {
  warning: {
    color: 'amber',
    icon: 'AlertTriangle',
    title: 'Warning',
  },
  critical: {
    color: 'red',
    icon: 'AlertOctagon',
    title: 'Critical Alert',
  },
} as const satisfies Record<
  'warning' | 'critical',
  { color: string; icon: string; title: string }
>;

/**
 * Symptom severity scale labels and descriptions
 * Used by RadioGroup in the symptom form
 */
export const SYMPTOM_SEVERITY = [
  {
    value: 0,
    label: 'None',
    description: 'No symptoms',
  },
  {
    value: 1,
    label: 'Mild',
    description: 'Noticeable but not limiting',
  },
  {
    value: 2,
    label: 'Moderate',
    description: 'Limits some daily activities',
  },
  {
    value: 3,
    label: 'Severe',
    description: 'Significantly limits daily activities',
  },
] as const satisfies ReadonlyArray<{
  value: number;
  label: string;
  description: string;
}>;
