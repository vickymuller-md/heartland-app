/**
 * HEARTLAND Provider Dashboard -- Titration Worklist Queries
 *
 * Server-side data layer for the titration worklist page (EFFI-03).
 * Pure helper functions are exported for unit testing.
 *
 * Requirements: EFFI-03 (titration worklist), EFFI-04 (lab staleness)
 */

import { differenceInDays, parseISO } from 'date-fns';
import type { SupabaseClient } from '@supabase/supabase-js';
import { assessEffectiveLab, labAttentionRank, worklistLabContext, type LabQuality } from '@/lib/labs/quality';
import { getEffectiveLabObservations, type EffectiveLabObservation } from '@/lib/labs/effective';

/** Number of days after which a titration is considered due. */
const TITRATION_DUE_DAYS = 7;

/**
 * Pure function -- exported for unit testing.
 * Returns true if the patient is due for titration:
 * - Never had a titration note, OR
 * - Last titration note >= TITRATION_DUE_DAYS ago.
 *
 * Note: titration notes before Phase 12 may not have the [TITRATION CHECKLIST prefix.
 * "Never titrated" is a safe advisory proxy for "due." The worklist is advisory, not authoritative.
 */
export function isDueTitration(lastTitrationAt: string | null): boolean {
  if (!lastTitrationAt) return true;
  const timestamp = Date.parse(lastTitrationAt);
  if (!Number.isFinite(timestamp) || timestamp > Date.now()) return true;
  return differenceInDays(new Date(), parseISO(lastTitrationAt)) >= TITRATION_DUE_DAYS;
}

/**
 * Pure function -- exported for unit testing.
 * Returns true if labs collected_at is strictly > LAB_STALE_DAYS ago.
 * Returns false if collected_at is null (no labs fetched -- no warning shown).
 */
export function isLabStale(collectedAt: string | null): boolean {
  if (!collectedAt) return false;
  return worklistLabContext().isStale!(collectedAt);
}

export interface TitrationWorklistRow {
  patient_id: string;
  full_name: string;
  risk_tier: string | null;
  last_sbp: number | null;
  labs: { potassium: LabQuality; creatinine: LabQuality; egfr: LabQuality };
  last_titration_at: string | null;
  due_this_week: boolean;
}

/** Continue through short pages too; PostgREST may impose a lower server-side cap. */
async function readPages<T extends { id: string }>(
  query: (cursor: string | null) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | null = null;
  for (;;) {
    const { data, error } = await query(cursor);
    if (error || !Array.isArray(data)) throw new Error('Worklist data could not be verified.');
    if (data.length === 0) return rows;
    const page = data as T[];
    for (const row of page) {
      if (!row.id || (cursor && row.id <= cursor)) throw new Error('Worklist pagination did not advance.');
      cursor = row.id;
    }
    rows.push(...page);
  }
}

/**
 * Batch query for the titration worklist page.
 * Returns all linked patients with their latest lab values and titration status.
 * Follows the batch-fetch + Map-join pattern from lib/dashboard/queries.ts.
 * Returns due patients, with missing/invalid analytes first, then stale data.
 * Laboratory pages share a signature within each <=500-patient scope, not across scopes.
 * Other queries retain their own read snapshots. Any failed scope rejects the whole worklist.
 */
