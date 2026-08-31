/**
 * Guards the invariant behind the copilot engine tools: every display field a
 * persona shows (riskTier, ckmStage, track, facilityTier) must be reproducible
 * by running the registered deterministic engine over that persona's authored
 * raw inputs, and each pre-authored day must trigger exactly the red flags /
 * titration actions its arc narrative claims. Formatting drift is fixed by
 * adjusting formatters, never by loosening these asserts.
 */

import { describe, expect, it } from 'vitest';
import { classifyCkmStage } from '@/lib/ckm/engine';
import { evaluateReferralCriteria, evaluateDeviceCriteria } from '@/lib/comorbidity/engine';
import { computeFollowupDates } from '@/lib/discharge/engine';
import { assignTrack } from '@/lib/remote-monitoring/engine';
import { calculateRiskScore } from '@/lib/risk-score/engine';
import {
  activeDrugClassesFor,
  dayFor,
  dischargedAtFor,
  facilityAssessmentFor,
  formatCkmStageLabel,
  formatFacilityTierLabel,
  formatTrackLabel,
  redFlagInputsForDay,
  SANDBOX_DAY_COUNT,
  titrationVitalsForDay,
  vitalsForDay,
} from '@/lib/sandbox/day-selectors';
import { SANDBOX_PATIENTS } from '@/lib/sandbox/fixtures';
import { assessTier } from '@/lib/tier-selector/engine';
import { getPerDrugRecommendations, getTitrationAction } from '@/lib/titration/engine';
import { RED_FLAG_CRITERIA } from '@/lib/vitals/constants';
import { evaluateRedFlags } from '@/lib/vitals/red-flags';

const byId = (id: string) => {
  const patient = SANDBOX_PATIENTS.find((p) => p.id === id);
  if (!patient) throw new Error(`missing fixture ${id}`);
  return patient;
};

const maria = byId('demo-maria');
const james = byId('demo-james');
const robert = byId('demo-robert');

function redFlagIdsForDay(patient: (typeof SANDBOX_PATIENTS)[number], dayIndex: number): string[] | null {
  const inputs = redFlagInputsForDay(patient, dayIndex);
  if (!inputs) return null;
  return evaluateRedFlags(inputs.current, inputs.recentHistory, inputs.symptoms).map((flag) => flag.id);
}

describe('engine inputs reproduce the displayed outputs', () => {
  it.each(SANDBOX_PATIENTS.map((patient) => [patient.id, patient] as const))(
    '%s display fields match engine results',
    (_id, patient) => {
      expect(calculateRiskScore(patient.engineInputs.risk).tierLabel).toBe(patient.riskTier);
      expect(formatCkmStageLabel(classifyCkmStage(patient.engineInputs.ckm))).toBe(patient.ckmStage);
      expect(formatTrackLabel(assignTrack(patient.engineInputs.connectivity).track)).toBe(patient.track);
      expect(formatFacilityTierLabel(assessTier(facilityAssessmentFor(patient)).overallTier)).toBe(
        patient.facilityTier,
      );
    },
  );
});

describe('day arcs are structurally sound', () => {
  it.each(SANDBOX_PATIENTS.map((patient) => [patient.id, patient] as const))(
    '%s has 5 coherent days anchored on the legacy snapshot',
    (_id, patient) => {
      expect(patient.days).toHaveLength(SANDBOX_DAY_COUNT);
      patient.days.forEach((day, index) => {
        expect(day.dayIndex).toBe(index);
        expect(day.checkInReceived).toBe(day.vitals !== null);
        expect(day.checkInReceived).toBe(day.symptoms !== null);
      });
      // Day 1 must be the legacy "today": same chart on day 0, same latest point.
      expect(vitalsForDay(patient, 0)).toEqual(patient.vitals);
      const day0 = patient.days[0];
      if (day0.vitals) {
        expect(day0.vitals.weight).toBe(patient.vitals.at(-1)?.weight);
        expect(day0.vitals.sbp).toBe(patient.vitals.at(-1)?.sbp);
        expect(day0.vitals.heartRate).toBe(patient.vitals.at(-1)?.heartRate);
        expect(day0.vitals.spo2).toBe(patient.vitals.at(-1)?.spo2);
      }
    },
  );

  it('appends later day points to the vitals series', () => {
    expect(vitalsForDay(maria, 4)).toHaveLength(maria.vitals.length + 4);
    expect(vitalsForDay(robert, 4)).toHaveLength(robert.vitals.length + 4);
  });
});

