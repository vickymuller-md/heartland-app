/**
 * Discharge Checklist -- Supabase Query Functions
 * Phase 16: DSCH-03 (follow-up queries), DSCH-05 (discharge record)
 *
 * All functions accept a SupabaseClient parameter for use in Server Components
 * via createClient from lib/supabase/server.ts.
 *
 * getPendingFollowupsDueSoon is the integration seam for Phase 14 ALRT-05
 * (follow-up reminder due within 24 hours).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { DischargeRecord, DischargeFollowup } from './types';

/**
 * Get the most recent discharge record for a patient.
 * DSCH-05: Discharge summary saved to patient record
 */
export async function getDischargeRecord(
  supabase: SupabaseClient,
  patientId: string
): Promise<DischargeRecord | null> {
  const { data, error } = await supabase
    .from('discharge_records')
    .select('*')
    .eq('patient_id', patientId)
    .order('discharged_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data as DischargeRecord | null;
}

/**
 * Get all follow-up rows for a discharge record, ordered by due_at.
 * DSCH-03/DSCH-04: Follow-up schedule display and tracking
 */
export async function getDischargeFollowups(
  supabase: SupabaseClient,
  dischargeRecordId: string
): Promise<DischargeFollowup[]> {
  const { data, error } = await supabase
    .from('discharge_followups')
    .select('*')
    .eq('discharge_record_id', dischargeRecordId)
    .order('due_at', { ascending: true });

  if (error) throw error;
  return (data ?? []) as DischargeFollowup[];
}

/**
 * Get pending follow-ups due within a time window.
 * Phase 14 ALRT-05 integration seam: returns follow-ups approaching their due date.
 *
 * @param supabase - Supabase client instance
 * @param providerId - Provider UUID for scoping
 * @param withinHours - Hours ahead to look (default 24)
 * @returns Array of pending follow-ups with patient_id, label, due_at
 */
export async function getPendingFollowupsDueSoon(
  supabase: SupabaseClient,
  providerId: string,
  withinHours: number = 24
): Promise<Array<{ patient_id: string; label: string; due_at: string }>> {
  const cutoff = new Date();
  cutoff.setHours(cutoff.getHours() + withinHours);

  const { data, error } = await supabase
    .from('discharge_followups')
    .select('patient_id, label, due_at')
    .eq('provider_id', providerId)
    .eq('status', 'pending')
    .lte('due_at', cutoff.toISOString());

  if (error) throw error;
  return (data ?? []) as Array<{ patient_id: string; label: string; due_at: string }>;
}
