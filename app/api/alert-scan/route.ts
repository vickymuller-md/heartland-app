/**
 * HEARTLAND Alert Scan -- Vercel Cron Endpoint
 *
 * Runs every 6 hours (via vercel.json cron). Scans all provider-patient
 * links and evaluates 5 proactive alert types:
 *   - no_checkin (ALRT-01)
 *   - low_adherence (ALRT-02)
 *   - weight_trend_7d (ALRT-03)
 *   - critical_labs (ALRT-04): hyperkalemia, low_egfr
 *   - followup_due (ALRT-05)
 *   - followup_overdue (SAFE-05): past-due follow-ups within 7-day lookback
 *
 * Respects mute preferences (ALRT-07) and deduplicates alerts.
 * Uses admin client (service_role) to bypass RLS for cross-patient queries.
 */

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  evaluateNoCheckin,
  evaluateLowAdherence,
  evaluateWeightTrend7d,
  evaluateCriticalLabs,
  evaluateFollowupDue,
  evaluateFollowupOverdue,
  shouldDeduplicate,
  classifyProactiveSeverity,
} from '@/lib/dashboard/alert-engine';
import { PROACTIVE_DEDUP_HOURS } from '@/lib/dashboard/constants';
import { getAdherenceData } from '@/lib/medications/queries';
import type { ExistingAlertForDedup } from '@/lib/dashboard/types';
import { timingSafeEqual } from 'node:crypto';

export const dynamic = 'force-dynamic';

