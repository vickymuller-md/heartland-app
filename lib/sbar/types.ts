/**
 * SBAR Handoff Generator -- Type Contracts
 * Phase 15: SBAR-02 (auto-populate from patient data)
 *
 * SbarInput: all patient data needed to pre-fill an SBAR form.
 * SbarData: the 4 pre-filled text sections returned by populateSbar.
 */

import type { EffectiveLabObservation } from '@/lib/labs/effective';

/** Shared text-section context; carries no claim of authenticated laboratory provenance. */
export interface SbarContext {
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
  risk_tier: 'low' | 'moderate' | 'high' | null;
  track_assignment: 'A' | 'B' | 'hybrid' | null;
  facility_tier: number | null;
}

/** Authenticated source projection only. Synthetic fixtures use their own explicit adapter. */
export interface SbarInput extends SbarContext {
  patient_id: string;
  labs: EffectiveLabObservation[];
}

export const SBAR_DRAFT_NOTICE = 'Editable draft; manual changes may differ from source records. Not sent; clinical review and receiving-team acknowledgement are not confirmed. Source data are not refreshed when editing or printing.';

export interface SbarData {
  situation: string;
  background: string;
  assessment: string;
  recommendation: string;
}
