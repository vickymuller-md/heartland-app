'use server';

/**
 * Phase 12: Tool Integration -- Save Results to Patient Profile
 *
 * Server Actions for saving tool results (risk score, facility tier,
 * track assignment, titration notes, GDMT medications) to patient records.
 *
 * All actions follow the addProviderNote pattern from lib/dashboard/actions.ts:
 * - Auth check via supabase.auth.getUser()
 * - Zod validation for all inputs
 * - RLS-aware: check both error AND count===0 for silent blocks
 *
 * Requirements: INTG-01 through INTG-05
 */

import { authorizeProviderForPatient } from '@/lib/auth/authorization';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { riskInputSchema, RISK_FRAMEWORK_VERSION } from '@/lib/risk-score/schema';
import { titrationNoteSchema, type SaveResult, type TitrationNoteData, type TitrationNoteSaveResult, type ConfirmedGdmtMedication } from './types';
import {
  TRACK_MAP,
  formatTitrationNote,
} from './utils';

// ---------- Zod Schemas ----------

const riskScoreSchema = z.object({
  patientId: z.uuid(),
  actorId: z.uuid(),
  requestId: z.uuid(),
  version: z.literal(RISK_FRAMEWORK_VERSION),
  factors: riskInputSchema,
});

const facilityTierSchema = z.object({
  patientId: z.uuid('Invalid patient ID'),
  facilityTier: z.number().int().min(1).max(3),
});

const trackAssignmentSchema = z.object({
  patientId: z.uuid('Invalid patient ID'),
  track: z.string(),
});

// ---------- Server Actions ----------

/**
 * Save risk calculator result to patient profile.
 * INTG-01: Updates patients.risk_tier, risk_score, risk_scored_at
 *
 * Compatible with useActionState (_prevState, formData) signature.
 */
export async function saveRiskScore(
  _prevState: unknown,
  formData: FormData
): Promise<SaveResult & { requestId?: string }> {
  const requestId = String(formData.get('requestId') ?? '');
  let factors: unknown;
  try {
    factors = JSON.parse(String(formData.get('inputs')));
  } catch {
    return { success: false, error: 'Review all ten factors before saving.', requestId };
  }
  const parsed = riskScoreSchema.safeParse({
    patientId: formData.get('patientId'), actorId: formData.get('actorId'),
    requestId, version: formData.get('version'), factors,
  });
  if (!parsed.success) return { success: false, error: 'Assessment incomplete or outdated. Review the factors.', requestId };

  const { patientId, actorId, version } = parsed.data;
  const auth = await authorizeProviderForPatient(patientId);
  if (!auth.authorized || auth.user.id !== actorId) {
    return { success: false, error: 'Session or patient access changed. Reload before saving.', requestId };
  }
  const { data, error } = await auth.supabase.rpc('record_risk_assessment', {
    p_expected_actor: actorId, p_patient_id: patientId, p_request_id: requestId,
    p_version: version, p_factors: parsed.data.factors,
  });
  if (error || data !== requestId) return { success: false, error: 'Save could not be confirmed. Retry this assessment.', requestId };
  revalidatePath(`/patients/${patientId}`);
  revalidatePath('/dashboard');
  return { success: true, requestId };
}

/**
 * Save facility tier selector result to patient profile.
 * INTG-02: Updates patients.facility_tier
 *
 * Compatible with useActionState (_prevState, formData) signature.
 */
export async function saveFacilityTier(
  _prevState: unknown,
  formData: FormData
): Promise<SaveResult> {
  const raw = {
    patientId: formData.get('patientId') as string,
    facilityTier: Number(formData.get('facilityTier')),
  };

  const parsed = facilityTierSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: 'Validation failed' };
  }

  const auth = await authorizeProviderForPatient(parsed.data.patientId);
  if (!auth.authorized) return { success: false, error: auth.error };

  const { data, error } = await auth.supabase
    .from('patients')
    .update({ facility_tier: parsed.data.facilityTier })
    .eq('id', parsed.data.patientId)
    .select('id');

  if (error) return { success: false, error: 'Unable to save facility tier' };
  if (!data || data.length === 0) {
    return { success: false, error: 'Patient not found or not linked to provider' };
  }

  revalidatePath(`/patients/${parsed.data.patientId}`);
  return { success: true };
}

/**
 * Save track assignment result to patient profile.
 * INTG-03: Maps engine values to DB values and updates patients.track_assignment
 *
 * Compatible with useActionState (_prevState, formData) signature.
 */
