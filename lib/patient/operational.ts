import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { getPatientWorkItems } from '@/lib/daily-loop/queries';
import type { WorkItem } from '@/lib/daily-loop/types';
import { getEffectiveLabObservations, selectLatestEffectiveLab, type EffectiveLabObservation } from '@/lib/labs/effective';
import { assessEffectiveLab, labCollectionMicros, LAB_ANALYTES, LAB_OBSERVATION_FIELDS, type LabAnalyte, type LabQuality } from '@/lib/labs/quality';

export interface OperationalBrief {
  generatedAt: string;
  sourceDataAsOf: string | null;
  sourceDataStale: boolean;
  latestVitals: {
    recordedAt: string;
    weight: number | null;
    weightDelta: number | null;
    sbp: number | null;
    sbpDelta: number | null;
    heartRate: number | null;
    spo2: number | null;
  } | null;
  latestSymptoms: {
    recordedAt: string;
    dyspnea: number | null;
    edema: number | null;
    orthopnea: boolean | null;
    fatigue: number | null;
    redFlag: boolean | null;
  } | null;
  latestLabs: Record<LabAnalyte, LabQuality> | null;
  labsUnavailable: boolean;
  activeMedicationCount: number;
  openAlertCount: number | null;
  nextWork: WorkItem | null;
  missingData: string[];
}

export interface TimelineEvent {
  id: string;
  occurredAt: string;
  type: 'work' | 'vitals' | 'symptoms' | 'lab' | 'note' | 'message';
  title: string;
  detail: string;
  status?: string;
}

export interface PatientOperationalView {
  brief: OperationalBrief;
  timeline: TimelineEvent[];
  workItems: WorkItem[];
  error: string | null;
}

function numberDelta(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  return Math.round((current - previous) * 10) / 10;
}

/** Compare actual instants, including offset/microseconds; undated evidence goes last. */
function newestSourceFirst(a: string, b: string): number {
  const first = labCollectionMicros(a); const second = labCollectionMicros(b);
  if (first === null) return second === null ? 0 : 1;
  if (second === null) return -1;
  return first === second ? 0 : first > second ? -1 : 1;
}

