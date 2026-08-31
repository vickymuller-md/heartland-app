/**
 * Synthetic population engine for the scale demonstration ("one clinician,
 * thousands of patients"). Pure and deterministic: a fixed seed drives every
 * draw, the SAME registered engines the app uses (risk score, track
 * assignment, red-flag rules) run over every synthetic patient, and the same
 * (size, dayIndex) always reproduces the same numbers — client and server
 * compute identical results, so the copilot tool can recompute instead of
 * trusting a client snapshot. No Date.now()-dependent randomness anywhere.
 *
 * Every rate below is an ILLUSTRATIVE workflow parameter for a demonstration
 * on synthetic data, documented for clinical review in
 * reference/CLINICAL_REVIEW_v1.6.0.md — never a clinical outcome claim.
 */

import { assignTrack } from '@/lib/remote-monitoring/engine';
import type { TrackType } from '@/lib/remote-monitoring/types';
import { calculateRiskScore } from '@/lib/risk-score/engine';
import type { RiskInput } from '@/lib/risk-score/types';
import { evaluateRedFlags } from '@/lib/vitals/red-flags';

// ── Deterministic randomness ─────────────────────────────────

const POP_SEED = 0x48454152; // "HEAR"

/** splitmix32-style finalizer: one well-mixed 32-bit seed per (ordinal, day, stream). */
function seedFor(ordinal: number, dayIndex: number, stream: number): number {
  let h = POP_SEED ^ Math.imul(ordinal + 1, 0x9e3779b1);
  h = Math.imul(h ^ (dayIndex + 1), 0x85ebca6b);
  h = Math.imul(h ^ stream, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12; h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Stream ids: generation uses day 0 streams; per-day simulation uses 10+.
// New future events must claim NEW stream ids so existing draws never shift.
const STREAM = {
  demographics: 0,
  connectivity: 1,
  baseline: 2,
  adherence: 3,
  dayResponse: 10,
  dayWeight: 11,
  daySymptoms: 12,
  dayAdherence: 13,
  dayRetry: 14,
  dayMinute: 15,
} as const;

// ── Cohort generation ────────────────────────────────────────

export type PopulationSize = 500 | 2500 | 5000;
export const POPULATION_SIZES: readonly PopulationSize[] = [500, 2500, 5000];
export const DEFAULT_POPULATION_SIZE: PopulationSize = 2500;

type RiskTierLabel = 'Low' | 'Moderate' | 'High';
type AdherenceProfile = 'good' | 'variable' | 'poor';

interface PopulationPatient {
  ordinal: number;
  name: string;
  age: number;
  state: string;
  tier: RiskTierLabel;
  track: TrackType;
  adherenceProfile: AdherenceProfile;
  baselineWeightLbs: number;
}

const FIRST_NAMES = [
  'Alma', 'Arthur', 'Beatrice', 'Bill', 'Carmen', 'Cecil', 'Clara', 'Curtis',
  'Delia', 'Dennis', 'Dolores', 'Earl', 'Edith', 'Elmer', 'Estela', 'Floyd',
  'Geneva', 'Gerald', 'Gloria', 'Harold', 'Hazel', 'Homer', 'Inez', 'Ira',
  'Josefina', 'Leland', 'Lucille', 'Mabel', 'Manuel', 'Marvin', 'Maxine', 'Merle',
  'Nadine', 'Norris', 'Opal', 'Orville', 'Pearl', 'Ramona', 'Roscoe', 'Ruby',
  'Sylvia', 'Thelma', 'Vern', 'Viola', 'Wade', 'Wilma', 'Woodrow', 'Yolanda',
] as const;

const LAST_NAMES = [
  'Abbott', 'Barnes', 'Calhoun', 'Delgado', 'Eubanks', 'Fentress', 'Gallegos', 'Hargrove',
  'Ingram', 'Jessup', 'Kirkland', 'Lujan', 'McAllister', 'Nystrom', 'Ortega', 'Pruitt',
  'Quintana', 'Rasmussen', 'Sandoval', 'Tillman', 'Umbarger', 'Vann', 'Whitfield', 'Yancey',
  'Ackerman', 'Bowles', 'Crabtree', 'Dunaway', 'Eldridge', 'Fuentes', 'Grimes', 'Hutchins',
  'Irwin', 'Jarrell', 'Kessler', 'Lockhart', 'Medrano', 'Nunley', 'Osborne', 'Padgett',
] as const;

const RURAL_STATES = ['NM', 'KS', 'WV', 'MT', 'ND', 'SD', 'ME', 'MS', 'KY', 'OK', 'NE', 'WY', 'AR', 'IA'] as const;

/**
 * Base prevalence + frailty loading per risk factor. A latent frailty u∈[0,1)
 * correlates the clinical factors (present when rng < p + loading*(u-0.5));
 * the social/geographic factors carry ZERO loading on purpose — social risk
 * independent of clinical severity is the HEARTLAND framing.
 */
const RISK_FACTOR_MODEL: ReadonlyArray<{ key: keyof RiskInput; p: number; loading: number }> = [
  { key: 'ageOver75', p: 0.45, loading: 0.2 },
  { key: 'priorHfHospitalization', p: 0.35, loading: 0.35 },
  { key: 'egfrBelow45', p: 0.35, loading: 0.3 },
  { key: 'elevatedNatriuretic', p: 0.4, loading: 0.3 },
  { key: 'sbpBelow100', p: 0.12, loading: 0.2 },
  { key: 'diabetes', p: 0.45, loading: 0.15 },
  { key: 'lvefBelow30', p: 0.25, loading: 0.25 },
  { key: 'ckmStage3or4', p: 0.4, loading: 0.3 },
  { key: 'distanceOver50Miles', p: 0.55, loading: 0 },
  { key: 'livesAloneOrLimitedSupport', p: 0.35, loading: 0 },
];

function generatePatient(ordinal: number): PopulationPatient {
  const demo = mulberry32(seedFor(ordinal, 0, STREAM.demographics));
  const frailty = demo();

  const riskInput = {} as RiskInput;
  for (const factor of RISK_FACTOR_MODEL) {
    riskInput[factor.key] = demo() < factor.p + factor.loading * (frailty - 0.5);
  }
  // Keep only what the demo displays; RiskResult.breakdown would be 10 objects × N.
  const tier = calculateRiskScore(riskInput).tierLabel as RiskTierLabel;

  const name = `${FIRST_NAMES[Math.floor(demo() * FIRST_NAMES.length)]} ${LAST_NAMES[Math.floor(demo() * LAST_NAMES.length)]}`;
  const age = riskInput.ageOver75 ? 75 + Math.floor(demo() * 17) : 52 + Math.floor(demo() * 23);
  const state = RURAL_STATES[Math.floor(demo() * RURAL_STATES.length)];

  const conn = mulberry32(seedFor(ordinal, 0, STREAM.connectivity));
  const smartphoneConnectivity = conn() < 0.55 - (riskInput.ageOver75 ? 0.2 : 0);
  const comfortableWithApps = smartphoneConnectivity && conn() < 0.55 - (riskInput.ageOver75 ? 0.15 : 0);
  const reliableTelephone = conn() < 0.9;
  const track = assignTrack({ smartphoneConnectivity, comfortableWithApps, reliableTelephone }).track;

  const base = mulberry32(seedFor(ordinal, 0, STREAM.baseline));
  const baselineWeightLbs = Math.round((145 + base() * 90) * 10) / 10;

  const adh = mulberry32(seedFor(ordinal, 0, STREAM.adherence));
  const adherenceDraw = adh();
  const adherenceProfile: AdherenceProfile = adherenceDraw < 0.6 ? 'good' : adherenceDraw < 0.9 ? 'variable' : 'poor';

  return { ordinal, name, age, state, tier, track, adherenceProfile, baselineWeightLbs };
}

const cohortCache = new Map<PopulationSize, PopulationPatient[]>();

/** Seeded per ordinal (never per size): the 500 cohort is an exact prefix of the 5000 one. */
export function generatePopulation(size: PopulationSize): PopulationPatient[] {
  const cached = cohortCache.get(size);
  if (cached) return cached;
  const larger = [...cohortCache.values()].find((cohort) => cohort.length >= size);
  const cohort = larger
    ? larger.slice(0, size)
    : Array.from({ length: size }, (_, ordinal) => generatePatient(ordinal));
  cohortCache.set(size, cohort);
  return cohort;
}

// ── Daily simulation ─────────────────────────────────────────

export interface PopulationException {
  name: string;
  age: number;
  state: string;
  track: TrackType;
  riskTier: RiskTierLabel;
  category: 'critical' | 'warning' | 'no_answer';
  reason: string;
  ruleIds: string[];
}

export interface PopulationDayCounts {
  total: number;
  responded: number;
  routine: number;
  retriedResolved: number;
  unresolvedNoAnswer: number;
  critical: number;
  warning: number;
  adherenceLapse: number;
  reviewQueue: number;
  /** Share of check-ins fully handled by the registered rules, one decimal. */
  automatedPct: number;
}

export interface PopulationDayResult {
  size: PopulationSize;
  dayIndex: number;
  counts: PopulationDayCounts;
  /** Severity-ordered top of the human review queue. */
  exceptions: PopulationException[];
  distribution: {
    tiers: { low: number; moderate: number; high: number };
    tracks: { trackA: number; hybrid: number; trackB: number };
  };
}

const NO_ANSWER_RATE: Record<TrackType, number> = { 'track-a': 0.06, hybrid: 0.12, 'track-b': 0.18 };
const RETRY_RESOLVES = 0.8;
const FLAG_RATE: Record<RiskTierLabel, number> = { High: 0.026, Moderate: 0.01, Low: 0.0035 };
// Adherence lapses route to the pharmacist workflow (a separate funnel row),
// not the clinician review queue — same split the tour demonstrates with Robert.
const ADHERENCE_LAPSE_RATE: Record<AdherenceProfile, number> = { good: 0.002, variable: 0.012, poor: 0.04 };
const EXCEPTION_LIST_CAP = 30;
const CATEGORY_RANK: Record<PopulationException['category'], number> = {
  critical: 0, warning: 1, no_answer: 2,
};

interface FlagEvent {
  kind: 'weight_7d' | 'weight_2d' | 'hypotension' | 'spo2' | 'dyspnea_rest';
}

function pickFlagEvent(rng: () => number): FlagEvent {
  const draw = rng();
  if (draw < 0.3) return { kind: 'weight_7d' };
  if (draw < 0.55) return { kind: 'weight_2d' };
  if (draw < 0.7) return { kind: 'hypotension' };
  if (draw < 0.9) return { kind: 'spo2' };
  return { kind: 'dyspnea_rest' };
}

/** Per-patient evaluation outcome; drives both the aggregate and the replay events. */
interface PatientDayOutcome {
  category: 'routine' | 'retry' | 'no_answer' | 'critical' | 'warning' | 'adherence';
  ruleIds: string[];
  /** Pre-formatted exception reason; null outside critical/warning. */
  reason: string | null;
  /** Reported values for the day; null when no check-in reached the clinic. */
  values: { weightLbs: number; sbp: number; spo2: number; dyspnea: number } | null;
  weightDelta: number | null;
  /** The 7 prior weights the red-flag windows evaluated (most recent first). */
  weightHistory: number[] | null;
}

/** Timestamps the red-flag windows compare against; shared so both consumers agree. */
function buildRecordedAt(now: number): string[] {
  // The extra 6h keeps every entry safely inside the engine's own
  // new Date()-based cutoffs regardless of when the caller sampled `now`.
  return Array.from({ length: 7 }, (_, index) =>
    new Date(now - (index + 1 + 0.25) * 86_400_000).toISOString());
}

/**
 * One patient's day, PRNG-deterministic. The draw ORDER below is frozen by
 * population-regression.test.ts: weightToday/sbp/spo2/fatigue are always
 * drawn before the event overrides, pickFlagEvent draws before the history,
 * and the event ifs stay sequential — reordering any of it changes every
 * downstream number.
 */
function evaluatePatientDay(
  patient: PopulationPatient,
  dayIndex: number,
  recordedAt: string[],
): PatientDayOutcome {
  const none = { ruleIds: [] as string[], reason: null, values: null, weightDelta: null, weightHistory: null };

  const responseRng = mulberry32(seedFor(patient.ordinal, dayIndex, STREAM.dayResponse));
  let noAnswerChance = NO_ANSWER_RATE[patient.track];
  if (patient.adherenceProfile === 'poor') noAnswerChance += 0.06;

  if (responseRng() < noAnswerChance) {
    const retryRng = mulberry32(seedFor(patient.ordinal, dayIndex, STREAM.dayRetry));
    if (retryRng() < RETRY_RESOLVES) return { category: 'retry', ...none };
    return { category: 'no_answer', ...none };
  }

  const weightRng = mulberry32(seedFor(patient.ordinal, dayIndex, STREAM.dayWeight));
  const symptomRng = mulberry32(seedFor(patient.ordinal, dayIndex, STREAM.daySymptoms));
  const flagged = weightRng() < FLAG_RATE[patient.tier];
  const event = flagged ? pickFlagEvent(weightRng) : null;

  const base = patient.baselineWeightLbs;
  const history = recordedAt.map((recorded, index) => ({
    weight_lbs: Math.round((base + (weightRng() - 0.5) * 0.8 - index * 0.02) * 10) / 10,
    recorded_at: recorded,
  }));

  let weightToday = base + (weightRng() - 0.5) * 0.8;
  let sbp = 112 + Math.floor(symptomRng() * 30);
  let spo2 = 94 + Math.floor(symptomRng() * 5);
  let dyspnea = 0;
  const fatigue = symptomRng() < 0.15 ? 1 : 0;

  if (event) {
    if (event.kind === 'weight_7d') weightToday = base + 5.2 + weightRng() * 1.3;
    if (event.kind === 'weight_2d') weightToday = base + 3.2 + weightRng() * 1.2;
    if (event.kind === 'hypotension') { sbp = 78 + Math.floor(symptomRng() * 10); dyspnea = 1 + Math.floor(symptomRng() * 2); }
    if (event.kind === 'spo2') spo2 = 87 + Math.floor(symptomRng() * 4);
    if (event.kind === 'dyspnea_rest') dyspnea = 3;
  }

  const weightLbs = Math.round(weightToday * 10) / 10;
  const flags = evaluateRedFlags(
    { weight_lbs: weightLbs, sbp, spo2 },
    history,
    { dyspnea, edema: 0, orthopnea: false, fatigue },
  );

  const values = { weightLbs, sbp, spo2, dyspnea };
  const weightDelta = Math.round((weightToday - base) * 10) / 10;
  const weightHistory = history.map((entry) => entry.weight_lbs);

  if (flags.length > 0) {
    const critical = flags.some((flag) => flag.severity === 'critical');
    const reason = flags[0].id.startsWith('weight')
      ? `Weight +${weightDelta} lb — rule ${flags[0].id}`
      : `${flags[0].message} — rule ${flags[0].id}`;
    return {
      category: critical ? 'critical' : 'warning',
      ruleIds: flags.map((flag) => flag.id),
      reason, values, weightDelta, weightHistory,
    };
  }

  const adherenceRng = mulberry32(seedFor(patient.ordinal, dayIndex, STREAM.dayAdherence));
  if (adherenceRng() < ADHERENCE_LAPSE_RATE[patient.adherenceProfile]) {
    return { category: 'adherence', ruleIds: [], reason: null, values, weightDelta, weightHistory };
  }

  return { category: 'routine', ruleIds: [], reason: null, values, weightDelta, weightHistory };
}

const UNREACHABLE_HIGH_RISK_REASON =
  'High-risk patient unreachable after automated retry — downtime contact plan due';

const dayCache = new Map<string, PopulationDayResult>();

export function simulatePopulationDay(size: PopulationSize, dayIndex: number): PopulationDayResult {
  const cacheKey = `${size}:${dayIndex}`;
  const cached = dayCache.get(cacheKey);
  if (cached) return cached;

  const cohort = generatePopulation(size);
  const recordedAt = buildRecordedAt(Date.now());

  const counts: PopulationDayCounts = {
    total: size, responded: 0, routine: 0, retriedResolved: 0, unresolvedNoAnswer: 0,
    critical: 0, warning: 0, adherenceLapse: 0, reviewQueue: 0, automatedPct: 0,
  };
  const tiers = { low: 0, moderate: 0, high: 0 };
  const tracks = { trackA: 0, hybrid: 0, trackB: 0 };
  const exceptions: PopulationException[] = [];

  const pushException = (exception: PopulationException) => {
    exceptions.push(exception);
    if (exceptions.length > EXCEPTION_LIST_CAP * 4) {
      exceptions.sort((a, b) => CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category]);
      exceptions.length = EXCEPTION_LIST_CAP;
    }
  };

  for (const patient of cohort) {
    tiers[patient.tier.toLowerCase() as 'low' | 'moderate' | 'high'] += 1;
    if (patient.track === 'track-a') tracks.trackA += 1;
    else if (patient.track === 'hybrid') tracks.hybrid += 1;
    else tracks.trackB += 1;

    const outcome = evaluatePatientDay(patient, dayIndex, recordedAt);

    if (outcome.category === 'retry') {
      // Answered on the automated retry: responded but counted apart from
      // first-attempt routine so the funnel rows add up to the total.
      counts.retriedResolved += 1;
      counts.responded += 1;
      continue;
    }
    if (outcome.category === 'no_answer') {
      counts.unresolvedNoAnswer += 1;
      // Only unresolved high-risk gaps interrupt the human; the rest stay on
      // the automated retry cadence — mirrors the Track B downtime plan.
      if (patient.tier === 'High') {
        pushException({
          name: patient.name, age: patient.age, state: patient.state, track: patient.track,
          riskTier: patient.tier, category: 'no_answer',
          reason: UNREACHABLE_HIGH_RISK_REASON,
          ruleIds: [],
        });
      }
      continue;
    }

    counts.responded += 1;

    if (outcome.category === 'critical' || outcome.category === 'warning') {
      if (outcome.category === 'critical') counts.critical += 1; else counts.warning += 1;
      pushException({
        name: patient.name, age: patient.age, state: patient.state, track: patient.track,
        riskTier: patient.tier, category: outcome.category,
        reason: outcome.reason ?? '', ruleIds: outcome.ruleIds,
      });
      continue;
    }
    if (outcome.category === 'adherence') {
      counts.adherenceLapse += 1;
      continue;
    }

    counts.routine += 1;
  }

  const highRiskUnreachable = exceptions.filter((exception) => exception.category === 'no_answer').length;
  // The clinician queue: rule-flagged plus unreachable high-risk. Adherence
  // lapses count separately (pharmacist row) and never inflate this number.
  counts.reviewQueue = counts.critical + counts.warning + highRiskUnreachable;
  counts.automatedPct = Math.round(((counts.total - counts.reviewQueue) / counts.total) * 1000) / 10;

  // Stable sort by category only: insertion order (= ordinal) breaks ties,
  // matching the mid-loop pruning so the final top list is deterministic.
  exceptions.sort((a, b) => CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category]);
  const result: PopulationDayResult = {
    size, dayIndex, counts,
    exceptions: exceptions.slice(0, EXCEPTION_LIST_CAP),
    distribution: { tiers, tracks },
  };
  dayCache.set(cacheKey, result);
  return result;
}

