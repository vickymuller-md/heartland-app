'use server';

/**
 * HEARTLAND Patient Vitals -- Server Actions
 *
 * Combined vitals + symptoms submission.
 * Validates with Zod, converts kg->lbs if needed, inserts into both
 * vitals and symptoms tables with the same recorded_at timestamp,
 * evaluates red flags, and returns the result.
 */

import { createClient } from '@/lib/supabase/server';
import { vitalsSchema, providerVitalsSchema } from './schema';
import { evaluateRedFlags } from './red-flags';
import { getRecentVitals } from './queries';
import type { VitalsRow, RedFlag, VitalsActionState, BatchRowResult, BatchVitalsActionState } from './types';
import { parseBatchFormData, isBlankRow } from './batch-schema';

export async function submitVitals(
  prevState: VitalsActionState | null,
  formData: FormData
): Promise<VitalsActionState> {
  // 1. Authenticate
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  // 2. Parse and validate
  const raw = Object.fromEntries(formData);
  const result = vitalsSchema.safeParse(raw);
  if (!result.success) {
    return { errors: result.error.flatten().fieldErrors };
  }

  // 3. Convert kg to lbs if needed (DB stores lbs)
  const weightLbs =
    result.data.weightUnit === 'kg'
      ? Math.round(result.data.weight * 2.20462 * 10) / 10
      : result.data.weight;

  // 4. Insert vitals
  const recordedAt = new Date().toISOString();

  const { data: vitals, error: vitalsError } = await supabase
    .from('vitals')
    .insert({
      patient_id: user.id,
      recorded_at: recordedAt,
      weight_lbs: weightLbs,
      sbp: result.data.sbp,
      dbp: result.data.dbp,
      heart_rate: result.data.heartRate,
      spo2: result.data.spo2 ?? null,
      source: 'patient_app',
    })
    .select()
    .single();

  if (vitalsError) return { error: 'Failed to save vitals' };

  // 5. Evaluate red flags (needs recent history)
  const recentVitals = await getRecentVitals(supabase, user.id, 7);
  const redFlags = evaluateRedFlags(
    { weight_lbs: weightLbs, sbp: result.data.sbp, spo2: result.data.spo2 ?? null },
    recentVitals,
    {
      dyspnea: result.data.dyspnea,
      edema: result.data.edema,
      orthopnea: result.data.orthopnea,
      fatigue: result.data.fatigue,
    }
  );

  // 6. Insert symptoms with same recorded_at
  const { error: symptomsError } = await supabase.from('symptoms').insert({
    patient_id: user.id,
    recorded_at: recordedAt,
    dyspnea: result.data.dyspnea,
    edema: result.data.edema,
    orthopnea: result.data.orthopnea,
    fatigue: result.data.fatigue,
    red_flag: redFlags.length > 0,
  });

  if (symptomsError) return { error: 'Failed to save symptoms' };

  return { success: true, vitals: vitals as VitalsRow, redFlags };
}

/**
 * Provider-side vitals entry for Track B (Analog) patients.
 *
 * Differs from patient submitVitals:
 *   - patientId from formData (not user.id)
 *   - Verifies provider_patient_links before insert
 *   - source: 'provider_entry' (not 'patient_app')
 *   - Optional recordedAt for diary transcription backdating
 */
export async function submitVitalsAsProvider(
  prevState: VitalsActionState | null,
  formData: FormData
): Promise<VitalsActionState> {
  // 1. Authenticate (provider)
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  // 2. Verify patient is linked to this provider
  const patientId = formData.get('patientId') as string;
  if (!patientId) return { error: 'Patient ID is required' };

  const { data: link } = await supabase
    .from('provider_patient_links')
    .select('id')
    .eq('provider_id', user.id)
    .eq('patient_id', patientId)
    .eq('status', 'active')
    .maybeSingle();
  if (!link) return { error: 'Patient not linked to this provider' };

  // 3. Parse and validate vitals (same Zod schema + optional recordedAt)
  const raw = Object.fromEntries(formData);
  const result = providerVitalsSchema.safeParse(raw);
  if (!result.success) return { errors: result.error.flatten().fieldErrors };

  // 4. Convert kg -> lbs (same as submitVitals)
  const weightLbs =
    result.data.weightUnit === 'kg'
      ? Math.round(result.data.weight * 2.20462 * 10) / 10
      : result.data.weight;

  // 5. Insert vitals with source: 'provider_entry' and explicit patient_id
  const recordedAt = result.data.recordedAt ?? new Date().toISOString();
  const { data: vitals, error: vitalsError } = await supabase
    .from('vitals')
    .insert({
      patient_id: patientId,
      recorded_at: recordedAt,
      weight_lbs: weightLbs,
      sbp: result.data.sbp,
      dbp: result.data.dbp,
      heart_rate: result.data.heartRate,
      spo2: result.data.spo2 ?? null,
      source: 'provider_entry',
    })
    .select()
    .single();
  if (vitalsError) return { error: 'Failed to save vitals' };

  // 6. Evaluate red flags (same engine -- does NOT inspect source field)
  const recentVitals = await getRecentVitals(supabase, patientId, 7);
  const redFlags = evaluateRedFlags(
    { weight_lbs: weightLbs, sbp: result.data.sbp, spo2: result.data.spo2 ?? null },
    recentVitals,
    {
      dyspnea: result.data.dyspnea,
      edema: result.data.edema,
      orthopnea: result.data.orthopnea,
      fatigue: result.data.fatigue,
    }
  );

  // 7. Insert symptoms with same recorded_at
  const { error: symptomsError } = await supabase.from('symptoms').insert({
    patient_id: patientId,
    recorded_at: recordedAt,
    dyspnea: result.data.dyspnea,
    edema: result.data.edema,
    orthopnea: result.data.orthopnea,
    fatigue: result.data.fatigue,
    red_flag: redFlags.length > 0,
  });
  if (symptomsError) return { error: 'Failed to save symptoms' };

  return { success: true, vitals: vitals as VitalsRow, redFlags };
}

