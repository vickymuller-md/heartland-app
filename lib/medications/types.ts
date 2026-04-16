/**
 * HEARTLAND Medication Tracking -- Type Definitions
 *
 * Types for medication CRUD, dose logging, reminders, and adherence.
 * Matches Supabase schema (medications, medication_logs, medication_reminders tables).
 */

/** Medication dosing frequency options */
export type MedicationFrequency =
  | 'once_daily'
  | 'twice_daily'
  | 'three_times_daily'
  | 'four_times_daily'
  | 'as_needed'
  | 'weekly';

/** Row from the medications table (Supabase) */
export interface MedicationRow {
  id: string;
  patient_id: string;
  name: string;
  dosage: string;
  frequency: MedicationFrequency;
  timing: string[];
  active: boolean;
  created_at: string;
}

/** Row from the medication_logs table (Supabase) */
export interface MedicationLog {
  id: string;
  medication_id: string;
  patient_id: string;
  scheduled_date: string; // YYYY-MM-DD
  dose_number: number; // 1-4
  taken: boolean;
  taken_at: string | null;
  created_at: string;
}

/** Row from the medication_reminders table (Supabase) */
export interface MedicationReminder {
  id: string;
  medication_id: string;
  patient_id: string;
  reminder_time: string; // HH:MM:SS
  timezone: string;
  enabled: boolean;
  last_sent_at: string | null;
  created_at: string;
}

/** Computed adherence status for a single day */
export interface AdherenceDay {
  date: string; // YYYY-MM-DD
  totalDoses: number;
  takenDoses: number;
  status: 'complete' | 'partial' | 'missed' | 'future' | 'no_meds';
}

/** Server Action return state for medication operations */
export interface MedicationActionState {
  success?: boolean;
  error?: string;
  errors?: Record<string, string[]>;
}
