'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { authorize } from '@/lib/auth/authorization';
import { trackProductEvent } from '@/lib/product-analytics/actions';

const reviewSchema = z.object({
  organizationId: z.uuid(),
  findings: z.string().trim().min(3).max(1000),
});

export async function completeAccessReview(
  _state: { success?: boolean; error?: string } | null,
  formData: FormData,
): Promise<{ success?: boolean; error?: string }> {
  const parsed = reviewSchema.safeParse({
    organizationId: formData.get('organizationId'),
    findings: formData.get('findings'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid review' };

  const auth = await authorize('provider');
  if (!auth.authorized) return { error: auth.error };
  const { error } = await auth.supabase.rpc('complete_access_review', {
    p_organization_id: parsed.data.organizationId,
    p_findings: parsed.data.findings,
  });
  if (error) return { error: 'Access review could not be recorded.' };
  await trackProductEvent({ eventName: 'access_review', area: 'team' });
  revalidatePath('/team');
  return { success: true };
}

const settingsSchema = z.object({
  organizationId: z.uuid(),
  name: z.string().trim().min(3).max(160),
  timezone: z.string().trim().min(3).max(80),
  // organizations.alert_sla_minutes has no consumer that enforces it, so the
  // settings form no longer submits it. The column and this field stay so a
  // form that still sends the value keeps writing it.
  alertSlaMinutes: z.coerce.number().int().min(5).max(1440).optional(),
  downtimeContact: z.string().trim().max(160).optional(),
});

export async function updateOrganizationSettings(
  _state: { success?: boolean; error?: string } | null,
  formData: FormData,
): Promise<{ success?: boolean; error?: string }> {
  const parsed = settingsSchema.safeParse({
    organizationId: formData.get('organizationId'),
    name: formData.get('name'),
    timezone: formData.get('timezone'),
    alertSlaMinutes: formData.get('alertSlaMinutes') ?? undefined,
    downtimeContact: formData.get('downtimeContact'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid settings' };

  const auth = await authorize('provider');
  if (!auth.authorized) return { error: auth.error };
  const { data, error } = await auth.supabase
    .from('organizations')
    .update({
      name: parsed.data.name,
      timezone: parsed.data.timezone,
      ...(parsed.data.alertSlaMinutes === undefined
        ? {}
        : { alert_sla_minutes: parsed.data.alertSlaMinutes }),
      downtime_contact: parsed.data.downtimeContact || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', parsed.data.organizationId)
    .select('id');
  if (error || !data?.length) return { error: 'Organization settings could not be updated.' };
  revalidatePath('/team');
  return { success: true };
}
