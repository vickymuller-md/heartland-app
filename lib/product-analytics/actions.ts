'use server';

import { authorize } from '@/lib/auth/authorization';
import { z } from 'zod';

const eventSchema = z.object({
  eventName: z.enum([
    'workspace_view',
    'daily_loop_view',
    'work_item_reviewed',
    'work_item_actioned',
    'work_item_awaiting',
    'work_item_closed',
    'patient_brief_view',
    'patient_today_view',
    'access_review',
  ]),
  area: z.enum([
    'provider_home',
    'patient_workspace',
    'patient_today',
    'patient_plan',
    'privacy',
    'inbox',
    'reports',
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

  await auth.supabase.from('product_events').insert({
    actor_id: auth.user.id,
    actor_role: auth.role,
    event_name: parsed.data.eventName,
    area: parsed.data.area,
    device_class: parsed.data.deviceClass ?? null,
    duration_ms: parsed.data.durationMs ?? null,
  });
}
