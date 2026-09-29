/** Effective laboratory report projection; version state is not clinical review. */
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { effectiveLabObservationSchema, getEffectiveLabObservations, selectLatestEffectiveLab, type EffectiveLabObservation } from '@/lib/labs/effective';
import { LAB_OBSERVATION_FIELDS, labCollectionMicros } from '@/lib/labs/quality';
import type { LabResultRow, ReportDateRange } from './types';

const DAY_MS = 86_400_000;
/** Date-only controls select whole UTC calendar days, including the final day. */
export function labDateBounds(range: ReportDateRange) {
  const parseDay = (value: string) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime())
      || date.toISOString().slice(0, 10) !== value) throw new Error('Invalid laboratory date range');
    return date.getTime();
  };
  const from = parseDay(range.from); const to = parseDay(range.to);
  if (from > to || to - from > 366 * DAY_MS) throw new Error('Invalid laboratory date range');
  return { fromInclusive: new Date(from).toISOString(), toExclusive: new Date(to + DAY_MS).toISOString() };
}

/** All effective source heads, not just the latest draw. No superseded amendment rows. */
export function projectLabResults(observations: EffectiveLabObservation[], now = new Date()): LabResultRow[] {
  const sources = z.array(effectiveLabObservationSchema).parse(observations);
  const key = (item: EffectiveLabObservation) => `${item.patient_id.toLowerCase()}|${item.analyte}|${labCollectionMicros(item.collected_at)}`;
  const groups = new Map<string, EffectiveLabObservation[]>();
  for (const item of sources) {
    const group = groups.get(key(item)) ?? []; group.push(item); groups.set(key(item), group);
  }
  const qualities = new Map([...groups].map(([groupKey, items]) =>
    [groupKey, selectLatestEffectiveLab(items, items[0].patient_id, items[0].analyte, now)]));
  return sources.sort((a, b) => {
    const first = labCollectionMicros(a.collected_at)!; const second = labCollectionMicros(b.collected_at)!;
    return first === second ? a.id.localeCompare(b.id) : first > second ? -1 : 1;
  }).map((item) => {
    const quality = qualities.get(key(item))!;
    return {
      id: item.id, patient_id: item.patient_id, test_name: LAB_OBSERVATION_FIELDS[item.analyte].label,
      value: item.value, unit: LAB_OBSERVATION_FIELDS[item.analyte].unit, collected_at: item.collected_at, flag: null,
      source_status: item.status, root_id: item.root_id, version_id: item.version_id, revision: item.revision,
      original_lab_result_id: item.original_lab_result_id, effective_lab_result_id: item.effective_lab_result_id,
      evaluation_status: item.evaluation_status,
      data_quality: quality.state === 'available' ? 'recorded' : quality.state === 'cancelled' ? 'cancelled' : 'invalid',
      quality_reason: quality.reason,
    };
  });
}

/** Signatures cover each <=500-patient scope. Any failed page/scope discards the whole export. */
export async function getReportLabResults(
  supabase: SupabaseClient, patientIds: string[], range: ReportDateRange, expectedActorId: string,
): Promise<LabResultRow[]> {
  z.guid().parse(expectedActorId);
  const scope = [...new Set(z.array(z.guid()).parse(patientIds).map((id) => id.toLowerCase()))].sort();
  const bounds = labDateBounds(range);
  const from = labCollectionMicros(bounds.fromInclusive)!; const until = labCollectionMicros(bounds.toExclusive)!;
  const observations: EffectiveLabObservation[] = [];
  for (let offset = 0; offset < scope.length; offset += 500) {
    observations.push(...await getEffectiveLabObservations(supabase, scope.slice(offset, offset + 500), expectedActorId));
  }
  // Filter only after reading the full composition: a correction can move collection into/out of the range.
  return projectLabResults(observations).filter((row) => {
    const instant = labCollectionMicros(row.collected_at)!;
    return instant >= from && instant < until;
  });
}
