/**
 * The unified resolver must end the silent fall-back-to-Maria: a population
 * patientId resolves to the SAME deterministic chart the review queue was
 * built from, so an interactive call escalates for exactly the rule the queue
 * showed. Fixture ids and unparsable ids keep today's behavior.
 */

import { describe, expect, it } from 'vitest';
import { resolveCallPatient } from '@/lib/sandbox-ai/call-patient';
import { finalizeCheckIn } from '@/lib/sandbox-ai/engine';
import { finalizeTitration } from '@/lib/sandbox-ai/titration-script';
import type { CheckInState } from '@/lib/sandbox-ai/types';
import { getPopulationDayEvents, getPopulationPatientChart } from '@/lib/sandbox/population';

function stateFor(patientId: string, extraction: Partial<CheckInState['extraction']>, scriptId: CheckInState['scriptId'] = 'daily_checkin'): CheckInState {
  return {
    patientId,
    scriptId,
    locale: 'en',
    phase: 'complete',
    extraction: {
      weightLbs: null, sbp: null, spo2: null, dyspnea: null, edema: null,
      orthopnea: null, fatigue: null, adherence: null, chestPainOrSyncope: null,
      hr: null, dizziness: null, worseSymptoms: null,
      ...extraction,
    },
    reasksUsed: {},
    turnCount: 5,
  };
}

describe('resolveCallPatient', () => {
  it('keeps fixture ids and the legacy fallback for unparsable ids', () => {
    expect(resolveCallPatient('demo-james').name).toBe('James Walker');
    expect(resolveCallPatient('not-a-patient').name).toBe('Maria Santos');
  });

  it('resolves population ids to the deterministic chart, never Maria', () => {
    const chart = getPopulationPatientChart(42, 2);
    const resolved = resolveCallPatient('pop-42-d2');
    expect(resolved.name).toBe(chart.name);
    expect(resolved.name).not.toBe('Maria Santos');
    expect(resolved.vitals).toEqual(chart.vitals);
    expect(resolved.labs).toEqual(chart.labs);
  });
});

describe('population call escalates for the queue reason', () => {
  it('a weight-flagged patient reports the day weight and the SAME rule fires', () => {
    const flagged = getPopulationDayEvents(2500, 0).find((event) =>
      (event.category === 'critical' || event.category === 'warning') && event.ruleIds?.[0]?.startsWith('weight'))!;
    expect(flagged).toBeDefined();

    const result = finalizeCheckIn(stateFor(`pop-${flagged.ordinal}-d0`, {
      weightLbs: flagged.values!.weightLbs,
      sbp: flagged.values!.sbp,
      spo2: flagged.values!.spo2,
      dyspnea: 0, edema: 0, orthopnea: false, fatigue: 0,
      adherence: 'yes', chestPainOrSyncope: false,
    }));

    expect(result.disposition).toBe('escalated');
    expect(result.redFlags.map((flag) => flag.id)).toContain(flagged.ruleIds![0]);
  });

  it('a routine population patient closes routine', () => {
    const routine = getPopulationDayEvents(2500, 0).find((event) => event.category === 'routine')!;
    const chart = getPopulationPatientChart(routine.ordinal, 0);
    const today = chart.vitals.at(-1)!;
    const result = finalizeCheckIn(stateFor(`pop-${routine.ordinal}-d0`, {
      weightLbs: today.weight, sbp: today.sbp, spo2: today.spo2,
      dyspnea: 0, edema: 0, orthopnea: false, fatigue: 0,
      adherence: 'yes', chestPainOrSyncope: false,
    }));
    expect(result.disposition).toBe('routine');
  });

  it('the titration script runs on population labs without absurd gate trips', () => {
    const routine = getPopulationDayEvents(2500, 0).find((event) => event.category === 'routine')!;
    const result = finalizeTitration(stateFor(`pop-${routine.ordinal}-d0`, { sbp: 118, hr: 70 }, 'titration_followup'));
    expect(result.done).toBe(true);
    expect(result.disposition).not.toBe('emergency');
  });
});
