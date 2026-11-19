'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { authorize } from '@/lib/auth/authorization';
import { addMedicationSchema, logDoseSchema } from './schema';
import type { MedicationActionState } from './types';

function medicationInput(form: FormData) {
  const weekday = form.get('weekly_day');
  const instructions = String(form.get('timing_instruction') ?? '').trim();
  const timing = [...form.getAll('timing'), ...(instructions ? [instructions] : [])];
  return addMedicationSchema.safeParse({
    name: form.get('name'), dosage: form.get('dosage'), frequency: form.get('frequency'),
    frequency_instruction: form.get('frequency_instruction') ?? '', timing,
    weekly_day: form.get('frequency') === 'weekly' && typeof weekday === 'string' && /^[0-6]$/.test(weekday) ? Number(weekday) : null,
  });
}

function medicationFields(input: { name: string; dosage: string; frequency: string; frequency_instruction: string; weekly_day: number | null; timing: string[] }) {
  return { name: input.name, dosage: input.dosage,
    frequency: input.frequency === 'other' ? input.frequency_instruction : input.frequency === 'as_directed' ? 'as directed' : input.frequency,
    weekly_day: input.weekly_day, timing: input.timing.length ? input.timing.join('\n') : null };
}

function matchesActiveMedication(saved: Record<string, unknown> | null, fields: ReturnType<typeof medicationFields>) {
  return saved?.active === true && Object.entries(fields).every(([key, value]) => saved[key] === value);
}

function medicationViews() {
  revalidatePath('/medications');
  revalidatePath('/today');
}

export async function setMedicationTimeZone(form: FormData): Promise<MedicationActionState> {
  const auth = await authorize('patient');
  if (!auth.authorized) return { error: auth.error };
  const input = z.object({ actor: z.uuid(), request: z.uuid(), revision: z.uuid(), zone: z.string().trim().min(1).max(100) }).safeParse(Object.fromEntries(form));
  if (!input.success || input.data.actor !== auth.user.id) return { error: 'Reload your calendar before changing the time zone.' };
  const { request, revision, zone } = input.data;
  const { data, error } = await auth.supabase.rpc('set_patient_medication_timezone', { p_actor: auth.user.id, p_request: request, p_revision: revision, p_zone: zone });
  if (error || data !== request) return { error: 'The time zone could not be confirmed. Check the zone name or reload your current choice.' };
  medicationViews();
  return { success: true };
}

export async function addMedication(_previous: MedicationActionState | null, form: FormData): Promise<MedicationActionState> {
  const auth = await authorize('patient');
  if (!auth.authorized) return { error: auth.error };
  const request = z.uuid().safeParse(form.get('request_id'));
  if (form.get('actor_id') !== auth.user.id || !request.success) return { error: 'Reload this medication form before saving.' };
  const parsed = medicationInput(form);
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };
  const row = medicationFields(parsed.data);
  const { error } = await auth.supabase.from('medications').insert({
    ...row, patient_id: auth.user.id, client_request_id: request.data, active: true,
  });
  if (error) {
    if (error.code !== '23505') return { error: 'Medication could not be saved. Try again.' };
    const { data: existing, error: readError } = await auth.supabase.from('medications')
      .select('name,dosage,frequency,timing,weekly_day,active').eq('patient_id', auth.user.id).eq('client_request_id', request.data).maybeSingle();
    if (readError || !matchesActiveMedication(existing, row)) {
      return { error: 'This form changed after an earlier save. Reload your medication list.' };
    }
  }
  medicationViews();
  return { success: true };
}

export async function updateMedication(_previous: MedicationActionState | null, form: FormData): Promise<MedicationActionState> {
  const auth = await authorize('patient');
  if (!auth.authorized) return { error: auth.error };
  const id = z.uuid().safeParse(form.get('id'));
  const revision = z.uuid().safeParse(form.get('revision'));
  if (form.get('actor_id') !== auth.user.id || !id.success || !revision.success) return { error: 'Reload this medication form before saving.' };
  const parsed = medicationInput(form);
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };
  const fields = medicationFields(parsed.data);
  const { data, error } = await auth.supabase.from('medications')
    .update(fields)
    .eq('id', id.data).eq('patient_id', auth.user.id).eq('active', true).eq('schedule_revision', revision.data).select('id');
  if (error) return { error: 'The medication could not be updated. Try again.' };
  if (!data?.length) {
    const readback = await auth.supabase.from('medications').select('name,dosage,frequency,timing,weekly_day,active')
      .eq('id', id.data).eq('patient_id', auth.user.id).maybeSingle();
    if (readback.error || !matchesActiveMedication(readback.data, fields)) return { error: 'The medication changed. Reload the list before editing it.' };
  }
  medicationViews();
  return { success: true };
}

export async function deactivateMedication(medicationId: string, actorId: string, revision: string): Promise<MedicationActionState> {
  const auth = await authorize('patient');
  if (!auth.authorized) return { error: auth.error };
  if (actorId !== auth.user.id || !z.uuid().safeParse(medicationId).success || !z.uuid().safeParse(revision).success) return { error: 'Reload this medication before removing it.' };
  const { data, error } = await auth.supabase.from('medications').update({ active: false })
    .eq('id', medicationId).eq('patient_id', auth.user.id).eq('active', true).eq('schedule_revision', revision).select('id');
  if (error) return { error: 'The medication could not be removed. Try again.' };
  if (!data?.length) {
    const readback = await auth.supabase.from('medications').select('active')
      .eq('id', medicationId).eq('patient_id', auth.user.id).maybeSingle();
    if (readback.error || readback.data?.active !== false) return { error: 'The medication changed. Reload your list before removing it.' };
  }
  medicationViews();
  return { success: true };
}

export async function logDose(_previous: MedicationActionState | null, form: FormData): Promise<MedicationActionState> {
  const auth = await authorize('patient');
  if (!auth.authorized) return { error: auth.error };
  const version = z.uuid().safeParse(form.get('version'));
  const calendar = z.uuid().safeParse(form.get('calendar_revision'));
  if (form.get('actor_id') !== auth.user.id || !version.success || !calendar.success) return { error: 'Reload the current medication schedule.' };
  const taken = form.get('taken');
  const parsed = logDoseSchema.safeParse({
    medication_id: form.get('medication_id'), scheduled_date: form.get('scheduled_date'),
    dose_number: Number(form.get('dose_number')), taken: taken === 'true' ? true : taken === 'false' ? false : null,
  });
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };
  const { error } = await auth.supabase.rpc('record_medication_dose_in_calendar', {
    p_actor: auth.user.id, p_medication: parsed.data.medication_id, p_version: version.data,
    p_day: parsed.data.scheduled_date, p_slot: parsed.data.dose_number, p_taken: parsed.data.taken, p_calendar_revision: calendar.data,
  });
  if (error) return { error: 'Dose recording was not confirmed. Reload the schedule and try again.' };
  medicationViews();
  return { success: true };
}
