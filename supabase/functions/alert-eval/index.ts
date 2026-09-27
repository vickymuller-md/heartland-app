/**
 * HEARTLAND Alert Evaluation Edge Function
 *
 * Legacy vitals-webhook entry point; hosted webhook activation is verified separately.
 * Both LEGACY_ALERT_EVAL_ENABLED and LEGACY_ALERT_TRANSPORT_ENABLED default OFF.
 * Explicit compatibility rehearsal only; never an automatic rollback/fallback sender.
 * Evaluates vitals against HEARTLAND Protocol Module 5 Section 5.2
 * red flag thresholds, writes alerts, and sends push/email notifications
 * for critical-severity alerts.
 *
 * Thresholds (duplicated from lib/dashboard/constants.ts for Deno runtime):
 *   - Weight gain >= 3 lbs in 2 days -> weight_gain_3lb_2d
 *   - Weight gain >= 5 lbs in 7 days -> weight_gain_5lb_7d
 *   - SBP < 90 mmHg -> sbp_low
 *   - SpO2 < 92% at rest -> spo2_low
 *   - Symptom red_flag = true -> symptom_red_flag
 *   - Dyspnea severity = 3 -> dyspnea_severe
 *
 * Requirements: DASH-05, DASH-06, DASH-07
 */

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
// Request construction only: our transport owns fetch, its deadline and response handling.
// @deno-types="npm:@types/web-push@3.6.4"
import webpush from 'npm:web-push@3.6.7'
import {
  sendEmailAlert, sendWebPush, shouldUseEmailFallback,
  type TransportDependencies, type TransportResult,
} from '../_shared/notification-transport.ts'

// ---------- Types ----------

interface WebhookPayload {
  type: 'INSERT'
  table: string
  schema: string
  record: {
    id: string
    patient_id: string
    recorded_at: string
    weight_lbs: number | null
    sbp: number | null
    dbp: number | null
    heart_rate: number | null
    spo2: number | null
  }
}

type AlertFlag =
  | 'weight_gain_3lb_2d'
  | 'weight_gain_5lb_7d'
  | 'sbp_low'
  | 'spo2_low'
  | 'symptom_red_flag'
  | 'dyspnea_severe'

type AlertSeverity = 'critical' | 'warning'

// ---------- Constants (HEARTLAND Protocol v3.3 Module 5 Section 5.2) ----------

const CRITICAL_THRESHOLDS = {
  WEIGHT_GAIN_2D_LBS: 3,
  WEIGHT_GAIN_7D_LBS: 5,
  SBP_LOW: 90,
  SPO2_LOW: 92,
} as const

const CRITICAL_FLAGS: AlertFlag[] = [
  'sbp_low',
  'spo2_low',
  'weight_gain_3lb_2d',
  'symptom_red_flag',
]

const MS_PER_DAY = 86_400_000

// ---------- Main Handler ----------

