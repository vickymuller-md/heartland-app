/**
 * ACEi and ARNI drug detection for titration safety (SAFE-07).
 * Pure functions -- no side effects, safe to call in any context.
 *
 * Clinical note: Initiating ARNI (sacubitril/valsartan) within 36 hours of
 * the last ACEi dose carries risk of angioedema per PARADIGM-HF protocol.
 * ACC/AHA 2022 HF Guidelines: 36-hour washout required.
 */

export const ACEI_DRUG_NAMES: readonly string[] = [
  'lisinopril',
  'enalapril',
  'ramipril',
  'captopril',
  'benazepril',
  'perindopril',
  'quinapril',
  'trandolapril',
  'fosinopril',
  'moexipril',
] as const;

export const ARNI_DRUG_NAMES: readonly string[] = [
  'sacubitril',
  'entresto',
] as const;

/** Returns true if any medication in the list is an ACE inhibitor. */
export function detectAceiInMedications(
  medications: { name: string }[],
): boolean {
  return medications.some((med) =>
    ACEI_DRUG_NAMES.some((drug) => med.name.toLowerCase().includes(drug)),
  );
}

/** Returns true if any medication in the list is an ARNI (sacubitril/valsartan). */
export function detectArniInMedications(
  medications: { name: string }[],
): boolean {
  return medications.some((med) =>
    ARNI_DRUG_NAMES.some((drug) => med.name.toLowerCase().includes(drug)),
  );
}