describe('red flags per day match each arc narrative', () => {
  it('Maria trips the 5 lb / 7 day flag on day 2 only', () => {
    expect(redFlagIdsForDay(maria, 0)).toEqual([]);
    expect(redFlagIdsForDay(maria, 1)).toEqual([RED_FLAG_CRITERIA.weight_gain_5lb_7d.id]);
    expect(redFlagIdsForDay(maria, 2)).toEqual([]);
    expect(redFlagIdsForDay(maria, 3)).toEqual([]);
    expect(redFlagIdsForDay(maria, 4)).toEqual([]);
  });

  it('James stays flag-free across the arc', () => {
    for (let day = 0; day < SANDBOX_DAY_COUNT; day += 1) {
      expect(redFlagIdsForDay(james, day)).toEqual([]);
    }
  });

  it('Robert has no evaluable check-in on day 1, then stays flag-free', () => {
    expect(redFlagIdsForDay(robert, 0)).toBeNull();
    for (let day = 1; day < SANDBOX_DAY_COUNT; day += 1) {
      expect(redFlagIdsForDay(robert, day)).toEqual([]);
    }
  });
});

describe('titration engine per day matches each arc narrative', () => {
  it('Maria holds on day 3 for borderline potassium, MRA specifically', () => {
    const vitals = titrationVitalsForDay(maria, 2);
    expect(vitals).not.toBeNull();
    const action = getTitrationAction(vitals!);
    expect(action.action).toBe('hold');
    expect(action.details).toContain('K+ 5.0-5.5');
    const perDrug = getPerDrugRecommendations(vitals!, activeDrugClassesFor(maria));
    expect(perDrug.find((r) => r.drugClass === 'MRA')?.action).toBe('hold');
  });

  it('James clears numeric gates for uptitration on day 1', () => {
    const vitals = titrationVitalsForDay(james, 0);
    expect(getTitrationAction(vitals!).action).toBe('uptitrate');
  });

  it('Robert has no titration vitals on the missed check-in day', () => {
    expect(titrationVitalsForDay(robert, 0)).toBeNull();
  });
});

describe('comorbidity and discharge engines run on authored inputs', () => {
  it('evaluates referral and device pathways per persona', () => {
    expect(evaluateReferralCriteria(maria.engineInputs.comorbidity).result).toBe('monitor');
    expect(evaluateDeviceCriteria(maria.engineInputs.comorbidity).result).toBe('icd_only');
    expect(evaluateDeviceCriteria(james.engineInputs.comorbidity).result).toBe('monitor');
    expect(evaluateDeviceCriteria(robert.engineInputs.comorbidity).result).toBe('monitor');
  });

  it('James is exactly at the Day 7 follow-up milestone on day 1', () => {
    const dischargedAt = dischargedAtFor(james, 0);
    expect(dischargedAt).not.toBeNull();
    const schedule = computeFollowupDates(dischargedAt!, 1);
    expect(schedule).toHaveLength(5);
    const day7 = schedule.find((row) => row.type === 'visit_day7');
    const hoursFromNow = Math.abs(day7!.due_at.getTime() - Date.now()) / 3_600_000;
    expect(hoursFromNow).toBeLessThan(26);
    expect(dischargedAtFor(maria, 0)).toBeNull();
  });

  it('keeps day labels and follow-up context coherent', () => {
    expect(dayFor(james, 1).narrative).toContain('metoprolol');
    expect(dayFor(robert, 0).checkInReceived).toBe(false);
  });
});