export async function getPatientOperationalView(
  supabase: SupabaseClient,
  providerId: string,
  patientId: string,
): Promise<PatientOperationalView> {
  const [vitalsResult, symptomsResult, labsResult, medsResult, alertsResult, notesResult, messagesResult, workItemsResult] = await Promise.all([
    supabase
      .from('vitals')
      .select('id, recorded_at, weight_lbs, sbp, heart_rate, spo2')
      .eq('patient_id', patientId)
      .order('recorded_at', { ascending: false })
      .limit(10),
    supabase
      .from('symptoms')
      .select('id, recorded_at, dyspnea, edema, orthopnea, fatigue, red_flag')
      .eq('patient_id', patientId)
      .order('recorded_at', { ascending: false })
      .limit(5),
    getEffectiveLabObservations(supabase, [patientId], providerId)
      .then((data) => ({ data, error: null }))
      .catch(() => ({ data: null, error: 'Current laboratory results unavailable' })),
    supabase
      .from('medications')
      .select('id', { count: 'exact', head: true })
      .eq('patient_id', patientId)
      .eq('active', true),
    supabase
      .from('alerts')
      .select('id', { count: 'exact', head: true })
      .eq('patient_id', patientId)
      .in('status', ['open', 'acknowledged']),
    supabase
      .from('provider_notes')
      .select('id, created_at, content')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false })
      .limit(5),
    supabase
      .from('provider_messages')
      .select('id, created_at, subject, read_at')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false })
      .limit(5),
    getPatientWorkItems(supabase, providerId, patientId),
  ]);
  const workItems = workItemsResult.items;

  const vitals = vitalsResult.data ?? [];
  const latestVital = vitals[0] ?? null;
  const previousVital = vitals[1] ?? null;
  const latestSymptom = symptomsResult.data?.[0] ?? null;
  const laboratoryContext = { id: 'patient-brief-no-recency-rule', now: new Date() };
  const latestLabs = labsResult.data?.length ? {
    potassium: assessEffectiveLab(labsResult.data, patientId, 'potassium', laboratoryContext),
    creatinine: assessEffectiveLab(labsResult.data, patientId, 'creatinine', laboratoryContext),
    egfr: assessEffectiveLab(labsResult.data, patientId, 'egfr', laboratoryContext),
  } : null;
  const priorityRank = { now: 0, today: 1, week: 2, watching: 3 } as const;
  const openWork = workItems
    .filter((item) => item.status !== 'closed')
    .sort((a, b) => {
      const priorityDelta = priorityRank[a.priority] - priorityRank[b.priority];
      if (priorityDelta !== 0) return priorityDelta;
      if (!a.due_at && !b.due_at) return 0;
      if (!a.due_at) return 1;
      if (!b.due_at) return -1;
      return a.due_at.localeCompare(b.due_at);
    });

  const missingData: string[] = [];
  if (vitalsResult.error) missingData.push('Vitals query unavailable');
  else if (!latestVital) missingData.push('No vitals available');
  if (symptomsResult.error) missingData.push('Symptoms query unavailable');
  else if (!latestSymptom) missingData.push('No symptom check-in available');
  if (labsResult.error) missingData.push('Labs query unavailable');
  else if (!latestLabs) missingData.push('No lab result available');
  else for (const key of Object.keys(LAB_ANALYTES) as LabAnalyte[]) {
    const lab = latestLabs[key];
    if (['missing', 'invalid', 'cancelled'].includes(lab.status)) missingData.push(`${LAB_ANALYTES[key].label}: ${lab.reason}`);
  }
  if (medsResult.error) missingData.push('Medication query unavailable');
  else if ((medsResult.count ?? 0) === 0) missingData.push('No active medication list');

  const hasQueryError = Boolean(
    vitalsResult.error || symptomsResult.error || labsResult.error || medsResult.error ||
    alertsResult.error || notesResult.error || messagesResult.error || workItemsResult.error,
  );

  // Group once so a complete multi-page laboratory history does not require quadratic scans.
  const collectionKey = (item: EffectiveLabObservation) => `${item.analyte}|${labCollectionMicros(item.collected_at)}`;
  const collections = new Map<string, EffectiveLabObservation[]>();
  for (const observation of labsResult.data ?? []) {
    const key = collectionKey(observation);
    const group = collections.get(key) ?? [];
    group.push(observation); collections.set(key, group);
  }
  const collectionQuality = new Map([...collections].map(([key, observations]) =>
    [key, selectLatestEffectiveLab(observations, patientId, observations[0].analyte, laboratoryContext.now)]));

  const timeline: TimelineEvent[] = [
    ...workItems.map((item) => ({
      id: `work-${item.id}`,
      occurredAt: item.freshness_at ?? item.created_at,
      type: 'work' as const,
      title: item.title,
      detail: item.reason,
      status: item.status,
    })),
    ...vitals.slice(0, 5).map((vital) => ({
      id: `vital-${vital.id}`,
      occurredAt: vital.recorded_at,
      type: 'vitals' as const,
      title: 'Vitals recorded',
      detail: `Weight ${vital.weight_lbs ?? '—'} lb · BP ${vital.sbp ?? '—'} · HR ${vital.heart_rate ?? '—'} · SpO₂ ${vital.spo2 ?? '—'}`,
    })),
    ...(symptomsResult.data ?? []).map((symptom) => ({
      id: `symptom-${symptom.id}`,
      occurredAt: symptom.recorded_at,
      type: 'symptoms' as const,
      title: symptom.red_flag ? 'Symptoms recorded · flagged' : symptom.red_flag === null ? 'Symptoms recorded · evaluation pending' : 'Symptoms recorded',
      detail: `Dyspnea ${symptom.dyspnea ?? '—'} · Edema ${symptom.edema ?? '—'} · Fatigue ${symptom.fatigue ?? '—'}`,
    })),
    ...(labsResult.data ?? []).map((observation) => {
      const quality = collectionQuality.get(collectionKey(observation))!;
      const invalid = quality.state === 'invalid';
      return {
      id: `lab-${observation.id}`,
      occurredAt: observation.collected_at,
      type: 'lab' as const,
      title: `${LAB_OBSERVATION_FIELDS[observation.analyte].label} source · ${observation.status}${invalid ? ' · invalid — verify source' : ''}`,
      detail: (invalid ? `${quality.reason} Recorded source value (not usable): ` : '')
        + `${observation.value ?? 'No current value'} ${observation.value === null ? '' : LAB_OBSERVATION_FIELDS[observation.analyte].unit}`
        + ` · ${observation.revision ? `revision ${observation.revision}` : 'authority not registered'}`
        + ` · documented collection, not correction-processing time${observation.evaluation_status === 'pending' ? ' · alert processing pending' : ''}`
        + ' · no clinical review or human communication inferred',
      status: invalid ? 'invalid' : observation.status,
    }; }),
    ...(notesResult.data ?? []).map((note) => ({
      id: `note-${note.id}`,
      occurredAt: note.created_at,
      type: 'note' as const,
      title: 'Provider note',
      detail: note.content,
    })),
    ...(messagesResult.data ?? []).map((message) => ({
      id: `message-${message.id}`,
      occurredAt: message.created_at,
      type: 'message' as const,
      title: `Message: ${message.subject}`,
      detail: message.read_at ? 'Read by patient' : 'Awaiting patient read receipt',
      status: message.read_at ? 'read' : 'unread',
    })),
  ].sort((a, b) => newestSourceFirst(a.occurredAt, b.occurredAt)).slice(0, 30);

  const generatedAt = new Date();
  const sourceDataAsOf = [
    latestVital?.recorded_at,
    latestSymptom?.recorded_at,
    ...Object.values(latestLabs ?? {}).filter((lab) => !['cancelled', 'invalid', 'missing'].includes(lab.status))
      .map((lab) => lab.collectedAt),
  ].filter((value): value is string => Boolean(value) && labCollectionMicros(value!) !== null)
    .sort(newestSourceFirst)[0] ?? null;

  return {
    brief: {
      generatedAt: generatedAt.toISOString(),
      sourceDataAsOf,
      sourceDataStale: sourceDataAsOf
        ? generatedAt.getTime() - new Date(sourceDataAsOf).getTime() > 7 * 86_400_000
        : false,
      latestVitals: latestVital ? {
        recordedAt: latestVital.recorded_at,
        weight: latestVital.weight_lbs,
        weightDelta: numberDelta(latestVital.weight_lbs, previousVital?.weight_lbs ?? null),
        sbp: latestVital.sbp,
        sbpDelta: numberDelta(latestVital.sbp, previousVital?.sbp ?? null),
        heartRate: latestVital.heart_rate,
        spo2: latestVital.spo2,
      } : null,
      latestSymptoms: latestSymptom ? {
        recordedAt: latestSymptom.recorded_at,
        dyspnea: latestSymptom.dyspnea,
        edema: latestSymptom.edema,
        orthopnea: latestSymptom.orthopnea,
        fatigue: latestSymptom.fatigue,
        redFlag: latestSymptom.red_flag,
      } : null,
      latestLabs,
      labsUnavailable: Boolean(labsResult.error),
      activeMedicationCount: medsResult.error ? 0 : (medsResult.count ?? 0),
      openAlertCount: alertsResult.error ? null : (alertsResult.count ?? 0),
      nextWork: openWork[0] ?? null,
      missingData,
    },
    timeline,
    workItems,
    error: hasQueryError
      ? 'One or more patient-record queries failed. The brief and timeline may be incomplete; verify source records before acting.'
      : null,
  };
}
