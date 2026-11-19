import { z } from 'zod';
import { isValidTimeZone } from '@/lib/timezone';

const zone = z.string().refine(isValidTimeZone);
const source = z.enum(['patient', 'care_team', 'default']);
export const medicationCalendarSchema = z.object({
  zone, source, day: z.iso.date(), revision: z.uuid(),
  pending_zone: zone.nullable(), pending_at: z.iso.datetime({ offset: true }).nullable(),
  day_bounds: z.object({ start_at: z.iso.datetime({offset:true}), end_at: z.iso.datetime({offset:true}) }),
  unclassified_dates: z.array(z.iso.date()),
  history: z.array(z.object({
    first_day: z.iso.date(), previous_day: z.iso.date().nullable(), zone, source, recorded_at: z.iso.datetime({ offset: true }),
  })),
});
export type MedicationCalendar = z.infer<typeof medicationCalendarSchema>;
export type CalendarSource = MedicationCalendar['source'] | 'legacy' | 'multiple';

export const CALENDAR_SOURCE_LABEL: Record<CalendarSource, string> = {
  patient: 'Patient-selected time zone',
  care_team: 'Time zone from the care team',
  default: 'Default time zone',
  legacy: 'Time zone was not recorded',
  multiple: 'Multiple calendar sources on this date',
};

export function shiftMedicationDay(day: string, offset: number) {
  const target = new Date(day + 'T12:00:00Z');
  target.setUTCDate(target.getUTCDate() + offset);
  return target.toISOString().slice(0, 10);
}

export function calendarSourceOnDay(calendar: MedicationCalendar, day: string, logs: readonly { scheduled_date: string; calendar_source?: string | null }[]): CalendarSource {
  const entries = calendar.history.filter(entry => entry.first_day <= day);
  const effective = entries.at(-1);
  if (!effective) return 'legacy';
  const sources = new Set<CalendarSource>([effective.source]);
  if (effective.first_day === day) {
    const previous = entries.filter(entry => entry.first_day < day).at(-1);
    const changes = entries.filter(entry => entry.first_day === day);
    if (previous && changes[0].previous_day === day) sources.add(previous.source);
    for (const entry of changes) sources.add(entry.source);
  }
  for (const log of logs) {
    if (log.scheduled_date !== day) continue;
    const value = source.safeParse(log.calendar_source);
    sources.add(value.success ? value.data : 'legacy');
  }
  return sources.size > 1 ? 'multiple' : effective.source;
}
