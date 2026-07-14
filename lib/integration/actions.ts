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
import type { SaveResult, TitrationNoteData, GdmtMedicationInput } from './types';
import {
  TRACK_MAP,
  formatTitrationNote,
  buildGdmtMedications,
} from './utils';

// Re-export pure functions for backward compatibility with existing imports
export { TRACK_MAP, formatTitrationNote, buildGdmtMedications };

// ---------- Zod Schemas ----------

const riskScoreSchema = z.object({
  patientId: z.uuid('Invalid patient ID'),
  score: z.number().int().min(0).max(18),
  tier: z.enum(['low', 'moderate', 'high']),
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
): Promise<SaveResult> {
  const raw = {
    patientId: formData.get('patientId') as string,
    score: Number(formData.get('score')),
    tier: formData.get('tier') as string,
  };

  const parsed = riskScoreSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: 'Validation failed' };
  }

  const auth = await authorizeProviderForPatient(parsed.data.patientId);
  if (!auth.authorized) return { success: false, error: auth.error };

  const { data, error } = await auth.supabase
    .from('patients')
    .update({
      risk_tier: parsed.data.tier,
      risk_score: parsed.data.score,
      risk_scored_at: new Date().toISOString(),
    })
    .eq('id', parsed.data.patientId)
    .select('id');

  if (error) return { success: false, error: 'Unable to save risk score' };
  if (!data || data.length === 0) {
    return { success: false, error: 'Patient not found or not linked to provider' };
  }

  revalidatePath(`/patients/${parsed.data.patientId}`);
  revalidatePath('/dashboard');
  return { success: true };
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
  data: TitrationNoteData
): Promise<SaveResult> {
  if (!patientId || !z.string().uuid().safeParse(patientId).success) {
    return { success: false, error: 'Invalid patient ID' };
  }

  const noteContent = formatTitrationNote(data);

  const auth = await authorizeProviderForPatient(patientId);
  if (!auth.authorized) return { success: false, error: auth.error };

  const { error } = await auth.supabase.from('provider_notes').insert({
    patient_id: patientId,
    provider_id: auth.user.id,
    content: noteContent,
  });

  if (error) return { success: false, error: 'Unable to save titration note' };

  revalidatePath(`/patients/${patientId}`);
  return { success: true };
}

/**
 * Save GDMT medication selections to patient medication list.
 * INTG-05: Filters duplicates then inserts non-duplicate records.
 *
 * Called programmatically (not via form action), so typed params directly.
 */
export async function saveGdmtMedications(
  patientId: string,
  selected: GdmtMedicationInput[],
  existingMedNames: string[]
): Promise<SaveResult> {
  if (!patientId || !z.string().uuid().safeParse(patientId).success) {
    return { success: false, error: 'Invalid patient ID' };
  }

  const newMeds = buildGdmtMedications(selected, existingMedNames);
  if (newMeds.length === 0) {
    return { success: true }; // Nothing to insert -- all duplicates
  }

  const auth = await authorizeProviderForPatient(patientId);
  if (!auth.authorized) return { success: false, error: auth.error };

  const rows = newMeds.map(m => ({
    patient_id: patientId,
    name: m.name,
    dosage: m.dosage,
    frequency: m.frequency,
    active: true,
  }));

  const { error } = await auth.supabase.from('medications').insert(rows);

  if (error) return { success: false, error: 'Unable to save medications' };

  revalidatePath(`/patients/${patientId}`);
  return { success: true };
}
