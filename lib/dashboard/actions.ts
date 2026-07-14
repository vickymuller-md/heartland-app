'use server';

/**
 * HEARTLAND Provider Dashboard -- Server Actions
 *
 * Server actions for alert management and provider notes.
 * All actions verify authentication via getUser() before proceeding.
 *
 * Requirements: DASH-05 (alert acknowledge/resolve), DASH-09 (provider notes)
 */

import { authorize, authorizeProviderForPatient } from '@/lib/auth/authorization';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { shouldDeduplicate } from '@/lib/dashboard/alert-engine';
import {
  FLAG_LABELS,
  PROACTIVE_DEDUP_HOURS,
  PROTECTED_ALERT_TYPES,
} from '@/lib/dashboard/constants';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

// ---------- Zod Schemas ----------

const providerNoteSchema = z.object({
  patientId: z.uuid('Invalid patient ID'),
  content: z
    .string()
    .min(1, 'Note content is required')
    .max(5000, 'Note cannot exceed 5000 characters'),
});

const labSchema = z.object({
  patientId: z.uuid('Invalid patient ID'),
  potassium: z.coerce.number().min(1).max(10).optional(),
  egfr: z.coerce.number().min(1).max(200).optional(),
  creatinine: z.coerce.number().min(0.1).max(20).optional(),
  sodium: z.coerce.number().min(100).max(170).optional(),
  notes: z.string().max(500).optional(),
});

// ---------- Lab Result Action (SAFE-04) ----------

export interface LabActionState {
  success?: boolean;
  error?: string;
}

/**
 * Save a lab result and trigger immediate alerts for critical values.
 * SAFE-04: Real-time lab alert insertion (eliminates 6-hour cron delay).
 *
 * Immediate alert thresholds (stricter than cron):
 *   - K+ > 5.5 -> hyperkalemia (same as cron)
 *   - eGFR < 15 -> low_egfr (cron uses < 30; this is the emergency threshold)
 *
 * Compatible with useActionState (prevState, formData) signature.
 */
export async function saveLabResult(
  _prevState: unknown,
  formData: FormData
): Promise<LabActionState> {
  // 1. Extract and validate input
  const raw: Record<string, unknown> = {
    patientId: formData.get('patientId') as string,
  };

  // Only include numeric fields that have values (empty strings -> skip)
  const potassiumStr = formData.get('potassium') as string;
  if (potassiumStr) raw.potassium = potassiumStr;
  const egfrStr = formData.get('egfr') as string;
  if (egfrStr) raw.egfr = egfrStr;
  const creatinineStr = formData.get('creatinine') as string;
  if (creatinineStr) raw.creatinine = creatinineStr;
  const sodiumStr = formData.get('sodium') as string;
  if (sodiumStr) raw.sodium = sodiumStr;
  const notesStr = formData.get('notes') as string;
  if (notesStr) raw.notes = notesStr;

  const parsed = labSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join(', ') };
  }

  const { patientId, potassium, egfr, creatinine, sodium, notes } = parsed.data;
  const auth = await authorizeProviderForPatient(patientId);
  if (!auth.authorized) return { error: auth.error };

  const { error: labError } = await auth.supabase.from('lab_results').insert({
    patient_id: patientId,
    potassium: potassium ?? null,
    egfr: egfr ?? null,
    creatinine: creatinine ?? null,
    sodium: sodium ?? null,
    notes: notes ?? null,
    collected_at: new Date().toISOString(),
  });

  if (labError) return { error: 'Unable to save lab result' };

  // 4. Immediate critical lab check (SAFE-04 specific thresholds)
  const immediateFlags: string[] = [];
  if (potassium !== undefined && potassium > 5.5) {
    immediateFlags.push('hyperkalemia');
  }
  if (egfr !== undefined && egfr < 15) {
    immediateFlags.push('low_egfr');
  }

  // 5. For each flag: dedup check then insert alert via admin client
  if (immediateFlags.length > 0) {
    const { data: existingAlerts } = await supabaseAdmin
      .from('alerts')
      .select('flags, status, created_at')
      .eq('patient_id', patientId)
      .in('status', ['open', 'acknowledged']);

    const now = new Date();

    for (const flag of immediateFlags) {
      const dedupHours = PROACTIVE_DEDUP_HOURS[flag] ?? 24;
      if (!shouldDeduplicate(flag, existingAlerts ?? [], dedupHours, now)) {
        await supabaseAdmin.from('alerts').insert({
          patient_id: patientId,
          flags: [flag],
          severity: 'critical',
          status: 'open',
          vitals_id: null,
        });
      }
    }
  }

  // 6. Revalidate patient page
  revalidatePath(`/provider/patients/${patientId}`);
  return { success: true };
}

// ---------- Alert Actions ----------

/**
 * Acknowledge an alert (mark as seen by provider).
 * DASH-05: Alert status transitions
 */
