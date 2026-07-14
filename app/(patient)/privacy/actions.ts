'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { authorize } from '@/lib/auth/authorization';
import { trackProductEvent } from '@/lib/product-analytics/actions';

export async function revokeProviderAccess(linkId: string): Promise<{ success: boolean; error?: string }> {
  if (!z.uuid().safeParse(linkId).success) return { success: false, error: 'Invalid access record' };
  const auth = await authorize('patient');
  if (!auth.authorized) return { success: false, error: auth.error };

  const { data, error } = await auth.supabase
    .from('provider_patient_links')
    .update({ status: 'revoked' })
    .eq('id', linkId)
    .eq('patient_id', auth.user.id)
    .eq('status', 'active')
    .select('id');

  if (error || !data?.length) return { success: false, error: 'Unable to revoke access' };
  await trackProductEvent({ eventName: 'access_review', area: 'privacy' });
  revalidatePath('/privacy');
  return { success: true };
}

export async function signOutAllDevices(): Promise<void> {
  const auth = await authorize('patient');
  if (!auth.authorized) redirect('/login');
  await auth.supabase.auth.signOut({ scope: 'global' });
  redirect('/login');
}
