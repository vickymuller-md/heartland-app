'use server';

/**
 * Patient Profile -- Server Actions
 * Requirements: REPT-07 (state field for geographic NIW evidence)
 * Source: HEARTLAND Protocol v3.3 -- Phase 28 Reporting & NIW Evidence
 */

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

/**
 * Update the state column on the current user's profile row.
 * Empty string clears the value (sets to null).
 */
export async function updateProfileState(
  state: string
): Promise<{ success?: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: 'Not authenticated' };

  const { error } = await supabase
    .from('profiles')
    .update({ state: state || null })
    .eq('id', user.id);

  if (error) return { error: error.message };

  revalidatePath('/profile');
  return { success: true };
}
