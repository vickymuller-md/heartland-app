/**
 * Sandbox AI-Assisted Outreach -- Simulated Call Transcripts & Live-Call Scenarios
 *
 * Pre-generated transcripts keep the provider-side demonstration stable and
 * offline-capable (PWA). Red flags and dispositions are COMPUTED at module
 * load through the same deterministic engine used everywhere else, so the
 * fixtures can never drift from the registered clinical rules.
 */

import { subDays } from 'date-fns';
import { RED_FLAG_CRITERIA } from '@/lib/vitals/constants';
import { evaluateRedFlags } from '@/lib/vitals/red-flags';
import { SANDBOX_PATIENTS } from '@/lib/sandbox/fixtures';
import type { AiOutreachRun } from '@/lib/sandbox/types';
import type { RedFlag } from '@/lib/vitals/types';
import { emptyExtraction, syntheticWeightHistory } from './engine';
import type { CheckInDisposition, CheckInExtraction } from './types';

export interface SimulatedCallTranscript {
  id: string;
  /** SandboxPatient id when the call belongs to a tour patient; null for live personas. */
  patientId: string | null;
  patientName: string;
  channel: 'automated-voice-simulation';
  placedLabel: string;
  turns: Array<{ speaker: 'assistant' | 'patient'; text: string }>;
  extraction: CheckInExtraction;
  redFlags: RedFlag[];
  disposition: CheckInDisposition | 'no_answer';
  note?: string;
}

function patientById(id: string) {
  const patient = SANDBOX_PATIENTS.find((entry) => entry.id === id);
  if (!patient) throw new Error(`Unknown sandbox patient fixture: ${id}`);
  return patient;
}

/** Disposition derives from the deterministic rules alone (§1 of the AI plan). */
function evaluateFixture(patientId: string, extraction: CheckInExtraction): {
  redFlags: RedFlag[];
  disposition: CheckInDisposition;
} {
  const patient = patientById(patientId);
  const lastSynthetic = patient.vitals.at(-1);
  if (extraction.chestPainOrSyncope === true) return { redFlags: [], disposition: 'emergency' };
  const redFlags = evaluateRedFlags(
    {
      weight_lbs: extraction.weightLbs ?? lastSynthetic?.weight ?? 0,
      sbp: extraction.sbp ?? lastSynthetic?.sbp ?? 0,
      spo2: extraction.spo2,
    },
    syntheticWeightHistory(patient),
    {
      dyspnea: extraction.dyspnea ?? 0,
      edema: extraction.edema ?? 0,
      orthopnea: extraction.orthopnea ?? false,
      fatigue: extraction.fatigue ?? 0,
    },
  );
  return { redFlags, disposition: redFlags.length > 0 ? 'escalated' : 'routine' };
}

function fixtureCall(input: Omit<SimulatedCallTranscript, 'channel' | 'redFlags' | 'disposition'> & { patientId: string }): SimulatedCallTranscript {
  return { ...input, channel: 'automated-voice-simulation', ...evaluateFixture(input.patientId, input.extraction) };
}

const MARIA_EXTRACTION: CheckInExtraction = {
  ...emptyExtraction(),
  weightLbs: 179.5, dyspnea: 2, edema: 2, orthopnea: true, fatigue: 2,
  adherence: 'yes', chestPainOrSyncope: false,
};

const JAMES_STABLE_EXTRACTION: CheckInExtraction = {
  ...emptyExtraction(),
  weightLbs: 187.8, dyspnea: 0, edema: 0, orthopnea: false, fatigue: 0,
  adherence: 'yes', chestPainOrSyncope: false,
};

const JAMES_ADHERENCE_EXTRACTION: CheckInExtraction = {
  ...emptyExtraction(),
  weightLbs: 188.2, dyspnea: 0, edema: 0, orthopnea: false, fatigue: 1,
  adherence: 'missed_some', chestPainOrSyncope: false,
};