/**
 * Provider-side 7-day batch vitals entry for Track B (Analog) patients.
 *
 * Accepts flat FormData with prefixed keys (row_0_weight, row_1_sbp, etc.)
 * Skips blank rows. Evaluates red flags per row with in-memory accumulator
 * so intra-batch weight trends are detected.
 * Returns BatchVitalsActionState with per-row results.
 */
export async function submitBatchVitalsAsProvider(
  prevState: BatchVitalsActionState | null,
  formData: FormData
): Promise<BatchVitalsActionState> {
  // 1. Auth
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  // 2. Link check (once for all rows)
  const patientId = formData.get('patientId') as string;
  if (!patientId) return { error: 'Patient ID is required' };

  const { data: link } = await supabase
    .from('provider_patient_links')
    .select('id')
    .eq('provider_id', user.id)
    .eq('patient_id', patientId)
    .eq('status', 'active')
    .maybeSingle();
  if (!link) return { error: 'Patient not linked to this provider' };

  // 3. Parse raw rows from prefixed FormData
  const rawRows = parseBatchFormData(formData);

  // 4. Pre-fetch 14-day history (covers full batch week + prior week for trend context)
  const recentVitals = await getRecentVitals(supabase, patientId, 14);
  // Mutable accumulator: append each successfully inserted row so subsequent rows detect intra-batch trends
  const historyAccumulator = [...recentVitals];

  const results: BatchRowResult[] = [];

  for (let i = 0; i < rawRows.length; i++) {
    const raw = rawRows[i];
    const date = (raw.recordedAt as string | null) ?? '';

    // 5a. Skip blank rows
    if (isBlankRow(raw)) {
      results.push({ rowIndex: i, date, success: false, redFlags: [], skipped: true });
      continue;
    }

    // 5b. Validate with providerVitalsSchema
    const parsed = providerVitalsSchema.safeParse({
      weight: raw.weight,
      weightUnit: raw.weightUnit ?? 'lbs',
      sbp: raw.sbp,
      dbp: raw.dbp,
      heartRate: raw.heartRate,
      spo2: raw.spo2,
      dyspnea: raw.dyspnea ?? '0',
      edema: '0',
      orthopnea: 'false',
      fatigue: '0',
      recordedAt: date ? `${date}T12:00:00Z` : undefined,
    });

    if (!parsed.success) {
      results.push({
        rowIndex: i,
        date,
        success: false,
        redFlags: [],
        error: Object.values(parsed.error.flatten().fieldErrors).flat().join(', '),
      });
      continue;
    }

    // 5c. Weight conversion
    const weightLbs =
      parsed.data.weightUnit === 'kg'
        ? Math.round(parsed.data.weight * 2.20462 * 10) / 10
        : parsed.data.weight;

    const recordedAt = parsed.data.recordedAt ?? `${date}T12:00:00Z`;

    // 5d. Insert vitals
    const { data: vitals, error: vitalsError } = await supabase
      .from('vitals')
      .insert({
        patient_id: patientId,
        recorded_at: recordedAt,
        weight_lbs: weightLbs,
        sbp: parsed.data.sbp,
        dbp: parsed.data.dbp,
        heart_rate: parsed.data.heartRate,
        spo2: parsed.data.spo2 ?? null,
        source: 'provider_entry',
      })
      .select()
      .single();

    if (vitalsError) {
      results.push({ rowIndex: i, date, success: false, redFlags: [], error: 'Failed to save vitals' });
      continue;
    }

    // 5e. Evaluate red flags with in-memory history (includes prior batch rows)
    const redFlags = evaluateRedFlags(
      { weight_lbs: weightLbs, sbp: parsed.data.sbp, spo2: parsed.data.spo2 ?? null },
      historyAccumulator,
      { dyspnea: parsed.data.dyspnea, edema: parsed.data.edema, orthopnea: parsed.data.orthopnea, fatigue: parsed.data.fatigue }
    );

    // 5f. Insert symptoms
    await supabase.from('symptoms').insert({
      patient_id: patientId,
      recorded_at: recordedAt,
      dyspnea: parsed.data.dyspnea,
      edema: parsed.data.edema,
      orthopnea: parsed.data.orthopnea,
      fatigue: parsed.data.fatigue,
      red_flag: redFlags.length > 0,
    });

    // 5g. Append to accumulator so next row sees this entry for trend detection
    historyAccumulator.unshift({ weight_lbs: weightLbs, recorded_at: recordedAt } as VitalsRow);

    results.push({ rowIndex: i, date, success: true, redFlags });
  }

  return {
    results,
    anyRedFlags: results.some((r) => r.redFlags.length > 0),
  };
}
