import { FREQUENCY_DOSES_MAP, TIMING_PRESETS } from './constants';
import type { AdherenceDay, MedicationFrequency, MedicationLog } from './types';

export interface MedicationSchedule {
  id: string;
  medication_id: string;
  patient_id: string;
  starts_on: string;
  ends_before: string | null;
  known: boolean;
  active: boolean | null;
  name: string | null;
  dosage: string | null;
  frequency: string | null;
  timing: string | null;
  weekly_day: number | null;
}

export type ScheduleEvidence = Pick<MedicationSchedule,
  'medication_id' | 'starts_on' | 'ends_before' | 'active' | 'known' | 'frequency' | 'weekly_day'>;
export type DoseEvidence = Pick<MedicationLog, 'medication_id' | 'scheduled_date' | 'dose_number' | 'taken'>;
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function summarizeAdherence(days: readonly AdherenceDay[]) {
  let scheduled = 0, taken = 0, uncertainDays = 0;
  for (const day of days) {
    if (day.status === 'unconfirmed') { uncertainDays++; continue; }
    if (day.status === 'future') continue;
    scheduled += day.totalDoses;
    taken += day.takenDoses;
  }
  return { scheduled, taken, uncertainDays };
}

export function medicationFrequency(value: string | null): MedicationFrequency | null {
  const frequency = value?.trim().toLowerCase();
  if (frequency === 'daily') return 'once_daily';
  return frequency && Object.hasOwn(FREQUENCY_DOSES_MAP, frequency) ? frequency as MedicationFrequency : null;
}

/** Past clients stored plain text, JSON arrays, or comma-separated timing presets. */
export function medicationTiming(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((t): t is string => typeof t === 'string' && !!t.trim()).map(t => t.trim());
  if (typeof value !== 'string' || !value.trim()) return [];
  const text = value.trim();
  if (text.startsWith('[')) {
    try {
      const entries: unknown = JSON.parse(text);
      if (Array.isArray(entries) && entries.every(t => typeof t === 'string')) return medicationTiming(entries);
    } catch { /* Preserve the original instruction. */ }
  }
  if (text.includes('\n')) return text.split('\n').map(line => line.trim()).filter(Boolean);
  const parts = text.replace(/^\{(.*)\}$/, '$1').split(',').map(part => part.trim().replace(/^"(.*)"$/, '$1'));
  return parts.every(part => TIMING_PRESETS.some(preset => preset.value === part)) ? parts : [text];
}

export function activeOn(version: Pick<ScheduleEvidence, 'starts_on' | 'ends_before'>, day: string): boolean {
  return version.starts_on <= day && (version.ends_before === null || day < version.ends_before);
}

/** An unknown historical interval cannot supply a name or dosage to an export. */
export function medicationScheduleOn(history: MedicationSchedule[], medicationId: string, day: string): MedicationSchedule | null {
  const matches = history.filter(version => version.medication_id === medicationId && activeOn(version, day));
  return matches.length === 1 && matches[0].known ? matches[0] : null;
}

/** Null means the day cannot be classified from the supplied evidence. */
export function expectedDoseCount(version: Pick<ScheduleEvidence, 'active' | 'known' | 'frequency' | 'weekly_day'>, day: string): number | null {
  if (!version.known || version.active === null) return null;
  if (!version.active) return 0;
  const frequency = medicationFrequency(version.frequency);
  if (!frequency) return null;
  if (frequency === 'weekly') {
    if (version.weekly_day === null || !Number.isInteger(version.weekly_day) || version.weekly_day < 0 || version.weekly_day > 6) return null;
    return new Date(day + 'T12:00:00Z').getUTCDay() === version.weekly_day ? 1 : 0;
  }
  return FREQUENCY_DOSES_MAP[frequency];
}

export function adherenceFromSchedules(day: string, history: readonly ScheduleEvidence[], logs: readonly DoseEvidence[], today: string): AdherenceDay {
  if (day > today) return { date: day, totalDoses: 0, takenDoses: 0, status: 'future' };
  const slots = new Map<string, number | null>();
  let uncertain = false;
  let totalDoses = 0;
  for (const version of history) {
    if (!activeOn(version, day)) continue;
    // Overlapping revisions cannot identify which instruction applied to that day.
    const count = slots.has(version.medication_id) ? null : expectedDoseCount(version, day);
    slots.set(version.medication_id, count);
  }
  for (const count of slots.values()) {
    if (count === null) uncertain = true;
    else totalDoses += count;
  }
  const taken = new Set<string>();
  for (const log of logs) {
    if (log.scheduled_date !== day || !log.taken) continue;
    if (Number.isInteger(log.dose_number) && log.dose_number >= 1 && log.dose_number <= (slots.get(log.medication_id) ?? 0)) {
      taken.add(log.medication_id + '/' + log.dose_number);
    } else {
      // Keep the original log, but do not credit an unknown slot to a different medication.
      uncertain = true;
    }
  }
  const takenDoses = taken.size;
  const status = uncertain ? 'unconfirmed' : !totalDoses ? 'no_meds' : takenDoses === totalDoses ? 'complete' : takenDoses ? 'partial' : 'missed';
  return { date: day, totalDoses, takenDoses, status };
}
