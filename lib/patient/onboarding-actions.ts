'use server';

import { createClient } from '@/lib/supabase/server';

/**
 * Mark that the authenticated patient has seen the onboarding overlay.
 * Uses standard createClient (anon key) -- RLS allows self-update on profiles.
 * Requirements: PTUX-01
 */
export async function markOnboardingSeen(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from('profiles')
    .update({ onboarding_seen_at: new Date().toISOString() })
    .eq('id', user.id);
}
