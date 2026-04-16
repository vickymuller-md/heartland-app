/**
 * Patient Onboarding Wizard -- Supabase Queries
 * Requirements: ONBD-03
 * Source: HEARTLAND Protocol v3.3
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Get the current setup bitmask for a patient.
 * Returns 0 on error (safe default -- all steps incomplete).
 */
export async function getSetupStatus(
  supabase: SupabaseClient,
  patientId: string
): Promise<number> {
  const { data, error } = await supabase
    .from('patients')
    .select('setup_completed_steps')
    .eq('id', patientId)
    .single();

  if (error || !data) return 0;
  return data.setup_completed_steps ?? 0;
}
