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
import {
  FLAG_LABELS,
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
  requestId: z.uuid('A valid submission identity is required'),
  collectedAt: z.iso.datetime({ offset: true, error: 'Enter a valid collection date and time with a timezone' })
    .refine((value) => !/\.\d{7}/.test(value), 'Collection time supports up to six fractional second digits')
    .refine((value) => new Date(value).getTime() <= Date.now(), 'Collection time cannot be in the future'),
  potassium: z.coerce.number().min(1).max(10).multipleOf(0.1, 'Potassium supports one decimal place').optional(),
  egfr: z.coerce.number().min(1).max(200).int('eGFR requires a whole number').optional(),
  creatinine: z.coerce.number().min(0.1).max(20).multipleOf(0.01, 'Creatinine supports two decimal places').optional(),
  sodium: z.coerce.number().min(100).max(170).multipleOf(0.1, 'Sodium supports one decimal place').optional(),
  notes: z.string().max(500).optional(),
}).refine(
  (value) => [value.potassium, value.egfr, value.creatinine, value.sodium].some((analyte) => analyte !== undefined),
  'Enter at least one lab value',
);

// ---------- Lab Result Action (SAFE-04) ----------

export interface LabActionState {
  success?: boolean;
  error?: string;
  status?: 'not_saved' | 'save_unconfirmed' | 'saved' | 'saved_alert_pending';
  labResultId?: string;
  eventId?: string;
  alertStatus?: 'pending' | 'recorded' | 'not_required';
}

export interface LabSubmission {
  requestId: string;
  status: 'prepared' | 'committed' | 'acknowledged' | 'cancelled';
  labResultId: string | null;
  eventId: string | null;
  alertStatus: 'pending' | 'recorded' | 'not_required' | null;
  collectedAt: string | null;
  potassium: number | null;
  egfr: number | null;
  creatinine: number | null;
  sodium: number | null;
  notes: string | null;
  isNew: boolean;
}

export type LabSubmissionState =
  | { success: true; actorId: string; submission: LabSubmission | null }
  | { success: false; error: string };

const labSubmissionInputSchema = z.object({
  patientId: z.uuid(),
  requestId: z.uuid().optional(),
  labResultId: z.uuid().optional(),
});

const labSubmissionRowSchema = z.object({
  request_id: z.uuid(),
  submission_status: z.enum(['prepared', 'committed', 'acknowledged', 'cancelled']),
  lab_result_id: z.uuid().nullable(),
  event_id: z.uuid().nullable(),
  alert_status: z.enum(['pending', 'recorded', 'not_required']).nullable(),
  collected_at: z.iso.datetime({ offset: true }).nullable(),
  potassium: z.number().finite().nullable(),
  egfr: z.number().finite().nullable(),
  creatinine: z.number().finite().nullable(),
  sodium: z.number().finite().nullable(),
  notes: z.string().max(500).nullable(),
  is_new: z.boolean(),
}).refine((row) => {
  const saved = row.submission_status === 'committed' || row.submission_status === 'acknowledged';
  const values = [row.potassium, row.egfr, row.creatinine, row.sodium];
  if (saved) return row.lab_result_id !== null && row.event_id !== null
    && row.alert_status !== null && row.collected_at !== null
    && values.some((value) => value !== null) && !row.is_new;
  return row.lab_result_id === null && row.event_id === null && row.alert_status === null
    && row.collected_at === null && row.notes === null && values.every((value) => value === null)
    && (row.submission_status === 'prepared' || !row.is_new);
});

type LabSubmissionOperation = 'get' | 'prepare' | 'acknowledge' | 'cancel';

