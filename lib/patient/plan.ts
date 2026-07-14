import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

export interface PatientPlanItem {
  id: string;
  title: string;
  dueAt: string;
  status: string;
  detail: string | null;
  source: 'scheduled' | 'discharge';
}

export interface PatientCareContact {
  name: string;
  phone: string | null;
}

export interface PatientPlan {
  items: PatientPlanItem[];
  careContact: PatientCareContact | null;
  error: string | null;
  contactError: string | null;
}

export async function getPatientPlan(
  supabase: SupabaseClient,
  patientId: string,
): Promise<PatientPlan> {
  const [scheduled, discharge, accessHistory] = await Promise.all([
    supabase
      .from('scheduled_followups')
      .select('id, scheduled_at, type, notes, completed')
      .eq('patient_id', patientId)
      .eq('completed', false)
      .order('scheduled_at', { ascending: true })
      .limit(20),
    supabase
      .from('discharge_followups')
      .select('id, due_at, label, purpose, status')
      .eq('patient_id', patientId)
      .eq('status', 'pending')
      .order('due_at', { ascending: true })
      .limit(20),
    supabase.rpc('get_patient_access_history'),
  ]);

  if (scheduled.error || discharge.error) {
    return {
      items: [],
      careContact: null,
      error: 'Your care plan could not be loaded. This does not mean there are no follow-ups.',
      contactError: accessHistory.error ? 'Care-team contact could not be loaded.' : null,
    };
  }

  const items: PatientPlanItem[] = [
    ...(scheduled.data ?? []).map((item) => ({
      id: item.id,
      title: item.type.replaceAll('_', ' '),
      dueAt: item.scheduled_at,
      status: 'scheduled',
      detail: item.notes,
      source: 'scheduled' as const,
    })),
    ...(discharge.data ?? []).map((item) => ({
      id: item.id,
      title: item.label,
      dueAt: item.due_at,
      status: item.status,
      detail: item.purpose,
      source: 'discharge' as const,
    })),
  ].sort((a, b) => a.dueAt.localeCompare(b.dueAt));

  const providerRecord = (accessHistory.data ?? []).find(
    (entry: { status?: string }) => entry.status === 'active',
  ) as { provider_name?: unknown; provider_phone?: unknown } | undefined;

  return {
    items,
    careContact: providerRecord ? {
      name: typeof providerRecord.provider_name === 'string'
        ? providerRecord.provider_name
        : 'Care team',
      phone: typeof providerRecord.provider_phone === 'string'
        ? providerRecord.provider_phone
        : null,
    } : null,
    error: null,
    contactError: accessHistory.error ? 'Care-team contact could not be loaded.' : null,
  };
}
