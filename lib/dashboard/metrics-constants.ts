/**
 * HEARTLAND Provider Dashboard -- Metrics Constants
 *
 * App data-completeness marker and GDMT drug-class keywords.
 */

// ---------- RPM data-completeness marker ----------

/**
 * Product-operations marker only. It is not a billing eligibility rule: the
 * app accepts manual entries and does not prove connected-device transmission.
 */
export const RPM_CPT_99454_THRESHOLD = 16;

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
