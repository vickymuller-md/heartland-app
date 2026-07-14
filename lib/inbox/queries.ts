import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { extractPatientFullName } from '@/lib/supabase/types';
import type { MessageDeliveryReceipt } from './types';

type DeliveryJoin = {
  state?: MessageDeliveryReceipt['delivery_state'];
  available_at?: string | null;
  read_at?: string | null;
};

function firstDelivery(value: unknown): DeliveryJoin | null {
  if (Array.isArray(value)) return (value[0] as DeliveryJoin | undefined) ?? null;
  if (value && typeof value === 'object') return value as DeliveryJoin;
  return null;
}

export async function getRecentMessageDeliveries(
  supabase: SupabaseClient,
  providerId: string,
): Promise<{ messages: MessageDeliveryReceipt[]; error: string | null }> {
  const { data, error } = await supabase
    .from('provider_messages')
    .select(
      'id, patient_id, subject, created_at, read_at, patients!provider_messages_patient_id_fkey(profiles(full_name)), delivery:notification_deliveries!notification_deliveries_message_id_fkey(state, available_at, read_at)',
    )
    .eq('provider_id', providerId)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) return { messages: [], error: 'Message delivery evidence could not be loaded.' };

  return {
    messages: (data ?? []).map((row) => {
      const delivery = firstDelivery(row.delivery);
      return {
        id: row.id,
        patient_id: row.patient_id,
        patient_name: extractPatientFullName(row.patients) ?? 'Patient',
        subject: row.subject,
        created_at: row.created_at,
        read_at: row.read_at ?? delivery?.read_at ?? null,
        delivery_state: delivery?.state ?? 'unknown',
        available_at: delivery?.available_at ?? null,
      } as MessageDeliveryReceipt;
    }),
    error: null,
  };
}