export async function acknowledgeAlert(
  alertId: string
): Promise<{ success: boolean; error?: string }> {
  if (!z.string().uuid().safeParse(alertId).success) {
    return { success: false, error: 'Invalid alert ID' };
  }
  const auth = await authorize('provider');
  if (!auth.authorized) return { success: false, error: auth.error };

  const { data, error } = await auth.supabase
    .from('alerts')
    .update({
      status: 'acknowledged',
    })
    .eq('id', alertId)
    .eq('status', 'open')
    .select('id');

  if (error) return { success: false, error: 'Unable to acknowledge alert' };
  if (!data?.length) return { success: false, error: 'Alert not found' };

  revalidatePath('/dashboard');
  revalidatePath('/alerts');
  return { success: true };
}

/**
 * Resolve an alert (mark as handled by provider).
 * DASH-05: Alert status transitions
 */
export async function resolveAlert(
  alertId: string
): Promise<{ success: boolean; error?: string }> {
  if (!z.string().uuid().safeParse(alertId).success) {
    return { success: false, error: 'Invalid alert ID' };
  }
  const auth = await authorize('provider');
  if (!auth.authorized) return { success: false, error: auth.error };

  const { data, error } = await auth.supabase
    .from('alerts')
    .update({
      status: 'resolved',
    })
    .eq('id', alertId)
    .in('status', ['open', 'acknowledged'])
    .select('id');

  if (error) return { success: false, error: 'Unable to resolve alert' };
  if (!data?.length) return { success: false, error: 'Alert not found' };

  revalidatePath('/dashboard');
  revalidatePath('/alerts');
  return { success: true };
}

// ---------- Alert Preferences (ALRT-07) ----------

/**
 * Mute a specific alert type for a patient (ALRT-07).
 * Provider will not receive new alerts of this type for this patient.
 * Uses UPSERT to handle re-muting idempotently.
 */
export async function muteAlertType(
  patientId: string,
  alertType: string
): Promise<{ success: boolean; error?: string }> {
  if (!Object.hasOwn(FLAG_LABELS, alertType)) {
    return { success: false, error: 'Invalid alert type' };
  }
  const auth = await authorizeProviderForPatient(patientId);
  if (!auth.authorized) return { success: false, error: auth.error };

  // SAFE-06: Server-side guard prevents muting patient-safety-critical alert types
  if (PROTECTED_ALERT_TYPES.includes(alertType)) {
    return { success: false, error: 'This alert type cannot be muted for patient safety.' };
  }

  const { error } = await auth.supabase
    .from('alert_preferences')
    .upsert(
      {
        provider_id: auth.user.id,
        patient_id: patientId,
        alert_type: alertType,
        muted: true,
      },
      { onConflict: 'provider_id,patient_id,alert_type' }
    );

  if (error) return { success: false, error: 'Unable to update alert preference' };

  revalidatePath('/alerts');
  revalidatePath(`/patients/${patientId}`);
  return { success: true };
}

/**
 * Unmute a previously muted alert type for a patient (ALRT-07).
 */
export async function unmuteAlertType(
  patientId: string,
  alertType: string
): Promise<{ success: boolean; error?: string }> {
  if (!Object.hasOwn(FLAG_LABELS, alertType)) {
    return { success: false, error: 'Invalid alert type' };
  }
  const auth = await authorizeProviderForPatient(patientId);
  if (!auth.authorized) return { success: false, error: auth.error };

  const { error } = await auth.supabase
    .from('alert_preferences')
    .upsert(
      {
        provider_id: auth.user.id,
        patient_id: patientId,
        alert_type: alertType,
        muted: false,
      },
      { onConflict: 'provider_id,patient_id,alert_type' }
    );

  if (error) return { success: false, error: 'Unable to update alert preference' };

  revalidatePath('/alerts');
  revalidatePath(`/patients/${patientId}`);
  return { success: true };
}

// ---------- Provider Notes ----------

export interface NoteActionState {
  success?: boolean;
  errors?: Record<string, string[]>;
  error?: string;
}

/**
 * Add a provider note to a patient record.
 * DASH-09: Provider notes
 *
 * Uses Zod validation (patientId as UUID, content 1-5000 chars).
 * Compatible with useActionState (prevState, formData) signature.
 */
export async function addProviderNote(
  _prevState: unknown,
  formData: FormData
): Promise<NoteActionState> {
  // 1. Validate input
  const raw = {
    patientId: formData.get('patientId') as string,
    content: formData.get('content') as string,
  };

  const parsed = providerNoteSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.');
      fieldErrors[key] = fieldErrors[key] ?? [];
      fieldErrors[key].push(issue.message);
    }
    return { errors: fieldErrors };
  }

  const auth = await authorizeProviderForPatient(parsed.data.patientId);
  if (!auth.authorized) return { error: auth.error };

  const { error } = await auth.supabase.from('provider_notes').insert({
    patient_id: parsed.data.patientId,
    provider_id: auth.user.id,
    content: parsed.data.content,
  });

  if (error) return { error: 'Unable to save provider note' };

  revalidatePath(`/patients/${parsed.data.patientId}`);
  return { success: true };
}
