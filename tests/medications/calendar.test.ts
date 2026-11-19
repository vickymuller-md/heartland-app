import { describe, expect, it } from 'vitest';
import { calendarSourceOnDay, type MedicationCalendar } from '@/lib/medications/calendar';

const origin = { first_day: '2026-11-01', previous_day: null, zone: 'America/New_York', source: 'care_team' as const, recorded_at: '2026-11-01T06:00:00Z' };
const chosen = { first_day: '2026-11-05', previous_day: '2026-11-04', zone: 'America/Los_Angeles', source: 'patient' as const, recorded_at: '2026-11-04T06:00:00Z' };
const calendar: MedicationCalendar = { source: 'patient', zone: chosen.zone, revision: '84000000-0000-4000-8000-000000000001', day: '2026-11-05',
  day_bounds: { start_at: '2026-11-05T08:00:00Z', end_at: '2026-11-06T08:00:00Z' }, pending_at: null, pending_zone: null, unclassified_dates: [], history: [origin, chosen] };

describe('calendar source shown for historical medication dates', () => {
  it('leaves the source of preexisting undated records unknown', () => {
    expect(calendarSourceOnDay(calendar, '2026-10-31', [])).toBe('legacy');
  });
  it('uses only the new source following a midnight handover and keeps the prior day with its original source', () => {
    expect(calendarSourceOnDay(calendar, '2026-11-04', [])).toBe('care_team');
    expect(calendarSourceOnDay(calendar, '2026-11-05', [])).toBe('patient');
  });
  it('identifies a same-day change of source and retains the uncertainty of a preexisting dose', () => {
    expect(calendarSourceOnDay({ ...calendar, history: [origin, { ...chosen, previous_day: chosen.first_day }] }, chosen.first_day, [])).toBe('multiple');
    expect(calendarSourceOnDay(calendar, chosen.first_day, [{ scheduled_date: chosen.first_day, calendar_source: null }])).toBe('multiple');
  });
});
