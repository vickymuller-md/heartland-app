import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_TIME_ZONE, getDateKeyInTimeZone } from '@/lib/timezone';
import { adherenceFromSchedules, medicationFrequency, medicationTiming, type MedicationSchedule } from './schedule';
import { calendarSourceOnDay, medicationCalendarSchema, shiftMedicationDay, type MedicationCalendar } from './calendar';
import type { MedicationRow, MedicationLog, AdherenceDay } from './types';

export async function getPatientMedicationCalendar(supabase: SupabaseClient, patientId: string, from?: string, to?: string): Promise<MedicationCalendar> {
  const { data, error } = await supabase.rpc('get_patient_medication_calendar', { p_patient: patientId, p_from: from ?? null, p_to: to ?? null });
  const result = medicationCalendarSchema.safeParse(data);
  if (error || !result.success) throw new Error('Medication calendar unavailable');
  return result.data;
}

export async function getPatientMedications(supabase: SupabaseClient, patientId: string): Promise<MedicationRow[]> {
  const { data, error } = await supabase.from('medications').select('*')
    .eq('patient_id', patientId).eq('active', true).order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(row => ({
    ...row, dosage: row.dosage ?? '', frequency: medicationFrequency(row.frequency) ?? row.frequency ?? '',
    timing: medicationTiming(row.timing),
  }));
}

/** Page across the server's row limit. History is scoped by the same RLS as its source. */
export async function getMedicationScheduleHistory(supabase: SupabaseClient, patientIds: string[], from: string, to: string): Promise<MedicationSchedule[]> {
  if (!patientIds.length) return [];
  if (![from, to].every(validDay) || from > to) throw new Error('Invalid medication history dates');
  if (patientIds.length > 75) {
    const combined: MedicationSchedule[] = [];
    for (let index = 0; index < patientIds.length; index += 75) {
      combined.push(...await getMedicationScheduleHistory(supabase, patientIds.slice(index, index + 75), from, to));
    }
    return combined;
  }
  const history: MedicationSchedule[] = [];
  let cursor: string | null = null;
  for (;;) {
    let query = supabase.from('medication_schedule_versions')
      .select('id,medication_id,patient_id,starts_on,ends_before,known,active,name,dosage,frequency,timing,weekly_day')
      .in('patient_id', patientIds).lte('starts_on', to).or('ends_before.is.null,ends_before.gt.' + from)
      .order('id').limit(250);
    if (cursor) query = query.gt('id', cursor);
    const { data, error } = await query;
    if (error) throw error;
    if (!data) throw new Error('Medication history unavailable');
    history.push(...data);
    if (data.length < 250) return history;
    cursor = data[data.length - 1].id;
  }
}

async function getDoseLogs(supabase: SupabaseClient, patientId: string, from: string, to: string): Promise<MedicationLog[]> {
  const rows: MedicationLog[] = [];
  let cursor: string | null = null;
  for (;;) {
    let query = supabase.from('medication_logs').select('*').eq('patient_id', patientId)
      .gte('scheduled_date', from).lte('scheduled_date', to).order('id').limit(250);
    if (cursor) query = query.gt('id', cursor);
    const { data, error } = await query;
    if (error) throw error;
    if (!data) throw new Error('Dose records unavailable');
    rows.push(...data);
    if (data.length < 250) return rows;
    cursor = data[data.length - 1].id;
  }
}

export function getTodayLogs(supabase: SupabaseClient, patientId: string, day: string): Promise<MedicationLog[]> {
  return getDoseLogs(supabase, patientId, day, day);
}

/** Legacy pure caller: a creation date is the earliest possible start. Historical screens use dated versions. */
export function computeAdherenceDay(date: string, medications: MedicationRow[], logs: MedicationLog[], now: Date, timeZone = DEFAULT_TIME_ZONE): AdherenceDay {
  const rows = medications.map(med => ({
    medication_id: med.id, starts_on: med.created_at && Number.isFinite(Date.parse(med.created_at)) ? getDateKeyInTimeZone(new Date(med.created_at), timeZone) : '-infinity', ends_before: null,
    known: !!med.created_at && Number.isFinite(Date.parse(med.created_at)), active: med.active, frequency: med.frequency, weekly_day: med.weekly_day ?? null,
  }));
  return adherenceFromSchedules(date, rows, logs, getDateKeyInTimeZone(now, timeZone));
}

function validDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

export async function getAdherenceForRange(supabase: SupabaseClient, patientId: string, from: string, to: string, calendar?: MedicationCalendar | string): Promise<AdherenceDay[]> {
  const datesValid = [from, to].every(validDay);
  if (!datesValid || from > to || Date.parse(to) - Date.parse(from) > 366 * 86400000) throw new Error('Invalid medication date range');
  const [history, logs, current] = await Promise.all([
    getMedicationScheduleHistory(supabase, [patientId], from, to), getDoseLogs(supabase, patientId, from, to),
    calendar && typeof calendar !== 'string' ? calendar : getPatientMedicationCalendar(supabase, patientId, from, to),
  ]);
  const days: AdherenceDay[] = [];
  for (let day = from; day <= to; day = shiftMedicationDay(day, 1)) {
    const evidence = adherenceFromSchedules(day, history, logs, current.day);
    if (current.unclassified_dates.includes(day)) {
      evidence.status = 'unconfirmed';
      evidence.totalDoses = 0;
      evidence.takenDoses = 0;
    }
    days.push({ ...evidence, calendarSource: calendarSourceOnDay(current, day, logs) });
  }
  return days;
}

export async function getAdherenceData(supabase: SupabaseClient, patientId: string, days = 30, calendar?: MedicationCalendar): Promise<AdherenceDay[]> {
  const current = calendar ?? await getPatientMedicationCalendar(supabase, patientId);
  return getAdherenceForRange(supabase, patientId, shiftMedicationDay(current.day, 1 - days), current.day, days <= 30 ? current : undefined);
}