export const TRACK_SHORT_LABELS: Record<TrackType, string> = {
  'track-a': 'Track A', hybrid: 'Hybrid', 'track-b': 'Track B',
};

// ── Replay event stream ──────────────────────────────────────

export type PopulationEventCategory = PatientDayOutcome['category'];

/** One processed check-in in the simulated overnight window, replay-ordered. */
export interface PopulationEvent {
  ordinal: number;
  /** Minutes since midnight inside the simulated 05:30–07:30 window. */
  minute: number;
  name: string;
  age: number;
  state: string;
  track: TrackType;
  riskTier: RiskTierLabel;
  category: PopulationEventCategory;
  detail: string;
  ruleIds?: string[];
  values?: { weightLbs: number; sbp: number; spo2: number; dyspnea: number };
  weightDelta?: number;
  weightHistory?: number[];
}

// Shared constants for the common categories: zero per-event allocation.
const EVENT_DETAIL: Record<'routine' | 'retry' | 'adherence', string> = {
  routine: 'check-in ✓ routine — auto-documented',
  retry: 'no answer → answered on automated retry',
  adherence: 'missed doses reported → routed to pharmacist workflow',
};
const NO_ANSWER_DETAIL = 'unreachable — automated retry cadence continues';
const NO_ANSWER_HIGH_DETAIL = 'unreachable — HIGH risk → downtime contact plan, queued for clinician';

