'use server';

import { z } from 'zod';
import { authorizeProviderForPatient } from '@/lib/auth/authorization';
import { isBlankRow, parseBatchFormData } from './batch-schema';
import { providerVitalsSchema } from './schema';
import { snapshotSchema, stateFromSnapshot } from './submission-receipt';
import { recoverVitalsSubmission } from './submission-actions';
import { mergeRecoveredVitals } from './recovery-state';
import type { BatchVitalsActionState, BatchRowResult, VitalsActionState } from './types';

const uuid = z.string().uuid();
const batchSchema = z.object({
  mode: z.literal('batch'), batch_id: uuid,
  submission_status: z.enum(['prepared', 'committed', 'acknowledged', 'cancelled']),
  rows: z.array(z.object({ row_index: z.number().int().min(0).max(6), receipt: snapshotSchema })).max(7),
}).refine((batch) => new Set(batch.rows.map((row) => row.row_index)).size === batch.rows.length
  && new Set(batch.rows.map((row) => row.receipt.request_id)).size === batch.rows.length);

async function readState(patientId: string, raw: unknown): Promise<BatchVitalsActionState> {
  const batch = batchSchema.parse(raw);
  const saved = batch.submission_status === 'committed' || batch.submission_status === 'acknowledged';
  if (saved !== (batch.rows.length > 0) || batch.rows.some((row) => row.receipt.submission_status !== 'batched'
    || row.receipt.observation?.vitals.patient_id !== patientId)) throw new Error('Invalid batch receipt');
  const state: BatchVitalsActionState = { batchId: batch.batch_id, submissionStatus: batch.submission_status, saved };
  if (!saved) return state;
  const results: BatchRowResult[] = [];
  for (let i = 0; i < 7; i++) {
    const row = batch.rows.find((entry) => entry.row_index === i);
    if (!row) { results.push({ rowIndex: i, date: '', success: false, skipped: true, redFlags: [] }); continue; }
    const captured = stateFromSnapshot(row.receipt);
    let recovered: VitalsActionState;
    try { recovered = await recoverVitalsSubmission(patientId, row.receipt.request_id); }
    catch { recovered = { errorKind: 'unavailable', error: 'This reading is saved, but its evaluation could not be checked. Retry evaluation without entering it again.' }; }
    if (recovered.errorKind === 'access') return { error: recovered.error, errorKind: 'access' };
    const receipt = mergeRecoveredVitals(captured, recovered, row.receipt.request_id);
    results.push({ rowIndex: i, date: receipt.vitals?.recorded_at.slice(0, 10) ?? '',
      success: receipt.success === true && receipt.evaluationStatus === 'complete',
      redFlags: receipt.redFlags ?? [], error: receipt.error, receipt });
  }
  return { ...state, results, anyRedFlags: results.some((row) => row.redFlags.length > 0) };
}

export async function recoverVitalsBatch(patientId: string, batchId?: string): Promise<BatchVitalsActionState> {
  if (!uuid.safeParse(patientId).success || (batchId !== undefined && !uuid.safeParse(batchId).success)) return { error: 'Invalid batch identity' };
  const auth = await authorizeProviderForPatient(patientId);
  if (!auth.authorized) return { error: auth.error, errorKind: 'access' };
  try {
    const { data, error } = batchId
      ? await auth.supabase.rpc('get_vitals_batch', { p_patient_id: patientId, p_batch_id: batchId })
      : await auth.supabase.rpc('get_active_vitals_capture', { p_patient_id: patientId });
    if (error) return { error: 'Could not recover the batch. Check again before entering these readings.', errorKind: error.code === '42501' ? 'access' : 'unavailable' };
    if (!data) return batchId ? { error: 'This batch is no longer accessible.', errorKind: 'access' } : {};
    if (data.mode === 'individual') return { activeIndividual: true, error: 'An individual entry is active. Open Single Entry to recover or cancel it first.' };
    return await readState(patientId, data);
  } catch { return { error: 'Could not recover the batch. Check again before entering these readings.', errorKind: 'unavailable' }; }
}

export async function prepareVitalsBatch(patientId: string): Promise<BatchVitalsActionState> {
  if (!uuid.safeParse(patientId).success) return { error: 'Invalid patient ID' };
  const auth = await authorizeProviderForPatient(patientId);
  if (!auth.authorized) return { error: auth.error, errorKind: 'access' };
  try {
    const { data, error } = await auth.supabase.rpc('prepare_vitals_batch', { p_patient_id: patientId });
    if (!error && data) return await readState(patientId, data);
  } catch { /* Resolve competing mode/response loss through durable recovery. */ }
  const recovered = await recoverVitalsBatch(patientId);
  return recovered.batchId || recovered.activeIndividual ? recovered : { ...recovered, error: recovered.error ?? 'Could not prepare the batch. Reconnect and retry.' };
}

