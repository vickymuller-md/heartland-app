'use server';

import { z } from 'zod';
import { authorize, authorizeProviderForPatient, type AuthorizationResult } from '@/lib/auth/authorization';
import { providerVitalsSchema, vitalsSchema } from './schema';
import { evaluateCapturedVitals, evaluateCapturedBatchVitals, IncompleteVitalsHistoryError, VITALS_RULE_VERSION, BATCH_VITALS_RULE_VERSION } from './receipt-evaluation';
import type { VitalsActionState } from './types';
import { snapshotSchema, stateFromSnapshot } from './submission-receipt';

type Authorized = Extract<AuthorizationResult, { authorized: true }>;
const uuid = z.string().uuid();

async function authorizeSubmission(patientId?: string): Promise<AuthorizationResult> {
  if (patientId !== undefined) {
    if (!uuid.safeParse(patientId).success) return { authorized: false, error: 'Unauthorized' };
    return authorizeProviderForPatient(patientId);
  }
  return authorize('patient');
}

async function settleSnapshot(auth: Authorized, raw: unknown): Promise<VitalsActionState> {
  const receipt = snapshotSchema.parse(raw);
  const state = stateFromSnapshot(receipt);
  if (!state.saved || state.success) return state;
  try {
    // RLS rechecks current actor-owned access. Never accept browser history/flags.
    const { data, error } = await auth.supabase.from('vitals_submission_receipts')
      .select('context_version,captured_at,observation,history').eq('request_id', receipt.request_id).single();
    if (error || !data) return state;
    let ruleVersion = VITALS_RULE_VERSION;
    if (receipt.submission_status === 'batched') {
      const mapping = await auth.supabase.from('vitals_submission_batch_rows').select('history').eq('request_id', receipt.request_id).single();
      if (mapping.error || !mapping.data) return state;
      state.redFlags = evaluateCapturedBatchVitals(data, mapping.data.history);
      ruleVersion = BATCH_VITALS_RULE_VERSION;
    } else state.redFlags = evaluateCapturedVitals(data);
    const { supabaseAdmin } = await import('@/lib/supabase/admin');
    const { data: evaluation, error: processingError } = await supabaseAdmin.rpc('finalize_vitals_submission_evaluation', {
      p_request_id: receipt.request_id, p_actor_id: auth.user.id,
      p_rule_version: ruleVersion, p_flags: state.redFlags.map((flag) => flag.id),
    });
    if (processingError || evaluation?.status !== 'complete') {
      state.evaluationStatus = evaluation?.status === 'failed' ? 'failed' : 'pending';
      return state;
    }
    // Use the authorized readback, not service data, for any client response.
    const patientId = receipt.observation!.vitals.patient_id;
    const readback = await auth.supabase.rpc('get_vitals_submission', {
      p_patient_id: patientId, p_request_id: receipt.request_id,
    });
    if (readback.error || !readback.data) return state;
    return stateFromSnapshot(snapshotSchema.parse(readback.data));
  } catch (error) {
    // Lost responses or malformed context cannot become a second capture or a normal result.
    if (error instanceof IncompleteVitalsHistoryError) state.redFlags = error.observedFlags;
    return state;
  }
}

export async function recoverVitalsSubmission(patientId?: string, requestId?: string): Promise<VitalsActionState> {
  const auth = await authorizeSubmission(patientId);
  if (!auth.authorized) return { error: auth.error, errorKind: 'access' };
  if (requestId !== undefined && !uuid.safeParse(requestId).success) return { error: 'Invalid submission ID' };
  try {
    const { data, error } = await auth.supabase.rpc('get_vitals_submission', {
      p_patient_id: patientId ?? auth.user.id, p_request_id: requestId ?? null,
    });
    if (error) return { error: 'Could not check the saved record. Reconnect and retry before creating another entry.',
      errorKind: error.code === '42501' ? 'access' : 'unavailable' };
    if (!data && requestId) return { error: 'This saved record is no longer accessible. Sign in and verify access before continuing.', errorKind: 'access' };
    if (data?.mode === 'batch' && uuid.safeParse(data.batch_id).success) return {
      activeBatchId: data.batch_id, error: 'A 7-day batch is already active. Open Batch Entry to recover or cancel it before saving an individual reading.',
    };
    return data ? await settleSnapshot(auth, data) : {};
  } catch {
    return { error: 'Could not check the saved record. Reconnect and retry before creating another entry.', errorKind: 'unavailable' };
  }
}

export async function prepareVitalsSubmission(patientId?: string): Promise<VitalsActionState> {
  const auth = await authorizeSubmission(patientId);
  if (!auth.authorized) return { error: auth.error };
  try {
    const { data, error } = await auth.supabase.rpc('prepare_vitals_submission', { p_patient_id: patientId ?? auth.user.id });
    if (error || !data) return { error: 'Could not prepare this entry. Reconnect and retry.' };
    return await settleSnapshot(auth, data);
  } catch { return { error: 'Could not prepare this entry. Reconnect and retry.' }; }
}

