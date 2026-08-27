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
  /** Pre-generated synthetic narration (scripts/generate-outreach-audio.mts); scripted calls only. */
  audioSrc?: string;
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

function fixtureCall(input: Omit<SimulatedCallTranscript, 'channel' | 'redFlags' | 'disposition' | 'audioSrc'> & { patientId: string }): SimulatedCallTranscript {
  return {
    ...input,
    channel: 'automated-voice-simulation',
    audioSrc: `/outreach-audio/${input.id}.mp3`,
    ...evaluateFixture(input.patientId, input.extraction),
  };
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
      { speaker: 'assistant', text: "Good morning, Mrs. Santos — it's the daily check-in call from your heart care team. How are you doing today? Any chest pain since yesterday, or any—" },
      { speaker: 'patient', text: "Oh — no, no chest pain, dear. I'm just... so tired lately. Didn't sleep well again." },
      { speaker: 'assistant', text: "I'm sorry to hear that — and we'll get to the sleeping in just a second. Did you get a chance to step on the scale this morning?" },
      { speaker: 'patient', text: "The scale? Yes... hold on, let me find where I wrote it. My daughter got me one of those little notebooks... here it is — 179 and a half." },
      { speaker: 'assistant', text: "179 and a half, got it." },
      { speaker: 'patient', text: "It just keeps creeping up this week. And I haven't been eating any different, that's the thing." },
      { speaker: 'assistant', text: "That's exactly the kind of thing we want to know about. How's the breathing today — fine, short of breath when you're up and moving, or even at rest?" },
      { speaker: 'patient', text: "Well... I get winded just walking to the kitchen. And my ankles — I looked down this morning and they're all puffy again." },
      { speaker: 'assistant', text: "Okay. And last night — is that why the sleeping was bad? Did you need extra pillows, or to sit up to breathe?" },
      { speaker: 'patient', text: "I ended up in the recliner again. Second night in a row. The bed just... I can't breathe laying flat, you know?" },
      { speaker: 'assistant', text: "That's really helpful to know, thank you. Almost done — your medicines, were you able to take all of them, yesterday and today?" },
      { speaker: 'patient', text: "Oh yes, all of them. I never miss those — my daughter makes sure of it." },
      { speaker: 'assistant', text: "Good. Okay, Mrs. Santos, here's what happens now. Because of the weight change and the breathing, I'm flagging this for your care team right away — a nurse is going to call you back today, so keep the phone nearby. And if anything suddenly gets worse before that — chest pain, real trouble breathing — you call 911, alright?" },
      { speaker: 'patient', text: "Alright... I'll keep the phone close. Thank you, dear. Bye-bye now." },
      { speaker: 'assistant', text: "You take care, Mrs. Santos. Talk soon. Bye-bye." },
    ],
    extraction: MARIA_EXTRACTION,
  }),
  fixtureCall({
    id: 'call-james-stable',
    patientId: 'demo-james',
    patientName: 'James Walker',
    placedLabel: 'Today · 8:10 AM',
    turns: [
      { speaker: 'assistant', text: "Morning, Mr. Walker — daily check-in from your care team. Any chest pain or fainting since—" },
      { speaker: 'patient', text: "Nope. None of that. Feeling pretty good today, actually." },
      { speaker: 'assistant', text: "Well, that was fast. What did the scale say this morning?" },
      { speaker: 'patient', text: "Uh... 187.8. Right about where it's been all week. I wrote it on the calendar like the nurse showed me." },
      { speaker: 'assistant', text: "Steady is good. How about breathing, energy, any swelling?" },
      { speaker: 'patient', text: "Breathing's fine. Energy's — well, I mowed half the yard yesterday, so I'd call that normal. No swelling. Ankles look like ankles." },
      { speaker: 'assistant', text: "Half the yard, huh? Not bad at all. Last one — all your medicines, yesterday and today? And how's that new easy-open bottle working out?" },
      { speaker: 'patient', text: "Yep, all of 'em. And that cap the pharmacy sent over — works like a charm. Coffee first, pills second, same as always." },
      { speaker: 'assistant', text: "Glad that's sorted. That's everything I need, Mr. Walker — everything looks nice and steady today. Same time tomorrow?" },
      { speaker: 'patient', text: "I'll be here. You have a good one now. Bye." },
      { speaker: 'assistant', text: "You too, Mr. Walker. Bye now." },
    ],
    extraction: JAMES_STABLE_EXTRACTION,
    note: 'Day after the adherence barrier call: the pharmacy swapped the bottle for an easy-open cap and adherence is restored — the loop was closed by human follow-up.',
  }),
  fixtureCall({
    id: 'call-james-adherence',
    patientId: 'demo-james',
    patientName: 'James Walker',
    placedLabel: 'Yesterday · 8:05 AM',
    turns: [
      { speaker: 'assistant', text: "Morning, Mr. Walker — it's your care team's check-in call. Any chest pain or fainting since yesterday?" },
      { speaker: 'patient', text: "No... no, nothing like that." },
      { speaker: 'assistant', text: "Good. And the scale this morning?" },
      { speaker: 'patient', text: "188.2. Hang on — yeah, 188.2, I wrote it down." },
      { speaker: 'assistant', text: "Perfect. How are you feeling otherwise — breathing, swelling, energy?" },
      { speaker: 'patient', text: "Breathing's fine, no swelling... I'm dragging a little, though. More than usual." },
      { speaker: 'assistant', text: "Okay, noted. And the medicines — everything taken, yesterday and—" },
      { speaker: 'patient', text: "Well, now... I'll be honest with you. I missed the evening ones yesterday. That new bottle they gave me — I couldn't get the darn cap off. The arthritis, you know. Didn't want to bother anybody over a bottle cap." },
      { speaker: 'assistant', text: "You're not bothering anyone, Mr. Walker — that's exactly what this call is for. I'm noting it down, and someone from the team will get you a bottle you can actually open, today. Anything else before I let you go?" },
      { speaker: 'patient', text: "No, that'll do it. Thank you kindly. Bye now." },
      { speaker: 'assistant', text: "Take care, Mr. Walker. We'll check in tomorrow. Bye-bye." },
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
      { speaker: 'assistant', text: "Attempt 1, 9:00 AM — no answer after six rings. Voicemail left: \"Hi, this message is for Robert Lee — it's the daily check-in call from your heart care team. We missed you this morning. No emergency — please call us back at the clinic when you get a chance. Thank you.\"" },
      { speaker: 'assistant', text: "Attempt 2, 11:30 AM — no answer. Voicemail left: \"Mr. Lee, it's your care team calling again for your daily check-in. We'd like to hear how you're doing. Please call us back today.\" Per protocol, the missed outreach is now routed to a human coordinator — it is never silently dropped." },
    ],
    extraction: emptyExtraction(),
    redFlags: [],
    disposition: 'no_answer',
    note: 'No answer after 2 attempts — human outreach scheduled with the assigned coordinator (silence escalates; it never closes a loop).',
    audioSrc: '/outreach-audio/call-robert-noanswer.mp3',
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
