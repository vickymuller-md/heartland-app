import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_TIME_ZONE, isValidTimeZone } from '@/lib/timezone';

export async function getPatientTimeZone(supabase: SupabaseClient): Promise<string> {
  const { data, error } = await supabase.rpc('get_patient_timezone');
  if (error || typeof data !== 'string' || !isValidTimeZone(data)) return DEFAULT_TIME_ZONE;
  return data;
}