/** Recovery never inserts an exam or invokes the trusted alert processor. */
async function labSubmissionAction(
  operation: LabSubmissionOperation,
  input: { patientId: string; requestId?: string; labResultId?: string },
): Promise<LabSubmissionState> {
  const parsed = labSubmissionInputSchema.safeParse(input);
  if (!parsed.success || ((operation === 'acknowledge' || operation === 'cancel') && !parsed.data.requestId)
    || (operation === 'acknowledge' && !parsed.data.labResultId)) {
    return { success: false, error: 'Invalid laboratory submission identity' };
  }
  const { patientId, requestId, labResultId } = parsed.data;
  const unavailable: LabSubmissionState = {
    success: false,
    error: 'Unable to confirm the laboratory submission status. Recheck the existing attempt before starting another entry.',
  };
  try {
    const auth = await authorizeProviderForPatient(patientId);
    if (!auth.authorized) return { success: false, error: auth.error };

    const rpcArgs: Record<string, string | null> = { p_patient_id: patientId };
    if (operation !== 'prepare') rpcArgs.p_request_id = requestId ?? null;
    if (operation === 'acknowledge') rpcArgs.p_lab_result_id = labResultId!;
    const { data, error } = await auth.supabase.rpc(`${operation}_lab_submission`, rpcArgs);
    const rows = z.array(labSubmissionRowSchema).max(1).safeParse(data);
    if (error || !rows.success) return unavailable;
    if (rows.data.length === 0) {
      return operation === 'get' && requestId === undefined
        ? { success: true, actorId: auth.user.id, submission: null } : unavailable;
    }
    const row = rows.data[0];
    const active = row.submission_status === 'prepared' || row.submission_status === 'committed';
    if ((requestId && row.request_id !== requestId)
      || (operation !== 'prepare' && row.is_new)
      || ((operation === 'prepare' || (operation === 'get' && requestId === undefined)) && !active)
      || (operation === 'acknowledge' && (row.submission_status !== 'acknowledged' || row.lab_result_id !== labResultId))
      || (operation === 'cancel' && row.submission_status === 'prepared')) return unavailable;

    const submission: LabSubmission = {
      requestId: row.request_id, status: row.submission_status,
      labResultId: row.lab_result_id, eventId: row.event_id, alertStatus: row.alert_status,
      collectedAt: row.collected_at, potassium: row.potassium, egfr: row.egfr,
      creatinine: row.creatinine, sodium: row.sodium, notes: row.notes, isNew: row.is_new,
    };
    if (operation === 'acknowledge' || operation === 'cancel') revalidatePath(`/patients/${patientId}`);
    return { success: true, actorId: auth.user.id, submission };
  } catch {
    // A transport failure is not evidence that prepare, save, acknowledge or cancel rolled back.
    return unavailable;
  }
}

export async function getLabSubmission(input: { patientId: string; requestId?: string }): Promise<LabSubmissionState> {
  return labSubmissionAction('get', input);
}

export async function prepareLabSubmission(input: { patientId: string }): Promise<LabSubmissionState> {
  return labSubmissionAction('prepare', input);
}

export async function acknowledgeLabSubmission(input: {
  patientId: string; requestId: string; labResultId: string;
}): Promise<LabSubmissionState> {
  return labSubmissionAction('acknowledge', input);
}

export async function cancelLabSubmission(input: { patientId: string; requestId: string }): Promise<LabSubmissionState> {
  return labSubmissionAction('cancel', input);
}

const labReceiptSchema = z.object({
  lab_result_id: z.uuid(),
  event_id: z.uuid(),
  status: z.enum(['pending', 'recorded', 'not_required']),
});
type LabReceipt = z.infer<typeof labReceiptSchema>;
const labReceiptRowsSchema = z.array(labReceiptSchema).length(1);

function labOutcome(receipt: LabReceipt): LabActionState {
  const pending = receipt.status === 'pending';
  return {
    success: !pending,
    status: pending ? 'saved_alert_pending' : 'saved',
    labResultId: receipt.lab_result_id,
    eventId: receipt.event_id,
    alertStatus: receipt.status,
  };
}

async function processLabReceipt(receipt: LabReceipt): Promise<LabActionState> {
  if (receipt.status !== 'pending') return labOutcome(receipt);
  try {
    const { data, error } = await supabaseAdmin.rpc('process_lab_alert_event', {
      p_lab_result_id: receipt.lab_result_id,
    });
    const parsed = labReceiptRowsSchema.safeParse(data);
    if (!error && parsed.success) {
      const processed = parsed.data[0];
      if (processed.lab_result_id === receipt.lab_result_id && processed.event_id === receipt.event_id) {
        return labOutcome(processed);
      }
    }
  } catch {
    // The lab and its pending event already exist. Never reinsert on failure.
  }
  return labOutcome(receipt);
}

