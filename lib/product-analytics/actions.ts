'use server';

import { createHmac, randomUUID } from 'node:crypto';
import { headers } from 'next/headers';
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
    'ai_checkin_started',
    'ai_checkin_completed',
    'ai_checkin_fallback',
    'ai_call_sim_run',
    'ai_escalation_demonstrated',
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
  anonymousSessionId: z.uuid().optional(),
  campaignSource: z.string().regex(/^[A-Za-z0-9._~-]{1,80}$/).optional(),
  campaignMedium: z.string().regex(/^[A-Za-z0-9._~-]{1,80}$/).optional(),
  campaignName: z.string().regex(/^[A-Za-z0-9._~-]{1,80}$/).optional(),
});

export type ProductEventInput = z.infer<typeof eventSchema>;

const PUBLIC_SANDBOX_EVENTS = new Set<ProductEventInput['eventName']>([
  'sandbox_view',
  'sandbox_first_action',
  'sandbox_task_completed',
  'sandbox_returned',
  'ai_checkin_started',
  'ai_checkin_completed',
  'ai_checkin_fallback',
  'ai_call_sim_run',
  'ai_escalation_demonstrated',
]);

async function trackPublicSandboxEvent(data: ProductEventInput): Promise<void> {
  if (data.area !== 'sandbox' || !PUBLIC_SANDBOX_EVENTS.has(data.eventName)) return;

  const rateSecret = process.env.ACCESS_REQUEST_RATE_LIMIT_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!rateSecret) return;

  const requestHeaders = await headers();
  const forwarded = requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim();
  const clientAddress = requestHeaders.get('x-real-ip')?.trim() || forwarded || 'unknown';
  const dailyBucket = new Date().toISOString().slice(0, 10);
  const requesterHash = createHmac('sha256', rateSecret)
    .update(`heartland-public-sandbox:${dailyBucket}:${clientAddress}`)
    .digest('hex');
  const anonymousSessionHash = data.anonymousSessionId
    ? createHmac('sha256', rateSecret)
      .update(`heartland-public-session:v1:${data.anonymousSessionId}`)
      .digest('hex')
    : null;

  const { supabaseAdmin } = await import('@/lib/supabase/admin');
  const { error } = await supabaseAdmin.rpc('record_public_sandbox_event', {
    p_requester_hash: requesterHash,
    p_event_id: data.eventId ?? randomUUID(),
    p_event_name: data.eventName,
    p_device_class: data.deviceClass ?? null,
    p_duration_ms: data.durationMs ?? null,
    p_session_hash: anonymousSessionHash,
    p_campaign_source: data.campaignSource ?? null,
    p_campaign_medium: data.campaignMedium ?? null,
    p_campaign_name: data.campaignName ?? null,
  });
  if (error) console.error('[public-sandbox-telemetry] controlled RPC failed');
}

export async function trackProductEvent(input: ProductEventInput): Promise<void> {
  const parsed = eventSchema.safeParse(input);
  if (!parsed.success) return;

  const auth = await authorize();
  if (!auth.authorized) {
    await trackPublicSandboxEvent(parsed.data);
    return;
  }

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
