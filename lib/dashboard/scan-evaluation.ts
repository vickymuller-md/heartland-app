/** Frozen proactive-rule evaluation. No database writes, notifications or clinical normal label. */
import { z } from 'zod';
import {
  classifyProactiveSeverity, evaluateCriticalLabs, evaluateFollowupDue,
  evaluateFollowupOverdue, evaluateLowAdherence, evaluateNoCheckin, evaluateWeightTrend7d,
} from './alert-engine';
import { FREQUENCY_DOSES_MAP } from '@/lib/medications/constants';
import type { AdherenceDay } from '@/lib/medications/types';
import type { AlertSeverity } from './types';

export const SCAN_RECIPE = 'proactive-frozen-v1';
export const SCAN_RULES = [
  'no_checkin', 'low_adherence', 'weight_trend_7d', 'hyperkalemia',
  'low_egfr', 'followup_due', 'followup_overdue',
] as const;
export type ScanRule = typeof SCAN_RULES[number];
export type ScanResult = {
  receipt_id: string | null;
  rule: ScanRule;
  decision: 'triggered' | 'not_triggered' | 'not_applicable' | 'suppressed' | 'blocked';
  severity: AlertSeverity | null;
  reason: 'invalid_context' | 'invalid_source' | 'ambiguous_source' | 'acute_weight_active' | null;
  source_ids: string[];
};

const instant = z.string().datetime({ offset: true }).refine((value) => Number.isFinite(Date.parse(value))
  && (value.match(/\.(\d+)/)?.[1].length ?? 0) <= 6);
const id = z.string().uuid();
const number = z.number().finite();
const calendarDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
const envelope = z.object({
  receipt_id: id, recipe: z.literal(SCAN_RECIPE), captured_at: instant, calendar_timezone: z.string().min(1),
  calendar_dates: z.array(calendarDay).length(7), sources: z.record(z.string(), z.unknown()),
});
const checkinSource = z.object({
  patient_created_at: instant, latest_vital: z.object({ id, recorded_at: instant }).nullable(),
});
const weightSource = z.array(z.object({ id, weight_lbs: number, recorded_at: instant })).max(1000);
const labSource = z.array(z.object({
  id, potassium: number.nullable(), egfr: number.nullable(), collected_at: instant,
})).max(1000);
const followupSource = z.array(z.object({ id, scheduled_at: instant, completed: z.boolean() })).max(1000);
const alertSource = z.array(z.object({
  id, flags: z.array(z.string()), status: z.enum(['open', 'acknowledged']),
})).max(1000);
const adherenceSource = z.object({
  medications: z.array(z.object({ id, frequency: z.string().nullable() })).max(1000),
  logs: z.array(z.object({ id, medication_id: id, scheduled_date: calendarDay, taken: z.boolean() })).max(10000),
});

function result(rule: ScanRule, decision: ScanResult['decision'], sourceIds: string[] = [],
  reason: ScanResult['reason'] = null, severity?: AlertSeverity): ScanResult {
  return { receipt_id: null, rule, decision, severity: decision === 'triggered' ? severity ?? classifyProactiveSeverity(rule) : null,
    reason, source_ids: [...new Set(sourceIds)].sort() };
}
function blocked(rule: ScanRule, reason: ScanResult['reason'] = 'invalid_source'): ScanResult {
  return result(rule, 'blocked', [], reason);
}
function uniqueIds(rows: { id: string }[]): boolean {
  return new Set(rows.map((row) => row.id)).size === rows.length;
}
// PostgreSQL timestamps retain microseconds. Date.parse alone would collapse distinct sources.
function microseconds(value: string): bigint {
  const fraction = value.match(/\.(\d+)(?:Z|[+-]\d\d:\d\d)$/)?.[1] ?? '';
  return BigInt(Date.parse(value)) * BigInt(1000) + BigInt(fraction.padEnd(6, '0').slice(3, 6));
}
function frozenCalendarMatches(capturedAt: string, timezone: string, days: string[]): boolean {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date(capturedAt));
    const part = (kind: string) => parts.find((entry) => entry.type === kind)?.value;
    const end = `${part('year')}-${part('month')}-${part('day')}`;
    if (days[6] !== end) return false;
    return days.every((day, index) => Date.parse(`${day}T00:00:00Z`) ===
      Date.parse(`${end}T00:00:00Z`) - (6 - index) * 86_400_000);
  } catch { return false; }
}