/**
 * Save an idempotent lab submission and durable evaluation in one transaction,
 * then attempt service-only processing. The database evaluates the persisted
 * values using the existing immediate thresholds; recorded is not delivered.
 * Compatible with useActionState (prevState, formData) signature.
 */
export async function saveLabResult(
  _prevState: unknown,
  formData: FormData
): Promise<LabActionState> {
  // 1. Extract and validate input
  const raw: Record<string, unknown> = {
    patientId: formData.get('patientId') as string,
    requestId: formData.get('requestId'),
    collectedAt: formData.get('collectedAt'),
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
    return { status: 'not_saved', error: parsed.error.issues.map((i) => i.message).join(', ') };
  }

  const { patientId, requestId, collectedAt, potassium, egfr, creatinine, sodium, notes } = parsed.data;
  const auth = await authorizeProviderForPatient(patientId);
  if (!auth.authorized) return { error: auth.error };

  let receipt: LabReceipt | undefined;
  try {
    // Authenticated RPC independently rechecks access and compares a canonical
    // payload under the stable request identity before creating any new row.
    const { data, error } = await auth.supabase.rpc('submit_lab_result', {
      p_request_id: requestId,
      p_patient_id: patientId,
      // PostgreSQL preserves microseconds; Date.toISOString() would truncate them.
      p_collected_at: collectedAt,
      p_potassium: potassium ?? null,
      p_egfr: egfr ?? null,
      p_creatinine: creatinine ?? null,
      p_sodium: sodium ?? null,
      p_notes: notes ?? null,
    });
    const result = labReceiptRowsSchema.safeParse(data);
    if (!error && result.success) receipt = result.data[0];
  } catch {
    // A lost response does not establish that the transaction was rolled back.
  }
  if (!receipt) {
    return {
      success: false,
      status: 'save_unconfirmed',
      error: 'Unable to confirm whether the lab result was saved. Recheck the same submission status without resending its values before starting a new entry.',
    };
  }

  const result = await processLabReceipt(receipt);
  revalidatePath(`/patients/${patientId}`);
  if (result.alertStatus === 'recorded') {
    revalidatePath('/dashboard');
    revalidatePath('/alerts');
  }
  return result;
}

/** Explicit recovery only: scope the existing event before using service role. */
export async function retryLabAlerts(input: {
  patientId: string;
  labResultId: string;
}): Promise<LabActionState> {
  const parsed = z.object({ patientId: z.uuid(), labResultId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { error: 'Invalid lab result identity' };
  const { patientId, labResultId } = parsed.data;
  const auth = await authorizeProviderForPatient(patientId);
  if (!auth.authorized) return { error: auth.error };

  let receipt: LabReceipt | undefined;
  try {
    const { data, error } = await auth.supabase
      .from('lab_alert_evaluations')
      .select('id, lab_result_id, patient_id, status')
      .eq('patient_id', patientId)
      .eq('lab_result_id', labResultId)
      .maybeSingle();
    if (!error && data?.patient_id === patientId && data.lab_result_id === labResultId) {
      const result = labReceiptSchema.safeParse({
        lab_result_id: data.lab_result_id, event_id: data.id, status: data.status,
      });
      if (result.success) receipt = result.data;
    }
  } catch {
    // No trusted processing if the authenticated lookup cannot be confirmed.
  }
  if (!receipt) return { error: 'Unable to access this lab evaluation. Refresh and try again.' };
  const result = await processLabReceipt(receipt);
  revalidatePath(`/patients/${patientId}`);
  if (result.alertStatus === 'recorded') {
    revalidatePath('/dashboard');
    revalidatePath('/alerts');
  }
  return result;
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
  input: { alertId: string; resolutionNote: string },
): Promise<{ success: boolean; error?: string }> {
  const parsed = z.object({ alertId: z.uuid(), resolutionNote: z.string().trim().min(3).max(1000) }).safeParse(input);
  if (!parsed.success) return { success: false, error: 'Document how the alert was resolved' };
  const auth = await authorize('provider');
  if (!auth.authorized) return { success: false, error: auth.error };

  const { data, error } = await auth.supabase
    .from('alerts')
    .update({
      status: 'resolved',
      resolution_note: parsed.data.resolutionNote,
    })
    .eq('id', parsed.data.alertId)
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