function validCronAuthorization(header: string | null, secret: string): boolean {
  const actual = Buffer.from(header ?? '', 'utf8');
  const expected = Buffer.from(`Bearer ${secret}`, 'utf8');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function GET(request: Request) {
  // Fail loudly if CRON_SECRET is missing in prod -- prevents silent auth-deny
  // that would suppress all alerts without any signal in logs.
  if (!process.env.CRON_SECRET) {
    console.error('[alert-scan] CRON_SECRET is not configured -- cron cannot authenticate');
    return NextResponse.json(
      { error: 'CRON_SECRET not configured' },
      { status: 503 }
    );
  }

  // Authorization gate (Vercel cron pattern)
  const authHeader = request.headers.get('authorization');
  if (!validCronAuthorization(authHeader, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  let totalPatients = 0;
  let alertsCreated = 0;

  try {
    // 1. Fetch all active provider-patient links
    const { data: links, error: linkError } = await supabaseAdmin
      .from('provider_patient_links')
      .select('provider_id, patient_id')
      .eq('status', 'active');

    if (linkError) throw linkError;
    if (!links || links.length === 0) {
      return NextResponse.json({
        scanned: 0,
        alerts_created: 0,
        timestamp: now.toISOString(),
      });
    }

    // 2. Group by provider_id
    const byProvider = new Map<string, string[]>();
    for (const link of links) {
      const arr = byProvider.get(link.provider_id) ?? [];
      arr.push(link.patient_id);
      byProvider.set(link.provider_id, arr);
    }

    // Deduplicate patient IDs for batch queries
    const allPatientIds = [...new Set(links.map((l) => l.patient_id))];
    totalPatients = allPatientIds.length;

    // 3. Batch fetch data needed across all patients
    // 3a. No-check-in: latest vitals + patient created_at
    const checkinStatusMap = new Map<string, { lastVitalsAt: string | null; createdAt: string }>();
    {
      const { data: vitals } = await supabaseAdmin
        .from('vitals')
        .select('patient_id, recorded_at')
        .in('patient_id', allPatientIds)
        .order('recorded_at', { ascending: false });

      const latestVitals = new Map<string, string>();
      for (const v of vitals ?? []) {
        if (!latestVitals.has(v.patient_id)) {
          latestVitals.set(v.patient_id, v.recorded_at);
        }
      }

      const { data: patients } = await supabaseAdmin
        .from('patients')
        .select('id, created_at')
        .in('id', allPatientIds);

      for (const p of patients ?? []) {
        checkinStatusMap.set(p.id, {
          lastVitalsAt: latestVitals.get(p.id) ?? null,
          createdAt: p.created_at,
        });
      }
    }

    // 3b. Weight trend 7d: vitals with weight in last 7 days
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
    const { data: weightVitals } = await supabaseAdmin
      .from('vitals')
      .select('patient_id, weight_lbs, recorded_at')
      .in('patient_id', allPatientIds)
      .gte('recorded_at', sevenDaysAgo)
      .not('weight_lbs', 'is', null)
      .order('recorded_at', { ascending: true });

    const weightByPatient = new Map<string, Array<{ weight_lbs: number; recorded_at: string }>>();
    for (const v of weightVitals ?? []) {
      const arr = weightByPatient.get(v.patient_id) ?? [];
      arr.push({ weight_lbs: v.weight_lbs, recorded_at: v.recorded_at });
      weightByPatient.set(v.patient_id, arr);
    }

    // 3c. Critical labs: latest lab per patient
    const { data: labs } = await supabaseAdmin
      .from('lab_results')
      .select('patient_id, potassium, egfr, collected_at')
      .in('patient_id', allPatientIds)
      .order('collected_at', { ascending: false });

    const latestLabByPatient = new Map<string, { potassium: number | null; egfr: number | null }>();
    for (const lab of labs ?? []) {
      if (!latestLabByPatient.has(lab.patient_id)) {
        latestLabByPatient.set(lab.patient_id, {
          potassium: lab.potassium,
          egfr: lab.egfr,
        });
      }
    }

    // 3d. Followup due: incomplete followups within 24h window
    const twentyFourHoursFromNow = new Date(now.getTime() + 24 * 3_600_000).toISOString();
    const { data: followups } = await supabaseAdmin
      .from('scheduled_followups')
      .select('id, provider_id, patient_id, scheduled_at, completed')
      .in('patient_id', allPatientIds)
      .eq('completed', false)
      .gte('scheduled_at', now.toISOString())
      .lte('scheduled_at', twentyFourHoursFromNow);

    const followupsByPatient = new Map<
      string,
      Array<{ provider_id: string; scheduled_at: string; completed: boolean }>
    >();
    for (const f of followups ?? []) {
      const arr = followupsByPatient.get(f.patient_id) ?? [];
      arr.push({ provider_id: f.provider_id, scheduled_at: f.scheduled_at, completed: f.completed });
      followupsByPatient.set(f.patient_id, arr);
    }

    // 3d2. Overdue followups: past-due within 7-day lookback (SAFE-05)
    const sevenDaysAgoFollowup = new Date(now.getTime() - 7 * 24 * 3_600_000).toISOString();
    const { data: overdueFollowups } = await supabaseAdmin
      .from('scheduled_followups')
      .select('id, provider_id, patient_id, scheduled_at, completed')
      .in('patient_id', allPatientIds)
      .eq('completed', false)
      .lt('scheduled_at', now.toISOString())
      .gte('scheduled_at', sevenDaysAgoFollowup);

    const overdueFollowupsByPatient = new Map<
      string,
      Array<{ provider_id: string; scheduled_at: string; completed: boolean }>
    >();
    for (const f of overdueFollowups ?? []) {
      const arr = overdueFollowupsByPatient.get(f.patient_id) ?? [];
      arr.push({ provider_id: f.provider_id, scheduled_at: f.scheduled_at, completed: f.completed });
      overdueFollowupsByPatient.set(f.patient_id, arr);
    }

    // 3e. Existing open/acknowledged alerts for dedup
    const { data: existingAlerts } = await supabaseAdmin
      .from('alerts')
      .select('id, patient_id, flags, status, created_at')
      .in('patient_id', allPatientIds)
      .in('status', ['open', 'acknowledged']);

    const alertsByPatient = new Map<string, ExistingAlertForDedup[]>();
    for (const a of existingAlerts ?? []) {
      const arr = alertsByPatient.get(a.patient_id) ?? [];
      arr.push({ flags: a.flags, status: a.status, created_at: a.created_at });
      alertsByPatient.set(a.patient_id, arr);
    }

    // 4. Process each provider-patient pair
    for (const [providerId, patientIds] of byProvider) {
      for (const patientId of patientIds) {
        // 4a. Fetch muted alert types
        const { data: prefs } = await supabaseAdmin
          .from('alert_preferences')
          .select('alert_type, muted')
          .eq('provider_id', providerId)
          .eq('patient_id', patientId);

        const mutedTypes = new Set(
          (prefs ?? []).filter((p) => p.muted).map((p) => p.alert_type)
        );

        const patientExisting = alertsByPatient.get(patientId) ?? [];

        // Helper to check and insert an alert
        const tryInsertAlert = async (flag: string) => {
          if (mutedTypes.has(flag)) return;

          const dedupHours = PROACTIVE_DEDUP_HOURS[flag] ?? 24;
          if (shouldDeduplicate(flag, patientExisting, dedupHours, now)) return;

          const severity = classifyProactiveSeverity(flag);
          const { error: insertError } = await supabaseAdmin
            .from('alerts')
            .insert({
              patient_id: patientId,
              flags: [flag],
              severity,
              status: 'open',
              vitals_id: null,
            });

          if (!insertError) {
            alertsCreated++;
          }
        };

        // 4b. no_checkin (ALRT-01)
        if (!mutedTypes.has('no_checkin')) {
          const checkinStatus = checkinStatusMap.get(patientId);
          if (checkinStatus) {
            const triggered = evaluateNoCheckin(
              checkinStatus.lastVitalsAt,
              checkinStatus.createdAt,
              undefined,
              now
            );
            if (triggered) {
              await tryInsertAlert('no_checkin');
            }
          }
        }

        // 4c. low_adherence (ALRT-02)
        if (!mutedTypes.has('low_adherence')) {
          try {
            const adherence = await getAdherenceData(supabaseAdmin, patientId, 7);
            const triggered = evaluateLowAdherence(adherence);
            if (triggered) {
              await tryInsertAlert('low_adherence');
            }
          } catch {
            // Medication data may not exist for this patient
          }
        }

        // 4d. weight_trend_7d (ALRT-03)
        // Suppressed if patient already has an open weight_gain_3lb_2d or weight_gain_5lb_7d alert
        if (!mutedTypes.has('weight_trend_7d')) {
          const hasAcuteWeight = patientExisting.some(
            (a) =>
              (a.status === 'open' || a.status === 'acknowledged') &&
              (a.flags.includes('weight_gain_3lb_2d') || a.flags.includes('weight_gain_5lb_7d'))
          );

          if (!hasAcuteWeight) {
            const weightWindow = weightByPatient.get(patientId) ?? [];
            const triggered = evaluateWeightTrend7d(weightWindow);
            if (triggered) {
              await tryInsertAlert('weight_trend_7d');
            }
          }
        }

        // 4e. critical_labs (ALRT-04): hyperkalemia + low_egfr
        const latestLab = latestLabByPatient.get(patientId);
        if (latestLab) {
          const labFlags = evaluateCriticalLabs(latestLab);
          for (const flag of labFlags) {
            await tryInsertAlert(flag);
          }
        }

        // 4f. followup_due (ALRT-05)
        if (!mutedTypes.has('followup_due')) {
          const patientFollowups = followupsByPatient.get(patientId) ?? [];
          for (const f of patientFollowups) {
            const triggered = evaluateFollowupDue(f.scheduled_at, f.completed, undefined, now);
            if (triggered) {
              await tryInsertAlert('followup_due');
              break; // One followup_due alert per patient per scan
            }
          }
        }

        // 4g. followup_overdue (SAFE-05)
        if (!mutedTypes.has('followup_overdue')) {
          const patientOverdue = overdueFollowupsByPatient.get(patientId) ?? [];
          for (const f of patientOverdue) {
            const result = evaluateFollowupOverdue(f.scheduled_at, f.completed, now);
            if (result) {
              // Use evaluated severity (warning for 24-72h, critical for >72h)
              // instead of the default from PROACTIVE_FLAG_SEVERITY
              if (mutedTypes.has('followup_overdue')) break;

              const dedupHours = PROACTIVE_DEDUP_HOURS['followup_overdue'] ?? 24;
              if (!shouldDeduplicate('followup_overdue', patientExisting, dedupHours, now)) {
                const { error: insertError } = await supabaseAdmin
                  .from('alerts')
                  .insert({
                    patient_id: patientId,
                    flags: ['followup_overdue'],
                    severity: result.severity,
                    status: 'open',
                    vitals_id: null,
                  });

                if (!insertError) {
                  alertsCreated++;
                }
              }
              break; // One followup_overdue alert per patient per scan
            }
          }
        }
      }
    }

    return NextResponse.json({
      scanned: totalPatients,
      alerts_created: alertsCreated,
      timestamp: now.toISOString(),
    });
  } catch {
    console.error('[alert-scan] Scan failed');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