export const OUTREACH_TRANSCRIPTS: SimulatedCallTranscript[] = [
  fixtureCall({
    id: 'call-maria-redflag',
    patientId: 'demo-maria',
    patientName: 'Maria Santos',
    placedLabel: 'Today · 7:45 AM',
    turns: [
      { speaker: 'assistant', text: 'Good morning, this is the automated daily check-in from your heart care team. Any chest pain, or have you fainted since yesterday?' },
      { speaker: 'patient', text: 'No chest pain, no. Just tired.' },
      { speaker: 'assistant', text: 'Thank you. What did the scale show this morning, in pounds?' },
      { speaker: 'patient', text: 'It said 179 and a half. It keeps going up this week.' },
      { speaker: 'assistant', text: 'Got it, 179.5. How is your breathing today — fine, short of breath with activity, or even at rest?' },
      { speaker: 'patient', text: 'I get winded walking to the kitchen, and my ankles look puffier.' },
      { speaker: 'assistant', text: 'Thank you for telling me. Did you need extra pillows to breathe while sleeping last night?' },
      { speaker: 'patient', text: 'Yes, I slept in the recliner again.' },
      { speaker: 'assistant', text: 'And were you able to take all of your medicines yesterday and today?' },
      { speaker: 'patient', text: 'Yes, all of them, same as always.' },
    ],
    extraction: MARIA_EXTRACTION,
  }),
  fixtureCall({
    id: 'call-james-stable',
    patientId: 'demo-james',
    patientName: 'James Walker',
    placedLabel: 'Today · 8:10 AM',
    turns: [
      { speaker: 'assistant', text: 'Good morning, this is your care team’s automated check-in. Any chest pain or fainting since yesterday?' },
      { speaker: 'patient', text: 'Nope, feeling pretty good.' },
      { speaker: 'assistant', text: 'Great. What did the scale show this morning?' },
      { speaker: 'patient', text: '187.8, about the same as yesterday.' },
      { speaker: 'assistant', text: 'How is your breathing and energy today?' },
      { speaker: 'patient', text: 'Breathing fine, energy is normal. No swelling either.' },
      { speaker: 'assistant', text: 'Were you able to take all of your medicines?' },
      { speaker: 'patient', text: 'Yes, all taken with breakfast.' },
    ],
    extraction: JAMES_STABLE_EXTRACTION,
  }),
  fixtureCall({
    id: 'call-james-adherence',
    patientId: 'demo-james',
    patientName: 'James Walker',
    placedLabel: 'Yesterday · 8:05 AM',
    turns: [
      { speaker: 'assistant', text: 'Good morning, this is your care team’s automated check-in. Any chest pain or fainting since yesterday?' },
      { speaker: 'patient', text: 'No, nothing like that.' },
      { speaker: 'assistant', text: 'What did the scale show this morning?' },
      { speaker: 'patient', text: '188.2.' },
      { speaker: 'assistant', text: 'How are breathing, swelling, and energy today?' },
      { speaker: 'patient', text: 'Breathing is fine, no swelling. A little more tired than usual.' },
      { speaker: 'assistant', text: 'Were you able to take all of your medicines yesterday and today?' },
      { speaker: 'patient', text: 'I missed the evening ones yesterday — the new bottle was hard to open.' },
    ],
    extraction: JAMES_ADHERENCE_EXTRACTION,
    note: 'Adherence barrier reported (missed evening doses); pharmacist follow-up suggested by workflow, decision stays with the care team.',
  }),
  {
    id: 'call-robert-noanswer',
    patientId: 'demo-robert',
    patientName: 'Robert Lee',
    channel: 'automated-voice-simulation',
    placedLabel: 'Today · 9:00 AM and 11:30 AM',
    turns: [
      { speaker: 'assistant', text: 'Attempt 1 (9:00 AM): call placed to the number on file — no answer after six rings. Voicemail message left identifying the care team and asking for a call back.' },
      { speaker: 'assistant', text: 'Attempt 2 (11:30 AM): call placed again — no answer. Per protocol, missed automated outreach is routed to a human coordinator; it is never silently dropped.' },
    ],
    extraction: emptyExtraction(),
    redFlags: [],
    disposition: 'no_answer',
    note: 'No answer after 2 attempts — human outreach scheduled with the assigned coordinator (silence escalates; it never closes a loop).',
  },
];