// Only the theater consumes events; cache a single key so switching sizes/days
// never accumulates tens of thousands of retained objects.
let lastEventsKey: string | null = null;
let lastEvents: PopulationEvent[] | null = null;

export function getPopulationDayEvents(size: PopulationSize, dayIndex: number): PopulationEvent[] {
  const cacheKey = `${size}:${dayIndex}`;
  if (lastEventsKey === cacheKey && lastEvents) return lastEvents;

  const cohort = generatePopulation(size);
  const recordedAt = buildRecordedAt(Date.now());
  const events: PopulationEvent[] = new Array(size);

  for (let index = 0; index < cohort.length; index += 1) {
    const patient = cohort[index];
    const outcome = evaluatePatientDay(patient, dayIndex, recordedAt);
    const minuteRng = mulberry32(seedFor(patient.ordinal, dayIndex, STREAM.dayMinute));
    const minute = 330 + Math.floor(minuteRng() * 121);

    const isFlagged = outcome.category === 'critical' || outcome.category === 'warning';
    const highNoAnswer = outcome.category === 'no_answer' && patient.tier === 'High';
    const detail = isFlagged
      ? outcome.reason ?? ''
      : outcome.category === 'no_answer'
        ? (highNoAnswer ? NO_ANSWER_HIGH_DETAIL : NO_ANSWER_DETAIL)
        : EVENT_DETAIL[outcome.category as 'routine' | 'retry' | 'adherence'];

    const event: PopulationEvent = {
      ordinal: patient.ordinal, minute, name: patient.name, age: patient.age, state: patient.state,
      track: patient.track, riskTier: patient.tier, category: outcome.category, detail,
    };
    if (isFlagged || highNoAnswer) {
      event.ruleIds = outcome.ruleIds;
      if (outcome.values) {
        event.values = outcome.values;
        event.weightDelta = outcome.weightDelta ?? undefined;
        event.weightHistory = outcome.weightHistory ?? undefined;
      }
    }
    events[index] = event;
  }

  events.sort((a, b) => a.minute - b.minute || a.ordinal - b.ordinal);
  lastEventsKey = cacheKey;
  lastEvents = events;
  return events;
}

/** Test hook: proves determinism by forcing full recomputation between calls. */
export function clearPopulationCachesForTests(): void {
  cohortCache.clear();
  dayCache.clear();
  lastEventsKey = null;
  lastEvents = null;
}
