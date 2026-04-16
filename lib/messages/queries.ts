/**
 * HEARTLAND Provider Messages -- Query Functions
 *
 * Server-side query functions for provider messages.
 * Both accept (supabase, patientId) -- same signature as getProviderNotes.
 *
 * Requirements: MSG-04, MSG-05
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProviderMessage } from './types';

/**
 * Get all messages for a patient (provider view -- Notes tab).
 * Joins profiles to get provider_name.
 * Ordered by created_at DESC (newest first).
 */
export async function getPatientMessages(
  supabase: SupabaseClient,
  patientId: string
): Promise<ProviderMessage[]> {
  const { data, error } = await supabase
    .from('provider_messages')
    .select(
      'id, patient_id, provider_id, template_type, subject, body, read_at, created_at, profiles!provider_id(full_name)'
    )
    .eq('patient_id', patientId)
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data ?? []).map((row) => {
    const profile = row.profiles as unknown as { full_name: string } | null;
    return {
      id: row.id,
      patient_id: row.patient_id,
      provider_id: row.provider_id,
      provider_name: profile?.full_name ?? 'Unknown',
      template_type: row.template_type,
      subject: row.subject,
      body: row.body,
      read_at: row.read_at,
      created_at: row.created_at,
    } as ProviderMessage;
  });
}

/**
 * Get unread messages for a patient (patient Today view).
 * Filters read_at IS NULL, joins profiles for provider_name.
 * Ordered by created_at DESC (newest first).
 */
export async function getUnreadMessages(
  supabase: SupabaseClient,
  patientId: string
): Promise<ProviderMessage[]> {
  const { data, error } = await supabase
    .from('provider_messages')
    .select(
      'id, patient_id, provider_id, template_type, subject, body, read_at, created_at, profiles!provider_id(full_name)'
    )
    .eq('patient_id', patientId)
    .is('read_at', null)
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data ?? []).map((row) => {
    const profile = row.profiles as unknown as { full_name: string } | null;
    return {
      id: row.id,
      patient_id: row.patient_id,
      provider_id: row.provider_id,
      provider_name: profile?.full_name ?? 'Unknown',
      template_type: row.template_type,
      subject: row.subject,
      body: row.body,
      read_at: row.read_at,
      created_at: row.created_at,
    } as ProviderMessage;
  });
}
