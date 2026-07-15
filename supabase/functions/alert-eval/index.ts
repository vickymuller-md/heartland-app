/**
 * HEARTLAND Alert Evaluation Edge Function
 *
 * Triggered by a DB webhook (pg_net) on vitals INSERT.
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

import { createClient } from 'npm:@supabase/supabase-js@2'
import { buildPushPayload } from 'jsr:@negrel/webpush'

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

const FLAG_LABELS: Record<AlertFlag, string> = {
  weight_gain_3lb_2d: 'Weight gain \u22653 lbs in 2 days',
  weight_gain_5lb_7d: 'Weight gain \u22655 lbs in 1 week',
  sbp_low: 'SBP < 90 mmHg',
  spo2_low: 'SpO2 < 92%',
  symptom_red_flag: 'Red flag symptom reported',
  dyspnea_severe: 'Severe dyspnea at rest',
}

const MS_PER_DAY = 86_400_000

// ---------- Main Handler ----------

Deno.serve(async (req) => {
  try {
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
      console.error('Failed to insert alert:', error.message)
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // ---------- Send notifications for critical severity only ----------
    if (severity === 'critical' && alert?.created) {
      await sendProviderNotifications(
        supabase,
        vitals.patient_id,
        normalizedFlags,
        alert.alert_id
      )
    }

    return new Response(
      JSON.stringify({
        alert: true,
        id: alert?.alert_id,
        created: alert?.created ?? false,
        flags: normalizedFlags,
        severity,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('alert-eval error:', err)
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})

// ---------- Notification Helpers ----------

async function sendProviderNotifications(
  supabase: ReturnType<typeof createClient>,
  patientId: string,
  flags: AlertFlag[],
  alertId: string
): Promise<void> {
  try {
    // Find linked providers
    const { data: links } = await supabase
      .from('provider_patient_links')
      .select('provider_id')
      .eq('patient_id', patientId)
      .eq('status', 'active')

    if (!links || links.length === 0) return

    // Get patient name
    const { data: patient } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', patientId)
      .single()

    const patientName = patient?.full_name || 'A patient'
    const flagLabels = flags.map((f) => FLAG_LABELS[f] || f).join(', ')

    for (const link of links) {
      // Try push notification first
      const { data: subs } = await supabase
        .from('push_subscriptions')
        .select('endpoint, keys')
        .eq('user_id', link.provider_id)

      if (subs && subs.length > 0) {
        // Send web push via VAPID
        await sendWebPush(subs, patientName, flagLabels, alertId)
      } else {
        // Email fallback (DASH-07)
        const { data: provider } = await supabase
          .from('profiles')
          .select('email')
          .eq('id', link.provider_id)
          .single()

        if (provider?.email) {
          await sendEmailAlert(provider.email, patientName, flagLabels, alertId)
        }
      }
    }
  } catch (err) {
    // Notification failures should not break the alert pipeline
    console.error('Notification error:', err)
  }
}

async function sendWebPush(
  subscriptions: Array<{ endpoint: string; keys: Record<string, string> }>,
  patientName: string,
  flagLabels: string,
  alertId: string
): Promise<void> {
  const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')
  const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')

  if (!vapidPublicKey || !vapidPrivateKey) {
    console.error('VAPID keys not set, skipping push notifications')
    return
  }

  const payload = JSON.stringify({
    title: 'HEARTLAND Alert',
    body: `CRITICAL: ${patientName} - ${flagLabels}`,
    data: { alertId, url: '/alerts' },
  })

  for (const sub of subscriptions) {
    try {
      const pushSub = {
        endpoint: sub.endpoint,
        keys: sub.keys as { p256dh: string; auth: string },
      }

      const message = await buildPushPayload(
        {
          endpoint: pushSub.endpoint,
          keys: pushSub.keys,
        },
        {
          vapidKeys: {
            publicKey: vapidPublicKey,
            privateKey: vapidPrivateKey,
          },
          subject: 'mailto:alerts@heartlandprotocol.org',
          ttl: 86400,
          urgency: 'high',
        },
        payload
      )

      await fetch(message.endpoint, {
        method: 'POST',
        headers: message.headers,
        body: message.body,
      })
    } catch (err) {
      console.error('Push notification failed for endpoint:', sub.endpoint, err)
    }
  }
}

async function sendEmailAlert(
  providerEmail: string,
  patientName: string,
  flagLabels: string,
  alertId: string
): Promise<void> {
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
  if (!RESEND_API_KEY) {
    console.error('RESEND_API_KEY not set, skipping email fallback')
    return
  }

  const appUrl = Deno.env.get('APP_URL') || 'https://app.heartlandprotocol.org'

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'HEARTLAND Alerts <alerts@heartlandprotocol.org>',
        to: [providerEmail],
        subject: `CRITICAL ALERT: ${patientName}`,
        html: `
          <h2>HEARTLAND Protocol - Critical Patient Alert</h2>
          <p><strong>Patient:</strong> ${patientName}</p>
          <p><strong>Alert:</strong> ${flagLabels}</p>
          <p><strong>Action Required:</strong> Review patient vitals and respond.</p>
          <p><a href="${appUrl}/alerts">View Alert in Dashboard</a></p>
          <hr>
          <p style="color: #666; font-size: 12px;">
            This is an automated alert from the HEARTLAND Protocol Clinical Decision Support Tool.
            This tool is for healthcare professionals only.
          </p>
        `,
      }),
    })
  } catch (err) {
    console.error('Email send failed:', err)
  }
}
