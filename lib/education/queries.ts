/**
 * HEARTLAND Patient Education -- Supabase Query Helpers
 *
 * Reusable query functions for fetching education progress.
 * Used by Server Components and the Phase 10 provider dashboard.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  EducationDomain,
  EducationProgress,
  EducationTeachback,
} from './types';
import { EDUCATION_DOMAINS } from './constants';

/**
 * Get all education progress records for a patient.
 * Returns one record per domain that has been attempted.
 */
export async function getEducationProgress(
  supabase: SupabaseClient,
  patientId: string
): Promise<EducationProgress[]> {
  const { data, error } = await supabase
    .from('education_progress')
    .select('*')
    .eq('patient_id', patientId);

  if (error) throw error;
  return (data ?? []) as EducationProgress[];
}

/**
 * Get education summary for provider dashboard (Phase 10).
 * Returns completion counts and per-domain status.
 *
 * `availableDomains` is the set the patient was actually offered, so the
 * completion rate is never read against domains the patient never saw.
 */
export async function getEducationSummary(
  supabase: SupabaseClient,
  patientId: string,
  availableDomains: EducationDomain[] = EDUCATION_DOMAINS
): Promise<{
  totalDomains: number;
  completedDomains: number;
  completionRate: number;
  domains: Array<{
    id: string;
    title: string;
    completed: boolean;
    attempts: number;
  }>;
}> {
  const progress = await getEducationProgress(supabase, patientId);
  const progressMap = new Map(progress.map((p) => [p.domain_id, p]));

  const domains = availableDomains.map((d) => {
    const p = progressMap.get(d.id);
    return {
      id: d.id,
      title: d.title,
      completed: p?.completed ?? false,
      attempts: p?.attempts ?? 0,
    };
  });

  const completedDomains = domains.filter((d) => d.completed).length;
  const totalDomains = domains.length;

  return {
    totalDomains,
    completedDomains,
    completionRate:
      totalDomains > 0
        ? Math.round((completedDomains / totalDomains) * 100)
        : 0,
    domains,
  };
}

/**
 * Newest professional teach-back per education domain (migration 00040).
 *
 * Domains with no event are absent from the result: the caller derives
 * `pending` for them and never reports them as verified. This is read through
 * the RPC rather than an embed, so no `profiles` join reaches PostgREST.
 */
export async function getEducationTeachbackState(
  supabase: SupabaseClient,
  patientId: string
): Promise<{ teachbacks: EducationTeachback[]; error: string | null }> {
  const { data, error } = await supabase.rpc('get_education_teachback_state', {
    p_patient_id: patientId,
  });

  if (error) {
    return {
      teachbacks: [],
      error: 'Teach-back records could not be loaded.',
    };
  }

  return { teachbacks: (data ?? []) as EducationTeachback[], error: null };
}
