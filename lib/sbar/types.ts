/**
 * SBAR Handoff Generator -- Type Contracts
 * Phase 15: SBAR-02 (auto-populate from patient data)
 *
 * SbarInput: all patient data needed to pre-fill an SBAR form.
 * SbarData: the 4 pre-filled text sections returned by populateSbar.
 */

export interface SbarInput {
  patient_name: string;
  vitals: {
    recorded_at: string;
    weight_lbs: number | null;
    sbp: number | null;
    dbp: number | null;
    heart_rate: number | null;
    spo2: number | null;
  } | null;
  medications: Array<{ name: string; dosage: string; frequency: string }>;
  labs: Array<{
    collected_at: string;
    potassium: number | null;
    creatinine: number | null;
    egfr: number | null;
    bnp: number | null;
    nt_probnp: number | null;
    sodium: number | null;
  }>;
  risk_tier: 'low' | 'moderate' | 'high' | null;
  track_assignment: 'A' | 'B' | 'hybrid' | null;
  facility_tier: number | null;
}

export interface SbarData {
  situation: string;
  background: string;
  assessment: string;
  recommendation: string;
}