export async function saveTrackAssignment(
  _prevState: unknown,
  formData: FormData
): Promise<SaveResult> {
  const raw = {
    patientId: formData.get('patientId') as string,
    track: formData.get('track') as string,
  };

  const parsed = trackAssignmentSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: 'Validation failed' };
  }

  const dbTrack = TRACK_MAP[parsed.data.track];
  if (!dbTrack) {
    return { success: false, error: 'Invalid track value' };
  }

  const auth = await authorizeProviderForPatient(parsed.data.patientId);
  if (!auth.authorized) return { success: false, error: auth.error };

  const { data, error } = await auth.supabase
    .from('patients')
    .update({ track_assignment: dbTrack })
    .eq('id', parsed.data.patientId)
    .select('id');

  if (error) return { success: false, error: 'Unable to save track assignment' };
  if (!data || data.length === 0) {
    return { success: false, error: 'Patient not found or not linked to provider' };
  }

  revalidatePath(`/patients/${parsed.data.patientId}`);
  return { success: true };
}

// ---------- Composite Server Actions ----------

/**
 * Save titration checklist as a structured provider note.
 * INTG-04: Calls formatTitrationNote then inserts into provider_notes.
 *
 * Called programmatically (not via form action), so typed params directly.
 */
export async function saveTitrationNote(
  patientId: string,
  data: TitrationNoteData,
  expectedActorId: string,
): Promise<TitrationNoteSaveResult> {
  if (!z.uuid().safeParse(patientId).success || !z.uuid().safeParse(expectedActorId).success) {
    return { success: false, outcome: 'not_saved', error: 'Invalid patient or session identity' };
  }
  let dispatched = false;
  try {
    const parsed = titrationNoteSchema.safeParse(data);
    if (!parsed.success || parsed.data.vitals.potassium === null || parsed.data.vitals.creatinine === null
      || Object.entries(parsed.data.laboratorySnapshots ?? {}).some(([analyte, snapshot]) => snapshot.observation
        && (snapshot.observation.patient_id !== patientId || snapshot.observation.analyte !== analyte))) {
      return { success: false, outcome: 'not_saved', error: 'Invalid titration note. Verify the draft before saving.' };
    }
    const noteContent = formatTitrationNote(parsed.data);
    const auth = await authorizeProviderForPatient(patientId);
    if (!auth.authorized || auth.user.id !== expectedActorId) return { success: false, outcome: 'not_saved', error: 'Patient or session authorization changed. Reload the page.' };
    dispatched = true;
    const { error } = await auth.supabase.from('provider_notes').insert({ patient_id: patientId, provider_id: auth.user.id, content: noteContent });
    // The legacy insert has no durable request UUID: even a transport-shaped error may follow a commit.
    if (error) return { success: false, outcome: 'unknown', error: 'The note may have been saved. Check the patient record before submitting another note.' };
    revalidatePath(`/patients/${patientId}`);
    return { success: true, outcome: 'saved' };
  } catch {
    return dispatched
      ? { success: false, outcome: 'unknown', error: 'The note may have been saved. Check the patient record before submitting another note.' }
      : { success: false, outcome: 'not_saved', error: 'The note could not be prepared or authorized. Verify the draft before saving.' };
  }
}

/**
 * Save GDMT medication selections to patient medication list.
 * INTG-05: Filters duplicates then inserts non-duplicate records.
 *
 * Called programmatically (not via form action), so typed params directly.
 */
export async function saveGdmtMedications(
  patientId: string,
  selected: ConfirmedGdmtMedication[],
  expectedActor: string,
): Promise<SaveResult & { added?: number; existing?: number }> {
  const auth = await authorizeProviderForPatient(patientId);
  if (!auth.authorized) return { success: false, error: auth.error };
  if (auth.user.id !== expectedActor) return { success: false, error: 'The provider session changed. Reload the pathway.' };
  const input = z.array(z.object({
    request_id: z.uuid(), name: z.string().trim().min(1).max(200).refine(name => !/\sor\s/i.test(name)),
    dosage: z.string().trim().min(1).max(100),
    frequency: z.enum(['daily','once_daily','twice_daily','three_times_daily','four_times_daily','as_needed','as directed']),
  }).strict()).min(1).max(20).safeParse(selected);
  if (!input.success) return { success: false, error: 'Confirm one medication name, dosage and frequency for each selection.' };
  const { data, error } = await auth.supabase.rpc('record_gdmt_medications', {
    p_actor: expectedActor, p_patient: patientId, p_selections: input.data,
  });
  const receipt = z.object({ added: z.number().int().min(0), existing: z.number().int().min(0) }).safeParse(data);
  if (error || !receipt.success || receipt.data.added + receipt.data.existing !== input.data.length) {
    return { success: false, error: 'The medication list could not be confirmed. Retry or reload the patient list.' };
  }
  revalidatePath(`/patients/${patientId}`);
  revalidatePath('/medications');
  revalidatePath('/today');
  return { success: true, ...receipt.data };
}
