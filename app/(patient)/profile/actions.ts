'use server';

/**
 * Patient Profile -- Server Actions
 * Requirements: REPT-07 (state field for geographic NIW evidence)
 * Source: HEARTLAND Protocol v3.3 -- Phase 28 Reporting & NIW Evidence
 */

import { authorize } from '@/lib/auth/authorization';
import { revalidatePath } from 'next/cache';

/**
 * Update the state column on the current user's profile row.
 * Empty string clears the value (sets to null).
 */
export async function updateProfileState(
  state: string
): Promise<{ success?: boolean; error?: string }> {
  const normalizedState = state.trim().toUpperCase();
  if (normalizedState && !/^[A-Z]{2}$/.test(normalizedState)) {
    return { error: 'Invalid state' };
  }
  const auth = await authorize('patient');
  if (!auth.authorized) return { error: auth.error };

  const { data, error } = await auth.supabase
    .from('profiles')
    .update({ state: normalizedState || null })
    .eq('id', auth.user.id)
    .select('id');

  if (error || !data?.length) return { error: 'Unable to update profile' };

  revalidatePath('/profile');
  return { success: true };
}
