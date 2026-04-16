/**
 * HEARTLAND Provider Dashboard -- Metrics Constants
 *
 * RPM CPT billing codes, GDMT drug class keywords, and reimbursement constants.
 *
 * Source: HEARTLAND Protocol v3.3 Module 2; CMS 2023 Physician Fee Schedule (G0511)
 */

// ---------- RPM CPT Codes (METR-03, METR-05) ----------

/** RPM billing codes relevant to rural primary care practices */
export const RPM_CPT_CODES = {
  SETUP: {
    code: 'CPT 99453',
    description: 'Setup and patient education',
    reimbursement: '~$19-21',
  },
  DEVICE: {
    code: 'CPT 99454',
    description: 'Device supply, 16+ days/month',
    reimbursement: '~$50-65',
    threshold_days: 16,
  },
  MANAGEMENT_20: {
    code: 'CPT 99457',
    description: 'Treatment management, first 20 min',
    reimbursement: '~$50-55',
  },
  MANAGEMENT_ADD: {
    code: 'CPT 99458',
    description: 'Additional 20 min',
    reimbursement: '~$40-45',
  },
  RURAL_BUNDLED: {
    code: 'G0511',
    description: 'Rural Health Clinic bundled',
    reimbursement: '~$150-200/month',
  },
} as const;

// ---------- RPM Eligibility Threshold (METR-03) ----------

/**
 * Minimum distinct vitals days per calendar month for CPT 99454 eligibility.
 * Source: CMS 2023 Final Rule (reduced from 20 to 16)
 */
export const RPM_CPT_99454_THRESHOLD = 16;

// ---------- RPM Reimbursement Range (METR-05) ----------

/**
 * Estimated monthly RPM revenue per eligible patient (USD).
 * Based on G0511 rural bundled billing.
 * Actual reimbursement varies by payer, state, and modifier codes.
 */
export const RPM_REIMBURSEMENT_RANGE = { low: 150, high: 200 } as const;

// ---------- GDMT Drug Class Keywords (METR-02) ----------

/**
 * Keyword-based classification of medication names into HFrEF quadruple therapy classes.
 * Case-insensitive matching against the medications.name free-text field.
 *
 * Source: HEARTLAND Protocol v3.3 Module 2 (lib/gdmt/constants.ts drug classes)
 */
export const GDMT_CLASS_KEYWORDS: Record<string, string[]> = {
  ARNI: ['sacubitril', 'entresto'],
  'Beta-blocker': ['carvedilol', 'metoprolol', 'bisoprolol'],
  MRA: ['spironolactone', 'eplerenone', 'finerenone'],
  SGLT2i: ['dapagliflozin', 'empagliflozin', 'farxiga', 'jardiance'],
};
