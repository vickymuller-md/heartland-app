/**
 * Discharge Checklist & Post-Discharge Protocol -- Type Contracts
 * Phase 16: DSCH-01 through DSCH-06
 *
 * Source: HEARTLAND Protocol v3.3 Module 4 (Sections 4.1-4.4)
 */

/** Matches discharge_records table columns */
export interface DischargeRecord {
  id: string;
  patient_id: string;
  provider_id: string;
  discharged_at: string;
  facility_tier: 1 | 2 | 3;
  discharge_notes: string | null;
  bundle_completed: Record<string, boolean>;
  created_at: string;
}

/** Matches discharge_followups table columns */
export interface DischargeFollowup {
  id: string;
  discharge_record_id: string;
  patient_id: string;
  provider_id: string;
  type: 'call_48h' | 'visit_day7' | 'call_week2' | 'call_week3' | 'call_week4';
  label: string;
  due_at: string;
  purpose: string | null;
  status: 'pending' | 'completed' | 'skipped';
  completed_at: string | null;
  contact_notes: string | null;
  created_at: string;
}

/** Discharge bundle component (Protocol Section 4.1) */
export interface BundleComponent {
  id: string;
  label: string;
  timing: string;
  tier1: string;
  tier23: string;
}

/** Task-shifting framework row (Protocol Section 4.2) */
export interface TaskShiftRow {
  id: string;
  task: string;
  optimal: string;
  alternatives: string;
  no_chw: string;
}

/** Computed follow-up schedule item from engine.ts */
export interface FollowupSchedule {
  type: 'call_48h' | 'visit_day7' | 'call_week2' | 'call_week3' | 'call_week4';
  label: string;
  due_at: Date;
  purpose: string;
  tier1_mode: string;
  tier23_mode: string;
}

/** Teach-back education domain (Protocol Section 4.3) */
export interface TeachBackDomain {
  id: string;
  title: string;
  description: string;
  tier: 'all' | 'tier23';
}
