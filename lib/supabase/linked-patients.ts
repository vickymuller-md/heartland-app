import type { SupabaseClient } from '@supabase/supabase-js';
import { readRowsById } from './rows';

export async function getLinkedPatientIds(client: SupabaseClient, providerId: string): Promise<string[]> {
  const links = await readRowsById(() => client.from('provider_patient_links')
    .select('id, patient_id').eq('provider_id', providerId).eq('status', 'active'));
  const patientIds = new Set<string>();
  for (const link of links) {
    if (typeof link.patient_id !== 'string' || !link.patient_id) throw new Error('Patient panel unavailable.');
    patientIds.add(link.patient_id);
  }
  return [...patientIds].sort();
}
