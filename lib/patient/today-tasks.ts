/**
 * HEARTLAND Patient Today Tasks -- Status Helper
 *
 * Composes existing query functions to produce a single task status
 * object for the Today page checklist (PTUX-03).
 * All four data sources fetched in parallel via Promise.all.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { hasVitalWithinDay } from '@/lib/vitals/queries';
import { getAdherenceForRange } from '@/lib/medications/queries';
import type { MedicationCalendar } from '@/lib/medications/calendar';
import { getEducationSummary } from '@/lib/education/queries';
import { DEFAULT_TIME_ZONE, getDateKeyInTimeZone, getZonedDayBounds } from '@/lib/timezone';

export interface TodayTaskStatus {
  vitalsLogged: boolean;
  medsTaken: number;
  medsTotal: number;
  medsScheduleUnconfirmed?: boolean;
  educationRemaining: number;
}

export async function getTodayTaskStatus(
  supabase: SupabaseClient,
  patientId: string,
  timeZone = DEFAULT_TIME_ZONE,
  calendar?: MedicationCalendar,
): Promise<TodayTaskStatus> {
  const now = new Date();
  const todayStr = calendar?.day ?? getDateKeyInTimeZone(now, timeZone);
  const dayBounds = calendar ? { start: new Date(calendar.day_bounds.start_at), endExclusive: new Date(calendar.day_bounds.end_at) }
    : getZonedDayBounds(now, timeZone);

  const [vitalsLogged, [adherence], education] =
    await Promise.all([
      hasVitalWithinDay(supabase, patientId, dayBounds.start, dayBounds.endExclusive),
      getAdherenceForRange(supabase, patientId, todayStr, todayStr, calendar ?? timeZone),
      getEducationSummary(supabase, patientId),
    ]);

  const educationRemaining = education.totalDomains - education.completedDomains;

  return {
    vitalsLogged,
    medsTaken: adherence.takenDoses,
    medsTotal: adherence.totalDoses,
    medsScheduleUnconfirmed: adherence.status === 'unconfirmed',
    educationRemaining,
  };
}
