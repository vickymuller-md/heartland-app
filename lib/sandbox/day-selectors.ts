/**
 * Day-aware selectors over the pre-authored 5-day sandbox arcs. Pure module:
 * copilot tools, UI, and the fixtures-consistency test all resolve a persona's
 * data for a given day through these functions, so a day can never be read
 * two different ways. Timestamps are synthesized relative to `now` because
 * fixtures store day offsets, never absolute dates.
 */

import { subDays } from 'date-fns';
import type { CkmStage } from '@/lib/ckm/types';
import type { TrackType } from '@/lib/remote-monitoring/types';
import { CATEGORY_DEFINITIONS } from '@/lib/tier-selector/constants';
import type { CategoryAssessment, TierLevel } from '@/lib/tier-selector/types';
import type { DrugClass, VitalSigns } from '@/lib/titration/types';
import type { SandboxDay, SandboxPatient, SandboxVitalPoint } from './types';

export const SANDBOX_DAY_COUNT = 5;

export function clampDayIndex(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.trunc(value), 0), SANDBOX_DAY_COUNT - 1);
}

export function dayFor(patient: SandboxPatient, dayIndex: number): SandboxDay {
  return patient.days[clampDayIndex(dayIndex)];
}

/** Vitals series visible on a given day: the legacy chart plus later day points. */
export function vitalsForDay(patient: SandboxPatient, dayIndex: number): SandboxVitalPoint[] {
  const clamped = clampDayIndex(dayIndex);
  if (clamped === 0) return patient.vitals;
  const laterPoints = patient.days
    .slice(1, clamped + 1)
    .map((day) => day.vitals)
    .filter((point): point is SandboxVitalPoint => point !== null);
  return [...patient.vitals, ...laterPoints];
}

/**
 * Weight history strictly BEFORE the given day, most recent first, with
 * timestamps synthesized relative to `now` — the shape evaluateRedFlags expects.
 */
export function weightHistoryForDay(
  patient: SandboxPatient,
  dayIndex: number,
  now: Date = new Date(),
): Array<{ weight_lbs: number; recorded_at: string }> {
  const clamped = clampDayIndex(dayIndex);
  const entries: Array<{ weightLbs: number; daysAgo: number }> = [];
  for (const point of patient.baselineHistory) {
    entries.push({ weightLbs: point.weightLbs, daysAgo: point.daysAgoAtD0 + clamped });
  }
  for (const day of patient.days.slice(0, clamped)) {
    if (day.vitals) entries.push({ weightLbs: day.vitals.weight, daysAgo: clamped - day.dayIndex });
  }
  return entries
    .sort((a, b) => a.daysAgo - b.daysAgo)
    .map((entry) => ({
      weight_lbs: entry.weightLbs,
      recorded_at: subDays(now, entry.daysAgo).toISOString(),
    }));
}

/** Inputs for evaluateRedFlags on a day, or null when no check-in reached the clinic. */
export function redFlagInputsForDay(
  patient: SandboxPatient,
  dayIndex: number,
  now: Date = new Date(),
): {
  current: { weight_lbs: number; sbp: number; spo2: number | null };
  recentHistory: Array<{ weight_lbs: number; recorded_at: string }>;
  symptoms: { dyspnea: number; edema: number; orthopnea: boolean; fatigue: number };
} | null {
  const day = dayFor(patient, dayIndex);
  if (!day.vitals || !day.symptoms) return null;
  return {
    current: { weight_lbs: day.vitals.weight, sbp: day.vitals.sbp, spo2: day.vitals.spo2 },
    recentHistory: weightHistoryForDay(patient, dayIndex, now),
    symptoms: {
      dyspnea: day.symptoms.dyspnea,
      edema: day.symptoms.edema,
      orthopnea: day.symptoms.orthopnea,
      fatigue: day.symptoms.fatigue,
    },
  };
}

/** VitalSigns for the titration engine on a day, or null when no check-in exists. */
export function titrationVitalsForDay(patient: SandboxPatient, dayIndex: number): VitalSigns | null {
  const day = dayFor(patient, dayIndex);
  if (!day.vitals) return null;
  return {
    sbp: day.vitals.sbp,
    hr: day.vitals.heartRate,
    potassium: day.labs.potassium.value,
    creatinine: day.labs.creatinine.value,
    creatinineBaseline: patient.engineInputs.creatinineBaselineMgDl,
    egfr: day.labs.egfr?.value,
  };
}

const THERAPY_CLASS_TO_DRUG_CLASS: Record<string, DrugClass> = {
  ARNI: 'ARNI',
  'Beta blocker': 'Beta-blocker',
  MRA: 'MRA',
  SGLT2i: 'SGLT2i',
  'Loop diuretic': 'Loop diuretic',
};

/** Persona drug classes covered by the per-drug titration engine (ACEi/ARB fall outside it). */
export function activeDrugClassesFor(patient: SandboxPatient): DrugClass[] {
  const classes = patient.medications
    .map((medication) => THERAPY_CLASS_TO_DRUG_CLASS[medication.therapyClass])
    .filter((drugClass): drugClass is DrugClass => drugClass !== undefined);
  return [...new Set(classes)];
}

/** Builds the 8 CategoryAssessment entries from authored levels + canonical definitions. */
export function facilityAssessmentFor(patient: SandboxPatient): CategoryAssessment[] {
  return CATEGORY_DEFINITIONS.map((definition) => {
    const selectedLevel = patient.engineInputs.facilityLevels[definition.id];
    if (selectedLevel === undefined) {
      throw new Error(`Missing facility level for category "${definition.id}" on ${patient.id}`);
    }
    return {
      categoryId: definition.id,
      categoryLabel: definition.label,
      selectedLevel,
      description: definition.levels[selectedLevel].description,
    };
  });
}

export function dischargedAtFor(
  patient: SandboxPatient,
  dayIndex: number,
  now: Date = new Date(),
): Date | null {
  const { dischargedDaysAgo } = patient.engineInputs;
  if (dischargedDaysAgo === null) return null;
  return subDays(now, dischargedDaysAgo + clampDayIndex(dayIndex));
}

const TRACK_LABELS: Record<TrackType, string> = {
  'track-a': 'Digital Track A',
  hybrid: 'Hybrid (Mixed)',
  'track-b': 'Analog Track B',
};

export function formatTrackLabel(track: TrackType): string {
  return TRACK_LABELS[track];
}

const FACILITY_TIER_LABELS: Record<TierLevel, string> = {
  1: 'Tier 1 · Minimal',
  2: 'Tier 2 · Standard',
  3: 'Tier 3 · Advanced',
};

export function formatFacilityTierLabel(level: TierLevel): string {
  return FACILITY_TIER_LABELS[level];
}

export function formatCkmStageLabel(stage: CkmStage): string {
  return `Stage ${stage}`;
}
