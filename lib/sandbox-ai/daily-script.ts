/**
 * Daily Check-In Script -- Descriptor & Deterministic Completion
 *
 * Question content lives in script.ts (canonical wording per locale); this
 * module wires it into the CallScript shape and owns the deterministic
 * completion: red flags + disposition via evaluateRedFlags (rule set
 * `remote-monitoring-alerts`). Shared by the server chat path and the
 * client-side fallback form with identical results.
 */

import { subDays } from 'date-fns';
import { evaluateRedFlags } from '@/lib/vitals/red-flags';
import { resolveCallPatient, type CallPatientChart } from './call-patient';
import { QUESTION_ORDER, SCRIPT_QUESTIONS, escalationMessage, routineClosingMessage } from './script';
import type { CallScript, CheckInState, CheckInTurnResponse } from './types';

/** Fixture labels ("5d ago" / "Yesterday" / "Today") -> days before now. */
function labelToDaysAgo(label: string): number | null {
  if (label === 'Today') return 0;
  if (label === 'Yesterday') return 1;
  const match = /^(\d+)d ago$/.exec(label);
  return match ? Number(match[1]) : null;
}

/**
 * Synthetic weight history for trend red flags, most recent first. The
 * fixture's "Today" entry is excluded: the check-in itself is today's reading.
 */
export function syntheticWeightHistory(patient: Pick<CallPatientChart, 'vitals'>): Array<{ weight_lbs: number; recorded_at: string }> {
  const now = new Date();
  return patient.vitals
    .map((point) => ({ point, daysAgo: labelToDaysAgo(point.label) }))
    .filter((entry): entry is { point: typeof entry.point; daysAgo: number } =>
      entry.daysAgo !== null && entry.daysAgo > 0)
    .sort((a, b) => a.daysAgo - b.daysAgo)
    .map(({ point, daysAgo }) => ({
      weight_lbs: point.weight,
      recorded_at: subDays(now, daysAgo).toISOString(),
    }));
}

/**
 * Deterministic completion: red flags + disposition + closing messages.
 * Shared by the chat path (server) and the fallback form (client).
 */
export function finalizeCheckIn(state: CheckInState): CheckInTurnResponse {
  const patient = resolveCallPatient(state.patientId);
  const lastSynthetic = patient.vitals.at(-1);
  const flags = evaluateRedFlags(
    {
      weight_lbs: state.extraction.weightLbs ?? lastSynthetic?.weight ?? 0,
      sbp: state.extraction.sbp ?? lastSynthetic?.sbp ?? 0,
      spo2: state.extraction.spo2,
    },
    syntheticWeightHistory(patient),
    {
      dyspnea: state.extraction.dyspnea ?? 0,
      edema: state.extraction.edema ?? 0,
      orthopnea: state.extraction.orthopnea ?? false,
      fatigue: state.extraction.fatigue ?? 0,
    },
  );
  return {
    assistantMessages: [flags.length > 0
      ? escalationMessage(flags, state.locale)
      : routineClosingMessage(state.extraction, state.locale)],
    state: { ...state, phase: 'complete' },
    done: true,
    disposition: flags.length > 0 ? 'escalated' : 'routine',
    redFlags: flags,
    fallback: false,
  };
}

export const DAILY_SCRIPT: CallScript = {
  id: 'daily_checkin',
  questions: SCRIPT_QUESTIONS,
  order: QUESTION_ORDER,
  finalize: finalizeCheckIn,
};
