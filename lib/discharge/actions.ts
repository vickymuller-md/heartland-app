'use server';

/**
 * Discharge Checklist -- Server Actions
 * Phase 16: DSCH-03 (follow-up scheduling), DSCH-04 (contact completion), DSCH-05 (discharge save)
 *
 * saveDischarge: inserts discharge_records + 5 discharge_followups atomically.
 * markContactComplete: updates a follow-up row status to 'completed'.
 *
 * Source: HEARTLAND Protocol v3.3 Module 4, Section 4.4
 */

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { dischargeFormSchema, contactCompleteSchema } from './schema';
import { computeFollowupDates } from './engine';

/**
 * Save a discharge event and auto-create the 5-row follow-up schedule.
 *
 * Parses discharged_at as noon UTC to avoid timezone pitfalls (Research Pitfall 2):
 * HTML date input returns YYYY-MM-DD without timezone; using T12:00:00Z prevents
 * off-by-one-day errors from UTC offset.
 *
 * Caller should disable submit via useTransition to prevent duplicate submissions
 * (Research Pitfall 3).
 */
export async function saveDischarge(
  formData: FormData
): Promise<{ success?: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: 'Not authenticated' };

  // Validate form data
  const raw = {
    patient_id: formData.get('patient_id') as string,
    discharged_at: formData.get('discharged_at') as string,
    facility_tier: formData.get('facility_tier') as string,
    discharge_notes: formData.get('discharge_notes') as string,
  };

  const result = dischargeFormSchema.safeParse(raw);
  if (!result.success) {
    const firstError = result.error.issues[0];
    return { error: firstError?.message ?? 'Validation failed' };
  }

  const { patient_id, discharged_at, facility_tier, discharge_notes } = result.data;

  // Parse as noon UTC to avoid timezone pitfall (Pitfall 2)
  const dischargedDate = new Date(discharged_at + 'T12:00:00Z');
  const tier = facility_tier as 1 | 2 | 3;

  // 1. Insert discharge record
  const { data: record, error: recErr } = await supabase
    .from('discharge_records')
    .insert({
      patient_id,
      provider_id: user.id,
      discharged_at: dischargedDate.toISOString(),
      facility_tier: tier,
      discharge_notes: discharge_notes || null,
    })
    .select('id')
    .single();

  if (recErr) return { error: recErr.message };

  // 2. Compute and insert follow-up schedule
  const schedule = computeFollowupDates(dischargedDate, tier);
  const followups = schedule.map((s) => ({
    discharge_record_id: record.id,
    patient_id,
    provider_id: user.id,
    type: s.type,
    label: s.label,
    due_at: s.due_at.toISOString(),
    purpose: s.purpose,
    status: 'pending' as const,
  }));

  const { error: fuErr } = await supabase
    .from('discharge_followups')
    .insert(followups);

  if (fuErr) return { error: fuErr.message };

  revalidatePath(`/provider/patients/${patient_id}`);
  return { success: true };
}

/**
 * Mark a follow-up contact as completed with optional notes.
 * Only the owning provider (provider_id = auth.uid()) can update.
 */
export async function markContactComplete(
  followupId: string,
  notes?: string
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: 'Not authenticated' };

  // Validate input
  const result = contactCompleteSchema.safeParse({
    followup_id: followupId,
    contact_notes: notes,
  });
  if (!result.success) {
    return { error: result.error.issues[0]?.message ?? 'Validation failed' };
  }

  // Update with provider_id check for app-level enforcement (in addition to RLS)
  const { data, error } = await supabase
    .from('discharge_followups')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      contact_notes: notes || null,
    })
    .eq('id', followupId)
    .eq('provider_id', user.id)
    .select('id');

  if (error) return { error: error.message };

  // Check if RLS silently blocked the update (no rows affected)
  if (!data || data.length === 0) {
    return { error: 'Follow-up not found or not owned by current provider' };
  }

  return {};
}