// ── Live simulated-call personas (server picks one at random) ─────────────

export interface SimulatedCallScenario {
  id: string;
  patientName: string;
  profile: string;
  baselineSbp: number;
  /** Most recent first; mirrors the shape of syntheticWeightHistory output. */
  weightHistory: Array<{ daysAgo: number; weight_lbs: number }>;
}

export const SIMULATED_CALL_SCENARIOS: SimulatedCallScenario[] = [
  {
    id: 'scenario-stable-elder',
    patientName: 'Dorothy Mills (synthetic)',
    profile: 'A 76-year-old with stable chronic heart failure, analog track, feeling well today; weight steady around 152 lbs; answers briefly and cheerfully.',
    baselineSbp: 128,
    weightHistory: [
      { daysAgo: 1, weight_lbs: 152.1 }, { daysAgo: 2, weight_lbs: 152.4 },
      { daysAgo: 3, weight_lbs: 151.9 }, { daysAgo: 5, weight_lbs: 152.0 },
    ],
  },
  {
    id: 'scenario-weight-gain',
    patientName: 'Earl Hutchins (synthetic)',
    profile: 'A 69-year-old post-discharge, digital track; scale shows about 4 pounds up versus two days ago (around 214 lbs today), breathing slightly harder with activity, mild new ankle swelling; cooperative but worried.',
    baselineSbp: 118,
    // The 2-day red-flag window is exclusive at its boundary, so the gain must
    // be visible against yesterday's reading for the rule to fire on ~214 lbs.
    weightHistory: [
      { daysAgo: 1, weight_lbs: 210.2 }, { daysAgo: 2, weight_lbs: 209.9 },
      { daysAgo: 4, weight_lbs: 209.6 }, { daysAgo: 6, weight_lbs: 209.4 },
    ],
  },
  {
    id: 'scenario-adherence-barrier',
    patientName: 'Gloria Vance (synthetic)',
    profile: 'A 72-year-old on a fixed income, hybrid track; feeling okay, weight steady around 168 lbs, but stopped one of her medicines three days ago because the refill was too expensive; slightly embarrassed to mention it.',
    baselineSbp: 132,
    weightHistory: [
      { daysAgo: 1, weight_lbs: 168.3 }, { daysAgo: 2, weight_lbs: 168.0 },
      { daysAgo: 4, weight_lbs: 167.8 }, { daysAgo: 7, weight_lbs: 168.1 },
    ],
  },
];

export function scenarioWeightHistory(scenario: SimulatedCallScenario): Array<{ weight_lbs: number; recorded_at: string }> {
  const now = new Date();
  return [...scenario.weightHistory]
    .sort((a, b) => a.daysAgo - b.daysAgo)
    .map((entry) => ({ weight_lbs: entry.weight_lbs, recorded_at: subDays(now, entry.daysAgo).toISOString() }));
}

// ── Work items shown in the provider Daily Loop ───────────────────────────

export interface OutreachWorkItem {
  id: string;
  patientName: string;
  disposition: SimulatedCallTranscript['disposition'];
  redFlagMessages: string[];
  atLabel: string;
  note?: string;
}

/** Live runs first (metadata persisted in the demo state), then the stable fixtures. */
export function outreachWorkItems(runs: AiOutreachRun[]): OutreachWorkItem[] {
  const criteria = RED_FLAG_CRITERIA as Record<string, { message: string }>;
  return [
    ...runs.map((run) => ({
      id: run.id,
      patientName: run.patientName,
      disposition: run.disposition,
      redFlagMessages: run.redFlagIds.map((id) => criteria[id]?.message ?? id),
      atLabel: run.atLabel,
    })),
    ...OUTREACH_TRANSCRIPTS.map((transcript) => ({
      id: transcript.id,
      patientName: transcript.patientName,
      disposition: transcript.disposition,
      redFlagMessages: transcript.redFlags.map((flag) => flag.message),
      atLabel: transcript.placedLabel,
      note: transcript.note,
    })),
  ];
}
