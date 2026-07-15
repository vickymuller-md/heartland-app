/**
 * HEARTLAND Patient Today Tasks -- Status Helper
 *
 * Composes existing query functions to produce a single task status
 * object for the Today page checklist (PTUX-03).
 * All four data sources fetched in parallel via Promise.all.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getRecentVitals } from '@/lib/vitals/queries';
import {
  getPatientMedications,
  getTodayLogs,
  computeAdherenceDay,
} from '@/lib/medications/queries';
import { getEducationProgress } from '@/lib/education/queries';
import { DEFAULT_TIME_ZONE, getDateKeyInTimeZone, getZonedDayBounds } from '@/lib/timezone';

export interface TodayTaskStatus {
  vitalsLogged: boolean;
  medsTaken: number;
  medsTotal: number;
  educationRemaining: number;
}

export async function getTodayTaskStatus(
  supabase: SupabaseClient,
  patientId: string,
  timeZone = DEFAULT_TIME_ZONE,
): Promise<TodayTaskStatus> {
  const now = new Date();
  const todayStr = getDateKeyInTimeZone(now, timeZone);
  const dayBounds = getZonedDayBounds(now, timeZone);

  const [recentVitals, medications, todayLogs, educationProgress] =
    await Promise.all([
      getRecentVitals(supabase, patientId, 1),
      getPatientMedications(supabase, patientId),
      getTodayLogs(supabase, patientId, todayStr),
      getEducationProgress(supabase, patientId),
    ]);

  const vitalsLogged = recentVitals.some(
    (v) => v.recorded_at >= dayBounds.start.toISOString()
      && v.recorded_at < dayBounds.endExclusive.toISOString(),
  );

  const adherence = computeAdherenceDay(
    todayStr,
    medications,
    todayLogs,
    now,
  );

  const educationRemaining = educationProgress.filter(
    (p) => !p.completed
  ).length;

  return {
    vitalsLogged,
    medsTaken: adherence.takenDoses,
    medsTotal: adherence.totalDoses,
    educationRemaining,
  };
}
