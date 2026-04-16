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

/** Required ACEi washout before first ARNI dose, in hours. PARADIGM-HF / ACC/AHA 2022. */
export const ACEI_ARNI_WASHOUT_HOURS = 36;

export interface AceiWashoutStatus {
  /** True when the provider should see the 36-hour washout warning. */
  showWarning: boolean;
  /** Human-readable message shown next to the ARNI step. */
  message?: string;
}

/**
 * Decide whether the ACEi-to-ARNI 36-hour washout warning should appear.
 *
 * The warning fires when the current medication list contains an ACEi AND
 * the provider is considering an ARNI (via either the planned-drug list
 * or a simultaneous ARNI entry). It is advisory -- the checklist still
 * allows step progression -- because timing of the last ACEi dose lives
 * outside the app's data model.
 */
export function checkAceiArniWashout(input: {
  medications: { name: string }[];
  arniBeingConsidered: boolean;
}): AceiWashoutStatus {
  const hasAcei = detectAceiInMedications(input.medications);
  const hasArniInList = detectArniInMedications(input.medications);
  const arniOnTheTable = input.arniBeingConsidered || hasArniInList;

  if (hasAcei && arniOnTheTable) {
    return {
      showWarning: true,
      message: `Active ACEi detected. Wait ${ACEI_ARNI_WASHOUT_HOURS}h after the last dose before initiating ARNI to avoid angioedema.`,
    };
  }
  return { showWarning: false };
}
