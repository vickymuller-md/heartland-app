'use server';

import { authorize } from '@/lib/auth/authorization';

/**
 * Mark that the authenticated patient has seen the onboarding overlay.
 * Uses standard createClient (anon key) -- RLS allows self-update on profiles.
 * Requirements: PTUX-01
 */
export async function markOnboardingSeen(): Promise<void> {
  const auth = await authorize('patient');
  if (!auth.authorized) return;
  await auth.supabase
    .from('profiles')
    .update({ onboarding_seen_at: new Date().toISOString() })
    .eq('id', auth.user.id);
}
