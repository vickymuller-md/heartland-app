/**
 * HEARTLAND Patient Vitals -- Supabase Query Helpers
 *
 * Reusable query functions for fetching vitals data.
 * Used by Server Actions and Server Components.
 */

import { subDays } from 'date-fns';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { VitalsRow } from './types';

/**
 * Get recent vitals for a patient within N days.
 * Returns DESC order (most recent first) for red flag comparison.
 */
export async function getRecentVitals(
  supabase: SupabaseClient,
  patientId: string,
  days: number
): Promise<VitalsRow[]> {
  const since = subDays(new Date(), days).toISOString();

  const { data, error } = await supabase
    .from('vitals')
    .select('*')
    .eq('patient_id', patientId)
    .gte('recorded_at', since)
    .order('recorded_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as VitalsRow[];
}

/**
 * Get vitals history for chart display.
 * Returns ASC order (oldest first) for time-series charts.
 */
export async function getVitalsHistory(
  supabase: SupabaseClient,
  patientId: string,
  days: 7 | 30 | 90
): Promise<VitalsRow[]> {
  const since = subDays(new Date(), days).toISOString();

  const { data, error } = await supabase
    .from('vitals')
    .select('*')
    .eq('patient_id', patientId)
    .gte('recorded_at', since)
    .order('recorded_at', { ascending: true });

  if (error) throw error;
  return (data ?? []) as VitalsRow[];
}
