'use server';

/**
 * HEARTLAND Medication Tracking -- Server Actions
 *
 * CRUD operations for medications and dose logging.
 * Pattern follows Phase 7 vitals Server Actions:
 * authenticate -> validate with Zod -> DB operation -> revalidate -> return state.
 */

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { addMedicationSchema, logDoseSchema } from './schema';
import type { MedicationActionState } from './types';

/**
 * Add a new medication for the authenticated patient.
 */
export async function addMedication(
  prevState: MedicationActionState | null,
  formData: FormData
): Promise<MedicationActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  // Parse timing as array (sent as multiple form entries with same name)
  const timing = formData.getAll('timing') as string[];
  const raw = Object.fromEntries(formData);
  const result = addMedicationSchema.safeParse({ ...raw, timing });
  if (!result.success) {
    return { errors: result.error.flatten().fieldErrors };
  }

  const { error } = await supabase.from('medications').insert({
    patient_id: user.id,
    name: result.data.name,
    dosage: result.data.dosage,
    frequency: result.data.frequency,
    timing: result.data.timing,
    active: true,
  });

  if (error) return { error: 'Failed to add medication' };
  revalidatePath('/medications');
  return { success: true };
}

/**
 * Update an existing medication for the authenticated patient.
 */
export async function updateMedication(
  prevState: MedicationActionState | null,
  formData: FormData
): Promise<MedicationActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  const medicationId = formData.get('id') as string;
  if (!medicationId) return { error: 'Medication ID required' };

  const timing = formData.getAll('timing') as string[];
  const raw = Object.fromEntries(formData);
  const result = addMedicationSchema.safeParse({ ...raw, timing });
  if (!result.success) {
    return { errors: result.error.flatten().fieldErrors };
  }

  const { error } = await supabase
    .from('medications')
    .update({
      name: result.data.name,
      dosage: result.data.dosage,
      frequency: result.data.frequency,
      timing: result.data.timing,
    })
    .eq('id', medicationId)
    .eq('patient_id', user.id);

  if (error) return { error: 'Failed to update medication' };
  revalidatePath('/medications');
  return { success: true };
}

/**
 * Soft-delete a medication by setting active=false.
 */
export async function deactivateMedication(
  medicationId: string
): Promise<MedicationActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  const { error } = await supabase
    .from('medications')
    .update({ active: false })
    .eq('id', medicationId)
    .eq('patient_id', user.id);

  if (error) return { error: 'Failed to deactivate medication' };
  revalidatePath('/medications');
  return { success: true };
}

/**
 * Log (or un-log) a dose for a medication on a given day.
 * Uses upsert to handle both creating new logs and toggling existing ones.
 */
export async function logDose(
  prevState: MedicationActionState | null,
  formData: FormData
): Promise<MedicationActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  const medicationId = formData.get('medication_id') as string;
  const scheduledDate = formData.get('scheduled_date') as string;
  const doseNumber = parseInt(formData.get('dose_number') as string, 10);
  const taken = formData.get('taken') === 'true';

  const result = logDoseSchema.safeParse({
    medication_id: medicationId,
    scheduled_date: scheduledDate,
    dose_number: doseNumber,
    taken,
  });
  if (!result.success) {
    return { errors: result.error.flatten().fieldErrors };
  }

  const { error } = await supabase.from('medication_logs').upsert(
    {
      medication_id: result.data.medication_id,
      patient_id: user.id,
      scheduled_date: result.data.scheduled_date,
      dose_number: result.data.dose_number,
      taken: result.data.taken,
      taken_at: result.data.taken ? new Date().toISOString() : null,
    },
    { onConflict: 'medication_id,scheduled_date,dose_number' }
  );

  if (error) return { error: 'Failed to log dose' };
  revalidatePath('/medications');
  return { success: true };
}
