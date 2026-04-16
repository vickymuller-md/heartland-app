/**
 * HEARTLAND Risk Score — Constants
 *
 * All clinical values sourced from reference/clinical_content.md.
 * RISK_VARIABLES: Table 1 (Section 1.2) — 10 variables with point values
 * CARE_PATHWAYS: Score interpretation (Section 1.2) — tier-specific pathways
 * COMPARISON_TABLE_DATA: Table 6 (Section 1.2) — HEARTLAND vs existing scores
 */

import type { RiskInput, CarePathway, RiskTier } from './types';

/** Risk variable definition with point value and clinical category */
export interface RiskVariable {
  key: keyof RiskInput;
  label: string;
  description: string;
  points: number;
  category: 'Clinical' | 'Laboratory' | 'Cardiac' | 'Comorbidity' | 'Social/Geographic';
}

/**
 * 10 risk variables from Protocol v3.3 Table 1.
 * Maximum possible score: 18 points.
 *
 * Source: clinical_content.md Section 1.2
 */
export const RISK_VARIABLES: RiskVariable[] = [
  {
    key: 'ageOver75',
    label: 'Age \u2265 75 years',
    description: 'Patient is 75 years or older',
    points: 2,
    category: 'Clinical',
  },
  {
    key: 'priorHfHospitalization',
    label: 'Prior HF hospitalization within 6 months',
    description: 'Heart failure hospitalization in the past 6 months',
    points: 3,
    category: 'Clinical',
  },
  {
    key: 'egfrBelow45',
    label: 'eGFR <45 mL/min/1.73m\u00B2',
    description: 'Estimated glomerular filtration rate below 45',
    points: 2,
    category: 'Laboratory',
  },
  {
    key: 'elevatedNatriuretic',
    label: 'BNP \u2265500 pg/mL or NT-proBNP \u22651500 pg/mL',
    description: 'Elevated natriuretic peptide levels',
    points: 2,
    category: 'Laboratory',
  },
  {
    key: 'sbpBelow100',
    label: 'SBP <100 mmHg at admission',
    description: 'Systolic blood pressure below 100 at admission',
    points: 2,
    category: 'Clinical',
  },
  {
    key: 'diabetes',
    label: 'Diabetes mellitus',
    description: 'Diagnosis of diabetes mellitus',
    points: 1,
    category: 'Comorbidity',
  },
  {
    key: 'lvefBelow30',
    label: 'LVEF <30%',
    description: 'Left ventricular ejection fraction below 30%',
    points: 2,
    category: 'Cardiac',
  },
  {
    key: 'ckmStage3or4',
    label: 'CKM Stage 3 or 4',
    description: 'Cardiovascular-kidney-metabolic syndrome stage 3 or 4',
    points: 2,
    category: 'Comorbidity',
  },
  {
    key: 'distanceOver50Miles',
    label: 'Distance to cardiology >50 miles',
    description: 'Patient lives more than 50 miles from cardiology care',
    points: 1,
    category: 'Social/Geographic',
  },
  {
    key: 'livesAloneOrLimitedSupport',
    label: 'Lives alone or limited social support',
    description: 'Patient lives alone or has limited social support network',
    points: 1,
    category: 'Social/Geographic',
  },
];

/**
 * Tier score boundaries.
 * Source: clinical_content.md Section 1.2
 */
export const TIER_THRESHOLDS: Record<RiskTier, { min: number; max: number }> = {
  low: { min: 0, max: 4 },
  moderate: { min: 5, max: 8 },
  high: { min: 9, max: 18 },
} as const;

/**
 * Care pathway recommendations per tier.
 * Source: clinical_content.md Section 1.2 — Score interpretation
 */
export const CARE_PATHWAYS: Record<RiskTier, CarePathway> = {
  low: {
    tier: 'low',
    followUp: 'PCP follow-up within 14 days',
    monitoring: 'Basic self-monitoring',
    support: 'Standard discharge',
    description:
      'Standard discharge pathway with routine primary care follow-up and basic patient self-monitoring of weight and symptoms.',
  },
  moderate: {
    tier: 'moderate',
    followUp: 'PCP follow-up within 7 days; 72-hour telehealth check',
    monitoring: 'Home monitoring',
    support: 'Enhanced bundle',
    description:
      'Enhanced discharge bundle with early telehealth check-in, accelerated PCP follow-up, and structured home monitoring protocol.',
  },
  high: {
    tier: 'high',
    followUp: 'Cardiology input before discharge; 48-hour phone follow-up',
    monitoring: 'CHW or equivalent support',
    support: 'Intensive bundle',
    description:
      'Intensive support bundle requiring cardiology consultation before discharge, rapid phone follow-up, and community health worker engagement.',
  },
};

/**
 * Tailwind CSS color classes for tier-specific visual styling.
 */
export const TIER_COLORS: Record<
  RiskTier,
  { bg: string; border: string; badge: string; text: string }
> = {
  low: {
    bg: 'bg-green-50',
    border: 'border-green-500',
    badge: 'bg-green-100 text-green-800',
    text: 'text-green-700',
  },
  moderate: {
    bg: 'bg-yellow-50',
    border: 'border-yellow-500',
    badge: 'bg-yellow-100 text-yellow-800',
    text: 'text-yellow-700',
  },
  high: {
    bg: 'bg-red-50',
    border: 'border-red-500',
    badge: 'bg-red-100 text-red-800',
    text: 'text-red-700',
  },
} as const;

/**
 * Comparison table data: HEARTLAND vs existing validated scores.
 * Source: clinical_content.md Table 6 (Section 1.2) — 8 characteristics
 */
export const COMPARISON_TABLE_DATA: Array<{
  characteristic: string;
  maggic: string;
  gwtgHf: string;
  shfm: string;
  heartland: string;
}> = [
  {
    characteristic: 'Number of variables',
    maggic: '13',
    gwtgHf: '7',
    shfm: '24+',
    heartland: '10',
  },
  {
    characteristic: 'Outcome predicted',
    maggic: '1-3 year mortality',
    gwtgHf: 'In-hospital mortality',
    shfm: '1-5 year survival',
    heartland: 'Readmission risk + monitoring intensity',
  },
  {
    characteristic: 'Distance to care',
    maggic: 'No',
    gwtgHf: 'No',
    shfm: 'No',
    heartland: 'Yes',
  },
  {
    characteristic: 'Social support',
    maggic: 'No',
    gwtgHf: 'No',
    shfm: 'No',
    heartland: 'Yes',
  },
  {
    characteristic: 'Rurality',
    maggic: 'No',
    gwtgHf: 'No',
    shfm: 'No',
    heartland: 'Yes',
  },
  {
    characteristic: 'Primary care feasibility',
    maggic: 'Moderate',
    gwtgHf: 'Low (hospital-designed)',
    shfm: 'Low (complex)',
    heartland: 'High',
  },
  {
    characteristic: 'Validation status',
    maggic: 'Validated (39,372 pts)',
    gwtgHf: 'Validated (hospital registry)',
    shfm: 'Validated (multiple cohorts)',
    heartland: 'Pragmatic heuristic (not yet validated)',
  },
  {
    characteristic: 'Intended use',
    maggic: 'Prognostic',
    gwtgHf: 'Prognostic',
    shfm: 'Prognostic',
    heartland: 'Clinical decision support',
  },
];