Deno.serve(async (req) => {
  try {
    // Fail closed before parsing a historical payload or creating any database client.
    if (Deno.env.get('LEGACY_ALERT_EVAL_ENABLED') !== 'true') {
      return new Response(JSON.stringify({ error: 'Legacy alert evaluation is disabled', code: 'legacy_evaluation_disabled' }), {
        status: 503, headers: { 'Content-Type': 'application/json' },
      })
    }
    const payload: WebhookPayload = await req.json()
    const vitals = payload.record

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // ---------- Evaluate flags ----------

    const flags: AlertFlag[] = []

    // 1. SBP < 90 mmHg
    if (vitals.sbp !== null && vitals.sbp < CRITICAL_THRESHOLDS.SBP_LOW) {
      flags.push('sbp_low')
    }

    // 2. SpO2 < 92%
    if (vitals.spo2 !== null && vitals.spo2 < CRITICAL_THRESHOLDS.SPO2_LOW) {
      flags.push('spo2_low')
    }

    // 3. Weight checks (skip if current weight is null)
    if (vitals.weight_lbs !== null) {
      const currentRecordedAt = new Date(vitals.recorded_at).getTime()

      // 3a. Weight gain >= 3 lbs in 2 days
      const twoDayCutoff = new Date(currentRecordedAt - 2 * MS_PER_DAY).toISOString()
      const { data: recentVitals2d } = await supabase
        .from('vitals')
        .select('weight_lbs, recorded_at')
        .eq('patient_id', vitals.patient_id)
        .gte('recorded_at', twoDayCutoff)
        .neq('id', vitals.id)
        .not('weight_lbs', 'is', null)
        .order('recorded_at', { ascending: true })
        .limit(20)

      if (recentVitals2d && recentVitals2d.length > 0) {
        const minWeight2d = Math.min(
          ...recentVitals2d.map((v: { weight_lbs: number }) => v.weight_lbs)
        )
        if (vitals.weight_lbs - minWeight2d >= CRITICAL_THRESHOLDS.WEIGHT_GAIN_2D_LBS) {
          flags.push('weight_gain_3lb_2d')
        }
      }

      // 3b. Weight gain >= 5 lbs in 7 days
      const sevenDayCutoff = new Date(currentRecordedAt - 7 * MS_PER_DAY).toISOString()
      const { data: recentVitals7d } = await supabase
        .from('vitals')
        .select('weight_lbs, recorded_at')
        .eq('patient_id', vitals.patient_id)
        .gte('recorded_at', sevenDayCutoff)
        .neq('id', vitals.id)
        .not('weight_lbs', 'is', null)
        .order('recorded_at', { ascending: true })
        .limit(20)

      if (recentVitals7d && recentVitals7d.length > 0) {
        const minWeight7d = Math.min(
          ...recentVitals7d.map((v: { weight_lbs: number }) => v.weight_lbs)
        )
        if (vitals.weight_lbs - minWeight7d >= CRITICAL_THRESHOLDS.WEIGHT_GAIN_7D_LBS) {
          flags.push('weight_gain_5lb_7d')
        }
      }
    }

    // 4. Symptom-based flags (latest symptom record)
    const { data: recentSymptoms } = await supabase
      .from('symptoms')
      .select('red_flag, dyspnea')
      .eq('patient_id', vitals.patient_id)
      .order('recorded_at', { ascending: false })
      .limit(1)

    if (recentSymptoms?.[0]?.red_flag === true) {
      flags.push('symptom_red_flag')
    }
    if (recentSymptoms?.[0]?.dyspnea === 3) {
      flags.push('dyspnea_severe')
    }

    // 5. No flags triggered -- exit early
    if (flags.length === 0) {
      return new Response(JSON.stringify({ alert: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const normalizedFlags = [...new Set(flags)]

    // ---------- Determine severity ----------
    const severity: AlertSeverity = normalizedFlags.some((f) =>
      (CRITICAL_FLAGS as string[]).includes(f)
    )
      ? 'critical'
      : 'warning'

    // ---------- Coalesce persistent signal ----------
    const { data: coalesced, error } = await supabase
      .rpc('coalesce_patient_alert', {
        p_patient_id: vitals.patient_id,
        p_vitals_id: vitals.id,
        p_flags: normalizedFlags,
        p_severity: severity,
      })
    const alert = coalesced?.[0]

    if (error) {
      console.error('alert-eval', 'alert_persistence_failed')
      return new Response(JSON.stringify({ error: 'Alert could not be recorded' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // ---------- Send notifications for critical severity only ----------
    const notifications = severity === 'critical' && alert?.created
      ? await sendProviderNotifications(supabase, vitals.patient_id)
      : undefined

    return new Response(
      JSON.stringify({
        alert: true,
        id: alert?.alert_id,
        created: alert?.created ?? false,
        flags: normalizedFlags,
        severity,
        // Diagnostic counts only, not a durable delivery receipt or a reading/care claim.
        notifications,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch {
    console.error('alert-eval', 'evaluation_failed')
    return new Response(
      JSON.stringify({ error: 'Alert evaluation failed' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})

// ---------- Notification Helpers ----------

type NotificationSummary = Record<TransportResult['state'], number>

async function sendProviderNotifications(
  supabase: SupabaseClient,
  patientId: string,
): Promise<NotificationSummary> {
  const summary: NotificationSummary = { accepted: 0, rejected: 0, unknown: 0, not_attempted: 0 }
  const report = (result: TransportResult | {
    channel: 'routing'; state: 'not_attempted'; code: string
  }) => {
    summary[result.state]++
    // Never log provider/patient ids, addresses, endpoints, credentials or exception bodies.
    if (result.state === 'accepted') console.info('notification_delivery', result)
    else console.warn('notification_delivery', result)
  }
  // Evaluation-only compatibility mode must not even look up recipients/destinations.
  // This local guard does not establish hosted cutover or cross-runtime exclusion.
  if (Deno.env.get('LEGACY_ALERT_TRANSPORT_ENABLED') !== 'true') {
    report({ channel: 'routing', state: 'not_attempted', code: 'legacy_transport_disabled' })
    return summary
  }
  const config = {
    vapidPublicKey: Deno.env.get('VAPID_PUBLIC_KEY'),
    vapidPrivateKey: Deno.env.get('VAPID_PRIVATE_KEY'),
    resendApiKey: Deno.env.get('RESEND_API_KEY'),
    appUrl: Deno.env.get('APP_URL'),
  }
  const deps: TransportDependencies = {
    fetch,
    buildPushRequest: (subscription, payload, options) => {
      const request = webpush.generateRequestDetails(subscription, payload, options)
      return {
        endpoint: request.endpoint,
        headers: request.headers,
        body: new Uint8Array(request.body),
      }
    },
  }

  try {
    // Preserve the existing active-link recipient policy; accountability routing is a later contract.
    const { data: links, error: linksError } = await supabase
      .from('provider_patient_links')
      .select('provider_id')
      .eq('patient_id', patientId)
      .eq('status', 'active')

    if (linksError) {
      report({ channel: 'routing', state: 'not_attempted', code: 'provider_lookup_failed' })
      return summary
    }
    if (!links?.length) {
      report({ channel: 'routing', state: 'not_attempted', code: 'no_linked_provider' })
      return summary
    }

    for (const link of links) {
      // A lookup failure is not an empty subscription list and cannot authorize fallback.
      const { data: subs, error: subsError } = await supabase
        .from('push_subscriptions')
        .select('endpoint, keys')
        .eq('user_id', link.provider_id)
      if (subsError) {
        report({ channel: 'routing', state: 'not_attempted', code: 'subscription_lookup_failed' })
        continue
      }

      const results: TransportResult[] = []
      for (const sub of subs ?? []) {
        const result = await sendWebPush(sub, config, deps)
        results.push(result)
        report(result)
      }

      // A partial acceptance or uncertain POST must not silently trigger a second channel.
      if (!shouldUseEmailFallback(results)) continue
      const { data: provider, error: providerError } = await supabase
        .from('profiles')
        .select('email')
        .eq('id', link.provider_id)
        .single()
      if (providerError) {
        report({ channel: 'routing', state: 'not_attempted', code: 'email_lookup_failed' })
        continue
      }
      report(await sendEmailAlert(provider?.email, config, deps))
    }
  } catch {
    // Preserve already recorded successes. An unexpected lookup failure must not break persistence.
    report({ channel: 'routing', state: 'not_attempted', code: 'routing_failed' })
  }
  return summary
}