export function evaluateScanSnapshot(input: unknown): ScanResult[] {
  const parsed = envelope.safeParse(input);
  if (!parsed.success || !frozenCalendarMatches(parsed.data.captured_at,
    parsed.data.calendar_timezone, parsed.data.calendar_dates)) {
    const identity = z.object({ receipt_id: id }).safeParse(input);
    return SCAN_RULES.map((rule) => ({ ...blocked(rule, 'invalid_context'),
      receipt_id: identity.success ? identity.data.receipt_id : null }));
  }
  const { sources, captured_at: capturedAt, calendar_dates: dates } = parsed.data;
  const now = new Date(capturedAt);
  const nowMicros = microseconds(capturedAt);
  const sevenDaysAgo = nowMicros - BigInt(7 * 86_400_000) * BigInt(1000);
  const output = new Map<ScanRule, ScanResult>();

  const checkin = checkinSource.safeParse(sources.checkin);
  output.set('no_checkin', checkin.success ? result('no_checkin', evaluateNoCheckin(
    checkin.data.latest_vital?.recorded_at ?? null, checkin.data.patient_created_at, undefined, now,
  ) ? 'triggered' : 'not_triggered', checkin.data.latest_vital ? [checkin.data.latest_vital.id] : []) : blocked('no_checkin'));

  const adherence = adherenceSource.safeParse(sources.adherence);
  if (!adherence.success || !uniqueIds(adherence.data.medications) || !uniqueIds(adherence.data.logs)
    || adherence.data.medications.some((med) => med.frequency === null || !Object.hasOwn(FREQUENCY_DOSES_MAP, med.frequency))
    || adherence.data.logs.some((log) => !dates.includes(log.scheduled_date))) {
    output.set('low_adherence', blocked('low_adherence'));
  } else {
    const expected = adherence.data.medications.reduce((sum, med) =>
      sum + FREQUENCY_DOSES_MAP[med.frequency as keyof typeof FREQUENCY_DOSES_MAP], 0);
    // Preserve the existing recipe's counting of every captured taken log, including inactive meds.
    const days: AdherenceDay[] = dates.map((date) => {
      const taken = adherence.data.logs.filter((log) => log.scheduled_date === date && log.taken).length;
      return { date, totalDoses: expected, takenDoses: expected === 0 ? 0 : taken,
        status: expected === 0 ? 'no_meds' : taken >= expected ? 'complete' : taken > 0 ? 'partial' : 'missed' };
    });
    output.set('low_adherence', result('low_adherence', expected === 0 ? 'not_applicable' :
      evaluateLowAdherence(days) ? 'triggered' : 'not_triggered',
    [...adherence.data.medications, ...adherence.data.logs].map((row) => row.id)));
  }

  const weights = weightSource.safeParse(sources.weights);
  const alerts = alertSource.safeParse(sources.acute_alerts);
  if (!weights.success || !alerts.success || !uniqueIds(weights.data) || !uniqueIds(alerts.data)
    || weights.data.some((row) => microseconds(row.recorded_at) < sevenDaysAgo)) {
    output.set('weight_trend_7d', blocked('weight_trend_7d'));
  } else {
    const acute = alerts.data.filter((row) => row.flags.some((flag) =>
      flag === 'weight_gain_3lb_2d' || flag === 'weight_gain_5lb_7d'));
    const sorted = [...weights.data].sort((a, b) => {
      const diff = microseconds(a.recorded_at) - microseconds(b.recorded_at);
      return diff < 0 ? -1 : diff > 0 ? 1 : a.id.localeCompare(b.id);
    });
    const conflictingBoundary = sorted.length > 1 && [sorted[0], sorted.at(-1)!].some((boundary) =>
      sorted.some((row) => microseconds(row.recorded_at) === microseconds(boundary.recorded_at)
        && row.weight_lbs !== boundary.weight_lbs));
    output.set('weight_trend_7d', acute.length ? result('weight_trend_7d', 'suppressed',
      acute.map((row) => row.id), 'acute_weight_active') : conflictingBoundary ? blocked('weight_trend_7d', 'ambiguous_source') :
      result('weight_trend_7d', sorted.length < 2 ? 'not_applicable' :
        evaluateWeightTrend7d(sorted) ? 'triggered' : 'not_triggered', sorted.map((row) => row.id)));
  }

  // Snapshot stores all latest-timestamp candidates, not an arbitrary row selected by LIMIT1.
  const labs = labSource.safeParse(sources.latest_labs);
  for (const rule of ['hyperkalemia', 'low_egfr'] as const) {
    if (!labs.success || !uniqueIds(labs.data)) { output.set(rule, blocked(rule)); continue; }
    if (!labs.data.length) { output.set(rule, result(rule, 'not_applicable')); continue; }
    const field = rule === 'hyperkalemia' ? 'potassium' : 'egfr';
    const first = labs.data[0];
    if (labs.data.some((row) => microseconds(row.collected_at) !== microseconds(first.collected_at))) {
      output.set(rule, blocked(rule)); continue;
    }
    if (labs.data.some((row) => row[field] !== first[field])) {
      output.set(rule, blocked(rule, 'ambiguous_source')); continue;
    }
    output.set(rule, result(rule, first[field] === null ? 'not_applicable' :
      evaluateCriticalLabs(first).includes(rule) ? 'triggered' : 'not_triggered', labs.data.map((row) => row.id)));
  }

  const followups = followupSource.safeParse(sources.followups);
  if (!followups.success || !uniqueIds(followups.data) || followups.data.some((row) =>
    microseconds(row.scheduled_at) < sevenDaysAgo || microseconds(row.scheduled_at) > nowMicros + BigInt(86_400_000_000))) {
    output.set('followup_due', blocked('followup_due'));
    output.set('followup_overdue', blocked('followup_overdue'));
  } else {
    const due = followups.data.filter((row) => microseconds(row.scheduled_at) >= nowMicros
      && evaluateFollowupDue(row.scheduled_at, row.completed, undefined, now));
    const overdue = followups.data.filter((row) => microseconds(row.scheduled_at) < nowMicros)
      .map((row) => ({ row, evaluation: evaluateFollowupOverdue(row.scheduled_at, row.completed, now) }))
      .filter((entry) => entry.evaluation !== null);
    output.set('followup_due', result('followup_due', due.length ? 'triggered' : 'not_triggered', due.map((row) => row.id)));
    output.set('followup_overdue', result('followup_overdue', overdue.length ? 'triggered' : 'not_triggered',
      overdue.map((entry) => entry.row.id), null,
      overdue.some((entry) => entry.evaluation?.severity === 'critical') ? 'critical' : 'warning'));
  }
  return SCAN_RULES.map((rule) => ({ ...output.get(rule)!, receipt_id: parsed.data.receipt_id }));
}
