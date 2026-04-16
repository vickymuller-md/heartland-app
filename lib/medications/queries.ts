/**
 * HEARTLAND Medication Tracking -- Supabase Query Helpers
 *
 * Reusable query functions for fetching medication data.
 * Used by Server Components and Server Actions.
 */

import { subDays, format, isAfter, startOfDay } from 'date-fns';
import type { SupabaseClient } from '@supabase/supabase-js';
import { FREQUENCY_DOSES_MAP } from './constants';
import type { MedicationRow, MedicationLog, AdherenceDay } from './types';

/**
 * Get all active medications for a patient.
 * Returns medications ordered by creation date.
 */
export async function getPatientMedications(
  supabase: SupabaseClient,
  patientId: string
): Promise<MedicationRow[]> {
  const { data, error } = await supabase
    .from('medications')
    .select('*')
    .eq('patient_id', patientId)
    .eq('active', true)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data ?? []) as MedicationRow[];
}

/**
 * Get today's dose logs for a patient.
 */
export async function getTodayLogs(
  supabase: SupabaseClient,
  patientId: string,
  date: string
): Promise<MedicationLog[]> {
  const { data, error } = await supabase
    .from('medication_logs')
    .select('*')
    .eq('patient_id', patientId)
    .eq('scheduled_date', date);

  if (error) throw error;
  return (data ?? []) as MedicationLog[];
}

/**
 * Compute the adherence status for a single day.
 * This is a pure function (no DB calls) for testability.
 *
 * @param dateStr - YYYY-MM-DD date to compute
 * @param medications - Active medications for the patient
 * @param logs - Dose logs for this specific date
 * @param now - Current date (for future detection)
 */
export function computeAdherenceDay(
  dateStr: string,
  medications: MedicationRow[],
  logs: MedicationLog[],
  now: Date
): AdherenceDay {
  // Check if date is in the future
  const dayStart = startOfDay(new Date(dateStr + 'T00:00:00'));
  const todayStart = startOfDay(now);
  if (isAfter(dayStart, todayStart)) {
    return { date: dateStr, totalDoses: 0, takenDoses: 0, status: 'future' };
  }

  // Calculate total expected doses from medication frequencies
  const totalDoses = medications.reduce((sum, med) => {
    return sum + (FREQUENCY_DOSES_MAP[med.frequency] ?? 0);
  }, 0);

  // No medications = no_meds
  if (totalDoses === 0) {
    return { date: dateStr, totalDoses: 0, takenDoses: 0, status: 'no_meds' };
  }

  // Count taken doses from logs for this date
  const takenDoses = logs.filter(
    (log) => log.scheduled_date === dateStr && log.taken === true
  ).length;

  // Determine status
  let status: AdherenceDay['status'];
  if (takenDoses >= totalDoses) {
    status = 'complete';
  } else if (takenDoses > 0) {
    status = 'partial';
  } else {
    status = 'missed';
  }

  return { date: dateStr, totalDoses, takenDoses, status };
}

/**
 * Get 30-day adherence data for a patient.
 * Fetches medications and logs, then computes status per day.
 */
export async function getAdherenceData(
  supabase: SupabaseClient,
  patientId: string,
  days: number = 30
): Promise<AdherenceDay[]> {
  const now = new Date();
  const startDate = subDays(now, days - 1);

  // Fetch active medications
  const medications = await getPatientMedications(supabase, patientId);

  // Fetch logs for the date range
  const startStr = format(startDate, 'yyyy-MM-dd');
  const endStr = format(now, 'yyyy-MM-dd');

  const { data: logs, error } = await supabase
    .from('medication_logs')
    .select('*')
    .eq('patient_id', patientId)
    .gte('scheduled_date', startStr)
    .lte('scheduled_date', endStr);

  if (error) throw error;
  const allLogs = (logs ?? []) as MedicationLog[];

  // Compute adherence for each day
  const result: AdherenceDay[] = [];
  for (let i = 0; i < days; i++) {
    const date = subDays(now, days - 1 - i);
    const dateStr = format(date, 'yyyy-MM-dd');
    const dayLogs = allLogs.filter((l) => l.scheduled_date === dateStr);
    result.push(computeAdherenceDay(dateStr, medications, dayLogs, now));
  }

  return result;
}