export async function submitCapturedVitalsBatch(_previous: BatchVitalsActionState | null, formData: FormData): Promise<BatchVitalsActionState> {
  const patient = uuid.safeParse(formData.get('patientId'));
  const batch = uuid.safeParse(formData.get('batchId'));
  if (!patient.success || !batch.success) return { error: 'Prepare or recover this batch before saving.' };
  const auth = await authorizeProviderForPatient(patient.data);
  if (!auth.authorized) return { error: auth.error, errorKind: 'access' };
  const results: BatchRowResult[] = [];
  const rows = parseBatchFormData(formData).map((raw, i) => {
    if (isBlankRow(raw)) return null;
    const date = typeof raw.recordedAt === 'string' ? raw.recordedAt : '';
    const parsed = providerVitalsSchema.safeParse({ ...raw, recordedAt: date ? `${date}T12:00:00Z` : '',
      edema: '0', orthopnea: 'false', fatigue: '0' });
    if (!parsed.success) {
      results.push({ rowIndex: i, date, success: false, redFlags: [], error: Object.values(parsed.error.flatten().fieldErrors).flat().join(', ') });
      return null;
    }
    const value = parsed.data;
    return { weight: value.weight, weight_unit: value.weightUnit, sbp: value.sbp, dbp: value.dbp,
      heart_rate: value.heartRate, spo2: value.spo2 ?? null, dyspnea: value.dyspnea, recorded_at: value.recordedAt };
  });
  if (results.length || rows.every((row) => row === null)) {
    // Another tab may have committed this prepared identity while this form was
    // being edited. Validation failure says nothing about durable capture state.
    const current = await recoverVitalsBatch(patient.data, batch.data);
    if (current.saved) return { ...current, error: 'An existing saved batch was recovered. The invalid current form values were not saved; review the saved measurements.' };
    if (current.errorKind || current.submissionStatus !== 'prepared') return current;
    return { ...current, results, error: results.length
      ? 'No new rows were saved by this submission. Correct all incomplete rows before retrying this batch.'
      : 'Enter at least one complete reading.' };
  }
  try {
    const { data, error } = await auth.supabase.rpc('submit_vitals_batch', { p_patient_id: patient.data, p_batch_id: batch.data, p_rows: rows });
    if (!error && data) return await readState(patient.data, data);
  } catch { /* Never replay capture under a new identity after an ambiguous response. */ }
  const recovered = await recoverVitalsBatch(patient.data, batch.data);
  if (recovered.errorKind === 'access') return recovered;
  return { ...recovered, batchId: batch.data, error: recovered.saved
    ? 'A saved batch was recovered. Review the saved dates and measurements; changed form values were not saved.'
    : 'Batch save could not be confirmed. Check the saved batch or retry this same batch; do not enter a second copy.' };
}

export async function acknowledgeVitalsBatch(patientId: string, batchId: string, requestIds: string[]): Promise<BatchVitalsActionState> {
  if (!Array.isArray(requestIds) || ![patientId, batchId, ...requestIds].every((id) => uuid.safeParse(id).success)
    || requestIds.length < 1 || requestIds.length > 7 || new Set(requestIds).size !== requestIds.length) return { error: 'Invalid batch receipt' };
  const auth = await authorizeProviderForPatient(patientId);
  if (!auth.authorized) return { error: auth.error, errorKind: 'access' };
  try {
    const { data, error } = await auth.supabase.rpc('acknowledge_vitals_batch', {
      p_patient_id: patientId, p_batch_id: batchId, p_request_ids: requestIds,
    });
    if (!error && data) {
      const receipt = batchSchema.parse(data);
      if (receipt.batch_id === batchId && receipt.submission_status === 'acknowledged') return { batchId, submissionStatus: 'acknowledged' };
    }
  } catch { /* UI retains the original receipt until ACK is confirmed. */ }
  return { error: 'Batch receipt confirmation is pending. Retry before entering another batch.' };
}

export async function cancelVitalsBatch(patientId: string, batchId: string): Promise<BatchVitalsActionState> {
  if (![patientId, batchId].every((id) => uuid.safeParse(id).success)) return { error: 'Invalid batch identity' };
  const auth = await authorizeProviderForPatient(patientId);
  if (!auth.authorized) return { error: auth.error, errorKind: 'access' };
  try {
    const { data, error } = await auth.supabase.rpc('cancel_vitals_batch', { p_patient_id: patientId, p_batch_id: batchId });
    if (!error && data) return await readState(patientId, data);
  } catch { /* Cancellation cannot erase a concurrently committed batch. */ }
  return { error: 'Cancellation is not confirmed. Check the saved batch before switching modes.' };
}
