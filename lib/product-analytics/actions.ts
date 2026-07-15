'use server';

import { authorize } from '@/lib/auth/authorization';
import { z } from 'zod';

const eventSchema = z.object({
  eventId: z.uuid().optional(),
  eventName: z.enum([
    'workspace_view',
    'daily_loop_view',
    'work_item_reviewed',
    'work_item_actioned',
    'work_item_awaiting',
    'work_item_closed',
    'work_item_reassigned',
    'saved_view_created',
    'patient_brief_view',
    'patient_today_view',
    'access_review',
    'sandbox_view',
    'sandbox_first_action',
    'sandbox_task_completed',
    'sandbox_returned',
    'queue_page_view',
    'fhir_export_created',
    'offline_draft_saved',
  ]),
  area: z.enum([
    'provider_home',
    'patient_workspace',
    'patient_today',
    'patient_plan',
    'privacy',
    'inbox',
    'reports',
    'team',
    'sandbox',
    'interoperability',
  ]),
  deviceClass: z.enum(['mobile', 'tablet', 'desktop']).optional(),
  durationMs: z.number().int().min(0).max(3_600_000).optional(),
});

export type ProductEventInput = z.infer<typeof eventSchema>;

export async function trackProductEvent(input: ProductEventInput): Promise<void> {
  const parsed = eventSchema.safeParse(input);
  if (!parsed.success) return;

  const auth = await authorize();
  if (!auth.authorized) return;

  if (parsed.data.eventId && parsed.data.durationMs !== undefined) {
    const { data } = await auth.supabase
      .from('product_events')
      .update({ duration_ms: parsed.data.durationMs })
      .eq('id', parsed.data.eventId)
      .eq('actor_id', auth.user.id)
      .select('id');
    if (data?.length) return;
  }

  await auth.supabase.from('product_events').insert({
    id: parsed.data.eventId,
    actor_id: auth.user.id,
    actor_role: auth.role,
    event_name: parsed.data.eventName,
    area: parsed.data.area,
    device_class: parsed.data.deviceClass ?? null,
    duration_ms: parsed.data.durationMs ?? null,
  });
}
