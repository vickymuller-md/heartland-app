/**
 * Shared types for Phase 12: Tool Integration -- Save Results to Patient Profile
 *
 * Used by all Server Actions in actions.ts and consumed by tool pages.
 */

/** Generic result type for all save operations */
export interface SaveResult {
  success: boolean;
  error?: string;
}

/** Data structure for titration note formatting */
export interface TitrationNoteData {
  vitals: {
    sbp: number;
    hr: number;
    potassium: number | null;
    creatinine: number | null;
    egfr?: number | null;               // eGFR from labs (mL/min/1.73m²)
    labDate?: string | null;            // collected_at ISO string for lab currency display
    creatinineBaseline?: number | null; // baseline Cr for audit trail
  };
  safetyGateResults: Array<{ parameter: string; status: string }>;
  titrationAction: { action: string; details: string };
  perDrugRecommendations?: Array<{ drugClass: string; action: string; reason: string }>;
  medicationChanges?: Array<{ name: string; fromDose: string; toDose: string }>;
  symptomsReported?: string;
  providerNotes: string;
  nextCallDate: string;
}

/** Input type for GDMT medication save */
export interface GdmtMedicationInput {
  name: string;
  dosage: string;
  frequency: string;
}