export async function getTitrationWorklist(
  supabase: SupabaseClient,
  providerId: string
): Promise<TitrationWorklistRow[]> {
  // 1. Get linked patient IDs
  const links = await readPages<{ id: string; patient_id: string }>((cursor) => {
    let query = supabase
    .from('provider_patient_links')
    .select('id, patient_id')
    .eq('provider_id', providerId)
    .eq('status', 'active').order('id').limit(500);
    if (cursor) query = query.gt('id', cursor);
    return query;
  });

  if (!links || links.length === 0) return [];
  const patientIds = [...new Set(links.map((l) => l.patient_id))];

  // 2. Batch fetch patient profiles
  type PatientRow = {
    id: string;
    risk_tier: string | null;
    profiles: { full_name?: string | null } | { full_name?: string | null }[] | null;
  };
  const patients = await readPages<PatientRow>((cursor) => {
    let query = supabase
    .from('patients')
    .select('id, risk_tier, profiles!patients_id_fkey(full_name)')
    .in('id', patientIds).order('id').limit(500);
    if (cursor) query = query.gt('id', cursor);
    return query;
  });

  if (!patients || patients.length === 0) return [];

  // 3. Read the complete effective observation set; failures never fall back to raw panels.
  const labs: EffectiveLabObservation[] = [];
  for (let offset = 0; offset < patientIds.length; offset += 500) {
    labs.push(...await getEffectiveLabObservations(supabase, patientIds.slice(offset, offset + 500), providerId));
  }

  // 4. Batch fetch latest vitals per patient (SBP)
  type VitalRow = { id: string; patient_id: string; sbp: number | null; recorded_at: string };
  const vitals = await readPages<VitalRow>((cursor) => {
    let query = supabase
    .from('vitals')
    .select('id, patient_id, sbp, recorded_at')
    .in('patient_id', patientIds)
    .order('id').limit(500);
    if (cursor) query = query.gt('id', cursor);
    return query;
  });

  // 5. Batch fetch latest titration note per patient
  type NoteRow = { id: string; patient_id: string; created_at: string };
  const notes = await readPages<NoteRow>((cursor) => {
    let query = supabase
    .from('provider_notes')
    .select('id, patient_id, created_at')
    .in('patient_id', patientIds)
    .ilike('content', '[TITRATION CHECKLIST%')
    .order('id').limit(500);
    if (cursor) query = query.gt('id', cursor);
    return query;
  });

  // Build Maps for O(1) lookup (batch pattern from getLinkedPatients)
  const labMap = new Map<string, EffectiveLabObservation[]>();
  labs.forEach((l) => {
    const bucket = labMap.get(l.patient_id) ?? [];
    bucket.push(l);
    labMap.set(l.patient_id, bucket);
  });

  const vitalsMap = new Map<string, VitalRow>();
  vitals.forEach((v) => {
    const previous = vitalsMap.get(v.patient_id);
    if (!previous || Date.parse(v.recorded_at) > Date.parse(previous.recorded_at)) vitalsMap.set(v.patient_id, v);
  });

  const notesMap = new Map<string, NoteRow>();
  notes.forEach((n) => {
    const previous = notesMap.get(n.patient_id);
    if (!previous || Date.parse(n.created_at) > Date.parse(previous.created_at)) notesMap.set(n.patient_id, n);
  });

  // 6. Build worklist rows
  const context = worklistLabContext();
  const rows: TitrationWorklistRow[] = ((patients ?? []) as PatientRow[]).map((p) => {
    const patientLabs = labMap.get(p.id) ?? [];
    const vital = vitalsMap.get(p.id) ?? null;
    const note = notesMap.get(p.id) ?? null;
    const lastTitrationAt = note?.created_at ?? null;

    return {
      patient_id: p.id,
      full_name: (Array.isArray(p.profiles) ? p.profiles[0]?.full_name : p.profiles?.full_name) ?? 'Unknown',
      risk_tier: p.risk_tier,
      last_sbp: vital?.sbp ?? null,
      labs: {
        potassium: assessEffectiveLab(patientLabs, p.id, 'potassium', context),
        creatinine: assessEffectiveLab(patientLabs, p.id, 'creatinine', context),
        egfr: assessEffectiveLab(patientLabs, p.id, 'egfr', context),
      },
      last_titration_at: lastTitrationAt,
      due_this_week: isDueTitration(lastTitrationAt),
    };
  });

  // Data attention only, not a clinical severity/response-time policy.
  return rows
    .filter((r) => r.due_this_week)
    .sort((a, b) => {
      const quality = labAttentionRank(Object.values(a.labs)) - labAttentionRank(Object.values(b.labs));
      if (quality) return quality;
      const oldest = (row: TitrationWorklistRow) => Math.min(...Object.values(row.labs)
        .map((lab) => lab.collectedAt ? Date.parse(lab.collectedAt) : -Infinity));
      return oldest(a) - oldest(b) || a.patient_id.localeCompare(b.patient_id);
    });
}
