/**
 * Whitelisted outcomes for working a population review-queue case. Outcomes
 * are stored and transmitted as KEYS only — labels render from this table —
 * so persisted state and the copilot's narrative never carry free text. Each
 * option restates the registered rule's action; none of them changes any
 * therapy autonomously.
 */

export interface CaseOutcomeOption {
  key: string;
  label: string;
}

const WEIGHT_OPTIONS: CaseOutcomeOption[] = [
  { key: 'diuretic_adjustment_24h', label: 'Diuretic adjustment ordered per protocol — contact within 24 h' },
  { key: 'nurse_visit_same_day', label: 'Same-day nurse visit scheduled' },
];
const SBP_OPTIONS: CaseOutcomeOption[] = [
  { key: 'gdmt_dose_held', label: 'Held the next GDMT dose pending provider review' },
  { key: 'clinic_eval_same_day', label: 'Same-day clinic evaluation arranged' },
];
const SPO2_OPTIONS: CaseOutcomeOption[] = [
  { key: 'urgent_eval_spo2', label: 'Urgent evaluation arranged — low SpO2' },
  { key: 'in_person_today', label: 'In-person assessment today' },
];
const DYSPNEA_OPTIONS: CaseOutcomeOption[] = [
  { key: 'emergency_eval_now', label: 'Directed to emergency evaluation now' },
  { key: 'urgent_provider_review', label: 'Urgent same-day provider review' },
];
const UNREACHABLE_OPTIONS: CaseOutcomeOption[] = [
  { key: 'downtime_plan_started', label: 'Downtime contact plan started' },
  { key: 'chw_visit_requested', label: 'CHW home visit requested' },
];

/** Outcomes reachable outside the per-rule tables. */
export const EXTRA_OUTCOMES: CaseOutcomeOption[] = [
  { key: 'reviewed_no_call', label: 'Reviewed — no call needed' },
  { key: 'reviewed_legacy', label: 'Reviewed' },
  { key: 'call_routine_reassured', label: 'Call completed — reassured, monitoring continues' },
];

export function outcomeOptionsFor(ruleIds: string[], category: 'critical' | 'warning' | 'no_answer'): CaseOutcomeOption[] {
  if (category === 'no_answer') return UNREACHABLE_OPTIONS;
  const primary = ruleIds[0] ?? '';
  if (primary.startsWith('weight_gain')) return WEIGHT_OPTIONS;
  if (primary === 'sbp_low_symptomatic') return SBP_OPTIONS;
  if (primary === 'spo2_low') return SPO2_OPTIONS;
  if (primary === 'dyspnea_rest') return DYSPNEA_OPTIONS;
  return WEIGHT_OPTIONS;
}

const ALL_OPTIONS = [
  ...WEIGHT_OPTIONS, ...SBP_OPTIONS, ...SPO2_OPTIONS, ...DYSPNEA_OPTIONS,
  ...UNREACHABLE_OPTIONS, ...EXTRA_OUTCOMES,
];

export const OUTCOME_KEYS = new Set(ALL_OPTIONS.map((option) => option.key));

export function outcomeLabel(key: string): string {
  return ALL_OPTIONS.find((option) => option.key === key)?.label ?? 'Reviewed';
}