export async function cancelVitalsSubmission(requestId: string, patientId?: string): Promise<VitalsActionState> {
  const auth = await authorizeSubmission(patientId);
  if (!auth.authorized) return { error: auth.error, errorKind: 'access' };
  if (!uuid.safeParse(requestId).success) return { error: 'Invalid entry ID' };
  try {
    const { data, error } = await auth.supabase.rpc('cancel_vitals_submission', {
      p_patient_id: patientId ?? auth.user.id, p_request_id: requestId,
    });
    if (error || !data) return { error: 'Cancellation is not confirmed. Check the saved record before switching modes.' };
    return await settleSnapshot(auth, data);
  } catch { return { error: 'Cancellation is not confirmed. Check the saved record before switching modes.' }; }
}

async function capture(formData: FormData, patientId?: string): Promise<VitalsActionState> {
  const auth = await authorizeSubmission(patientId);
  if (!auth.authorized) return { error: auth.error };
  const request = uuid.safeParse(formData.get('requestId'));
  if (!request.success) return { error: 'Prepare or recover this entry before saving.' };
  const parsed = (patientId ? providerVitalsSchema : vitalsSchema).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { requestId: request.data, errors: parsed.error.flatten().fieldErrors };
  const value = parsed.data;
  try {
    const { data, error } = await auth.supabase.rpc('submit_vitals_submission', {
      p_patient_id: patientId ?? auth.user.id, p_request_id: request.data,
      p_weight: value.weight, p_weight_unit: value.weightUnit, p_sbp: value.sbp, p_dbp: value.dbp,
      p_heart_rate: value.heartRate, p_spo2: value.spo2 ?? null, p_dyspnea: value.dyspnea,
      p_edema: value.edema, p_orthopnea: value.orthopnea, p_fatigue: value.fatigue,
      p_recorded_at: 'recordedAt' in value ? value.recordedAt ?? null : null,
    });
    if (!error && data) return await settleSnapshot(auth, data);
  } catch { /* Recovery below resolves an ambiguous commit without submitting new rows. */ }
  const recovered = await recoverVitalsSubmission(patientId, request.data);
  return { ...recovered, requestId: request.data,
    error: recovered.saved
      ? 'A saved entry was recovered. Review it before starting another reading; changed form values were not saved.'
      : 'Save could not be confirmed. Retry this entry; do not start a new one.' };
}

export async function submitCapturedVitals(_previous: VitalsActionState | null, formData: FormData): Promise<VitalsActionState> {
  return capture(formData);
}

export async function submitCapturedProviderVitals(_previous: VitalsActionState | null, formData: FormData): Promise<VitalsActionState> {
  const patientId = formData.get('patientId');
  if (typeof patientId !== 'string' || !uuid.safeParse(patientId).success) return { error: 'Invalid patient ID' };
  return capture(formData, patientId);
}

export async function acknowledgeVitalsSubmission(requestId: string, vitalsId: string, symptomsId: string,
  patientId?: string): Promise<VitalsActionState> {
  const auth = await authorizeSubmission(patientId);
  if (!auth.authorized) return { error: auth.error };
  if (![requestId, vitalsId, symptomsId].every((id) => uuid.safeParse(id).success)) return { error: 'Invalid receipt' };
  try {
    const { data, error } = await auth.supabase.rpc('acknowledge_vitals_submission', {
      p_patient_id: patientId ?? auth.user.id, p_request_id: requestId, p_vitals_id: vitalsId, p_symptoms_id: symptomsId,
    });
    if (error || !data) return { error: 'Could not confirm receipt. Retry before starting another entry.' };
    return stateFromSnapshot(snapshotSchema.parse(data));
  } catch { return { error: 'Could not confirm receipt. Retry before starting another entry.' }; }
}

export async function listPendingVitalsSubmissions(patientId?: string, offset = 0): Promise<{
  total?: number; receipts?: VitalsActionState[]; error?: string;
}> {
  const auth = await authorizeSubmission(patientId);
  if (!auth.authorized) return { error: auth.error };
  if (!Number.isSafeInteger(offset) || offset < 0) return { error: 'Invalid pending page' };
  try {
    const { data, error } = await auth.supabase.rpc('list_pending_vitals_submissions', {
      p_patient_id: patientId ?? auth.user.id, p_offset: offset,
    });
    if (error || !data || !Number.isInteger(data.total) || data.total < 0 || !Array.isArray(data.receipts)) {
      return { error: 'Could not load pending evaluations. Reconnect and retry.' };
    }
    return { total: data.total, receipts: data.receipts.map((raw: unknown) => stateFromSnapshot(snapshotSchema.parse(raw))) };
  } catch { return { error: 'Could not load pending evaluations. Reconnect and retry.' }; }
}
