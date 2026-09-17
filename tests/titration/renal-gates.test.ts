import { describe, it, expect } from 'vitest';
import { evaluateSafetyGates, getPerDrugRecommendations } from '@/lib/titration/engine';
import { EGFR_GATES } from '@/lib/titration/constants';
import type { VitalSigns, DrugClass, SafetyGateStatus } from '@/lib/titration/types';

// ==========================================================================
// Renal gate boundaries (below / equal / above) at eGFR 20, 25 and 30.
// Every renal gate reads "requires eGFR >= MIN", so every comparison is
// `egfr < MIN` and the value exactly equal to MIN passes.
// Source: adjudication packet 2026-09-17, R2 (one operator per renal gate);
// dossier O2_ADJUDICACAO_3 B02-B05 and dossier O2_ADJUDICACAO_2 C1-C3.
// ==========================================================================

const NORMAL_VITALS: VitalSigns = { sbp: 120, hr: 70, potassium: 4.0, creatinine: 1.0, egfr: 60 };

function actionFor(drugClass: DrugClass, egfr: number): string {
  return getPerDrugRecommendations({ ...NORMAL_VITALS, egfr }, [drugClass])[0].action;
}

function panelStatusFor(egfr: number): SafetyGateStatus {
  const gate = evaluateSafetyGates({ ...NORMAL_VITALS, egfr }).find(
    (r) => r.parameter === 'eGFR (mL/min)',
  );
  return gate!.status;
}

function panelActionFor(egfr: number): string {
  const gate = evaluateSafetyGates({ ...NORMAL_VITALS, egfr }).find(
    (r) => r.parameter === 'eGFR (mL/min)',
  );
  return gate!.action;
}

describe('EGFR_GATES is the single declaration of every renal threshold', () => {
  it('exposes one minimum per rule, all with "requires eGFR >= MIN" semantics', () => {
    expect(EGFR_GATES.spironolactoneMin).toBe(30);
    expect(EGFR_GATES.finerenoneInitiationMin).toBe(25);
    expect(EGFR_GATES.sglt2iMin).toBe(20);
    expect(EGFR_GATES.arniHalfDoseMin).toBe(30);
  });

  it('declares no renal floor for ARNI — the label has none', () => {
    expect(EGFR_GATES).not.toHaveProperty('arniMin');
  });
});

describe('eGFR 30 boundary — steroidal MRA', () => {
  it('eGFR 29 holds the MRA', () => {
    expect(actionFor('MRA', 29)).toBe('hold');
  });

  it('eGFR exactly 30 does not hold the MRA (gate requires eGFR >= 30)', () => {
    expect(actionFor('MRA', 30)).not.toBe('hold');
  });

  it('eGFR 31 does not hold the MRA', () => {
    expect(actionFor('MRA', 31)).not.toBe('hold');
  });
});

describe('eGFR 25 boundary — finerenone initiation threshold on the panel', () => {
  it('eGFR 24 blocks the panel and names finerenone', () => {
    expect(panelStatusFor(24)).toBe('blocked');
    expect(panelActionFor(24)).toMatch(/finerenone/i);
  });

  it('eGFR exactly 25 no longer blocks on the finerenone threshold', () => {
    expect(panelActionFor(25)).not.toMatch(/HOLD finerenone/i);
  });

  it('eGFR 26 no longer blocks on the finerenone threshold', () => {
    expect(panelActionFor(26)).not.toMatch(/HOLD finerenone/i);
  });
});

describe('eGFR 20 boundary — SGLT2i and ARNI', () => {
  it('eGFR 19 holds SGLT2i', () => {
    expect(actionFor('SGLT2i', 19)).toBe('hold');
  });

  it('eGFR exactly 20 does not hold SGLT2i (gate requires eGFR >= 20)', () => {
    expect(actionFor('SGLT2i', 20)).not.toBe('hold');
  });

  it('eGFR 21 does not hold SGLT2i', () => {
    expect(actionFor('SGLT2i', 21)).not.toBe('hold');
  });

  it('eGFR 19 does not hold ARNI — ENTRESTO sets no renal floor', () => {
    expect(actionFor('ARNI', 19)).not.toBe('hold');
  });

  it('eGFR exactly 20 does not hold ARNI', () => {
    expect(actionFor('ARNI', 20)).not.toBe('hold');
  });

  it('eGFR 21 does not hold ARNI', () => {
    expect(actionFor('ARNI', 21)).not.toBe('hold');
  });
});

describe('eGFR 30 boundary — ARNI half dose (ENTRESTO label §2.7)', () => {
  it('eGFR 29 reduces the ARNI to half the usual dose', () => {
    expect(actionFor('ARNI', 29)).toBe('reduce');
  });

  it('eGFR exactly 30 does not reduce the ARNI for renal function', () => {
    expect(actionFor('ARNI', 30)).not.toBe('reduce');
  });

  it('eGFR 31 does not reduce the ARNI for renal function', () => {
    expect(actionFor('ARNI', 31)).not.toBe('reduce');
  });
});

describe('the safety-gate panel and the per-drug engine agree at the same eGFR', () => {
  it.each([20, 25, 30])(
    'eGFR %i: the panel blocks the MRA only when the per-drug engine holds it',
    (egfr) => {
      const panelHoldsMra = /hold MRA/i.test(panelActionFor(egfr));
      expect(panelHoldsMra).toBe(actionFor('MRA', egfr) === 'hold');
    },
  );

  it('eGFR exactly 30 passes the panel, matching the per-drug engine', () => {
    expect(panelStatusFor(30)).toBe('pass');
    expect(actionFor('MRA', 30)).not.toBe('hold');
  });
});
