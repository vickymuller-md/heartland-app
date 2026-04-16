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

/** Number of days after which a titration is considered due. */
const TITRATION_DUE_DAYS = 7;

/** Number of days after which K+/Cr labs are considered stale. */
const LAB_STALE_DAYS = 14;

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
  return differenceInDays(new Date(), parseISO(lastTitrationAt)) >= TITRATION_DUE_DAYS;
}

/**
 * Pure function -- exported for unit testing.
 * Returns true if labs collected_at is strictly > LAB_STALE_DAYS ago.
 * Returns false if collected_at is null (no labs fetched -- no warning shown).
 */
export function isLabStale(collectedAt: string | null): boolean {
  if (!collectedAt) return false;
  return differenceInDays(new Date(), parseISO(collectedAt)) > LAB_STALE_DAYS;
}

export interface TitrationWorklistRow {
  patient_id: string;
  full_name: string;
  risk_tier: string | null;
  last_sbp: number | null;
  last_k: number | null;
  last_cr: number | null;
  last_labs_at: string | null;
  last_titration_at: string | null;
  due_this_week: boolean;
}

/**
 * Batch query for the titration worklist page.
 * Returns all linked patients with their latest lab values and titration status.
 * Follows the batch-fetch + Map-join pattern from lib/dashboard/queries.ts.
 * Returns only patients due for titration, sorted: due-first, then by oldest labs.
 */
export async function getTitrationWorklist(
  supabase: SupabaseClient,
  providerId: string
): Promise<TitrationWorklistRow[]> {
  // 1. Get linked patient IDs
  const { data: links } = await supabase
    .from('provider_patient_links')
    .select('patient_id')
    .eq('provider_id', providerId)
    .eq('status', 'active');

  if (!links || links.length === 0) return [];
  const patientIds = links.map((l: { patient_id: string }) => l.patient_id);

  // 2. Batch fetch patient profiles
  const { data: patients } = await supabase
    .from('patients')
    .select('id, full_name, risk_tier')
    .in('id', patientIds);

  if (!patients || patients.length === 0) return [];

  // 3. Batch fetch latest lab results per patient (K+, Cr, collected_at)
  const { data: labs } = await supabase
    .from('lab_results')
    .select('patient_id, potassium, creatinine, collected_at')
    .in('patient_id', patientIds)
    .order('collected_at', { ascending: false });

  // 4. Batch fetch latest vitals per patient (SBP)
  const { data: vitals } = await supabase
    .from('vitals')
    .select('patient_id, sbp, recorded_at')
    .in('patient_id', patientIds)
    .order('recorded_at', { ascending: false });

  // 5. Batch fetch latest titration note per patient
  const { data: notes } = await supabase
    .from('provider_notes')
    .select('patient_id, created_at')
    .in('patient_id', patientIds)
    .ilike('content', '[TITRATION CHECKLIST%')
    .order('created_at', { ascending: false });

  // Build Maps for O(1) lookup (batch pattern from getLinkedPatients)
  type LabRow = { patient_id: string; potassium: number | null; creatinine: number | null; collected_at: string };
  const labMap = new Map<string, LabRow>();
  ((labs ?? []) as LabRow[]).forEach((l) => {
    if (!labMap.has(l.patient_id)) labMap.set(l.patient_id, l);
  });

  type VitalRow = { patient_id: string; sbp: number | null; recorded_at: string };
  const vitalsMap = new Map<string, VitalRow>();
  ((vitals ?? []) as VitalRow[]).forEach((v) => {
    if (!vitalsMap.has(v.patient_id)) vitalsMap.set(v.patient_id, v);
  });

  type NoteRow = { patient_id: string; created_at: string };
  const notesMap = new Map<string, NoteRow>();
  ((notes ?? []) as NoteRow[]).forEach((n) => {
    if (!notesMap.has(n.patient_id)) notesMap.set(n.patient_id, n);
  });

  // 6. Build worklist rows
  type PatientRow = { id: string; full_name: string | null; risk_tier: string | null };
  const rows: TitrationWorklistRow[] = ((patients ?? []) as PatientRow[]).map((p) => {
    const lab = labMap.get(p.id) ?? null;
    const vital = vitalsMap.get(p.id) ?? null;
    const note = notesMap.get(p.id) ?? null;
    const lastTitrationAt = note?.created_at ?? null;

    return {
      patient_id: p.id,
      full_name: p.full_name ?? 'Unknown',
      risk_tier: p.risk_tier,
      last_sbp: vital?.sbp ?? null,
      last_k: lab?.potassium ?? null,
      last_cr: lab?.creatinine ?? null,
      last_labs_at: lab?.collected_at ?? null,
      last_titration_at: lastTitrationAt,
      due_this_week: isDueTitration(lastTitrationAt),
    };
  });

  // Filter to due-only, sort: oldest labs first (patients with no labs come last)
  return rows
    .filter((r) => r.due_this_week)
    .sort((a, b) => {
      if (!a.last_labs_at && b.last_labs_at) return 1;
      if (a.last_labs_at && !b.last_labs_at) return -1;
      if (!a.last_labs_at || !b.last_labs_at) return 0;
      return a.last_labs_at.localeCompare(b.last_labs_at); // oldest first
    });
}
