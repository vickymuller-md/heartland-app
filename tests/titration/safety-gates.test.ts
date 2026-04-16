import { describe, it, expect } from 'vitest';
import { evaluateSafetyGates, canProceedPastSafetyGates, getTitrationAction } from '@/lib/titration/engine';
import type { VitalSigns } from '@/lib/titration/types';

const NORMAL_VITALS: VitalSigns = { sbp: 120, hr: 70, potassium: 4.0, creatinine: 1.0 };

// ==========================================================================
// TITR-02: Safety Gate Assessment
// Protocol v3.3 Module 3, Section 3.3
// ==========================================================================
describe('evaluateSafetyGates', () => {
  it('returns "pass" for all gates when vitals are normal (SBP=120, HR=70, K+=4.0, Cr=1.0)', () => {
    const results = evaluateSafetyGates(NORMAL_VITALS);
    expect(results).toHaveLength(5);
    results.forEach((r) => expect(r.status).toBe('pass'));
  });

  it('returns "blocked" for SBP gate when SBP < 90', () => {
    const results = evaluateSafetyGates({ ...NORMAL_VITALS, sbp: 85 });
    const gate = results.find((r) => r.parameter === 'Systolic Blood Pressure');
    expect(gate!.status).toBe('blocked');
  });

  it('returns "warning" for SBP gate when SBP is 90-99', () => {
    const results = evaluateSafetyGates({ ...NORMAL_VITALS, sbp: 95 });
    const gate = results.find((r) => r.parameter === 'Systolic Blood Pressure');
    expect(gate!.status).toBe('warning');
  });

  it('returns "blocked" for HR gate when HR < 50', () => {
    const results = evaluateSafetyGates({ ...NORMAL_VITALS, hr: 45 });
    const gate = results.find((r) => r.parameter === 'Heart Rate');
    expect(gate!.status).toBe('blocked');
  });

  it('returns "blocked" for K+ gate when potassium > 5.5', () => {
    const results = evaluateSafetyGates({ ...NORMAL_VITALS, potassium: 5.8 });
    const gate = results.find((r) => r.parameter === 'Potassium');
    expect(gate!.status).toBe('blocked');
  });

  it('returns "warning" for K+ gate when potassium is 5.0-5.5', () => {
    const results = evaluateSafetyGates({ ...NORMAL_VITALS, potassium: 5.2 });
    const gate = results.find((r) => r.parameter === 'Potassium');
    expect(gate!.status).toBe('warning');
  });

  it('returns "blocked" for Cr gate when creatinine increase > 30% from baseline', () => {
    const results = evaluateSafetyGates({ ...NORMAL_VITALS, creatinine: 1.5, creatinineBaseline: 1.0 });
    const gate = results.find((r) => r.parameter === 'Creatinine');
    expect(gate!.status).toBe('blocked');
  });

  it('returns "pass" for Cr gate when no baseline is provided', () => {
    const results = evaluateSafetyGates({ ...NORMAL_VITALS, creatinine: 2.0 });
    const gate = results.find((r) => r.parameter === 'Creatinine');
    expect(gate!.status).toBe('pass');
  });

  it('returns blocked action text: "REDUCE dose or hold; consider cardiology input" for SBP < 90', () => {
    const results = evaluateSafetyGates({ ...NORMAL_VITALS, sbp: 85 });
    const gate = results.find((r) => r.parameter === 'Systolic Blood Pressure');
    expect(gate!.action).toBe('REDUCE dose or hold; consider cardiology input');
  });

  it('returns blocked action text: "HOLD MRA/finerenone and ARNI; urgent recheck; dietary counseling" for K+ > 5.5', () => {
    const results = evaluateSafetyGates({ ...NORMAL_VITALS, potassium: 5.8 });
    const gate = results.find((r) => r.parameter === 'Potassium');
    expect(gate!.action).toBe('HOLD MRA/finerenone and ARNI; urgent recheck; dietary counseling');
  });
});

describe('canProceedPastSafetyGates', () => {
  it('returns true when all gates pass', () => {
    const results = evaluateSafetyGates(NORMAL_VITALS);
    expect(canProceedPastSafetyGates(results)).toBe(true);
  });

  it('returns false when any gate is blocked', () => {
    const results = evaluateSafetyGates({ ...NORMAL_VITALS, sbp: 85 });
    expect(canProceedPastSafetyGates(results)).toBe(false);
  });

  it('returns true when gates have warnings but no blocks', () => {
    const results = evaluateSafetyGates({ ...NORMAL_VITALS, sbp: 95, potassium: 5.2 });
    expect(canProceedPastSafetyGates(results)).toBe(true);
  });
});

// ==========================================================================
// getTitrationAction -- decision algorithm (TITR-05)
// Source: reference/clinical_content.md Section 3.3
// ==========================================================================
describe('getTitrationAction', () => {
  it('returns "uptitrate" when SBP >= 100 and vitals normal', () => {
    expect(getTitrationAction(NORMAL_VITALS).action).toBe('uptitrate');
  });

  it('returns "hold" when SBP 90-99', () => {
    expect(getTitrationAction({ ...NORMAL_VITALS, sbp: 95 }).action).toBe('hold');
  });

  it('returns "reduce" when SBP < 90', () => {
    expect(getTitrationAction({ ...NORMAL_VITALS, sbp: 85 }).action).toBe('reduce');
  });

  it('returns "reduce" when HR < 50 (beta-blocker concern)', () => {
    expect(getTitrationAction({ ...NORMAL_VITALS, hr: 45 }).action).toBe('reduce');
  });

  it('returns "hold" when K+ > 5.5', () => {
    expect(getTitrationAction({ ...NORMAL_VITALS, potassium: 5.8 }).action).toBe('hold');
  });

  it('returns "hold" when K+ 5.0-5.5', () => {
    expect(getTitrationAction({ ...NORMAL_VITALS, potassium: 5.2 }).action).toBe('hold');
  });

  it('returns "hold" when Cr increase > 30% from baseline', () => {
    expect(getTitrationAction({ ...NORMAL_VITALS, creatinine: 1.5, creatinineBaseline: 1.0 }).action).toBe('hold');
  });

  it('prioritizes most restrictive action (SBP < 90 over K+ 5.0-5.5)', () => {
    expect(getTitrationAction({ ...NORMAL_VITALS, sbp: 85, potassium: 5.2 }).action).toBe('reduce');
  });
});

// ==========================================================================
// eGFR Safety Gate (SAFE-03)
// Source: ACC/AHA 2022 HF Guidelines — renal safety thresholds
// ==========================================================================
describe('eGFR safety gate (SAFE-03)', () => {
  it('returns "pass" with advisory when eGFR is undefined (backward compat)', () => {
    const results = evaluateSafetyGates(NORMAL_VITALS);
    const gate = results.find((r) => r.parameter === 'eGFR (mL/min)');
    expect(gate).toBeDefined();
    expect(gate!.status).toBe('pass');
    expect(gate!.action).toBe('Enter eGFR for complete renal check');
  });

  it('returns "blocked" with HOLD SGLT2i + MRA + finerenone when eGFR < 20', () => {
    const results = evaluateSafetyGates({ ...NORMAL_VITALS, egfr: 18 });
    const gate = results.find((r) => r.parameter === 'eGFR (mL/min)');
    expect(gate!.status).toBe('blocked');
    expect(gate!.action).toMatch(/HOLD SGLT2i/);
    expect(gate!.action).toMatch(/hold MRA and finerenone/);
  });

  it('returns "blocked" with HOLD finerenone + MRA when eGFR 20-24', () => {
    const results = evaluateSafetyGates({ ...NORMAL_VITALS, egfr: 22 });
    const gate = results.find((r) => r.parameter === 'eGFR (mL/min)');
    expect(gate!.status).toBe('blocked');
    expect(gate!.action).toMatch(/HOLD finerenone/);
    expect(gate!.action).toMatch(/hold MRA/);
  });

  it('returns "blocked" with HOLD MRA (spironolactone) when eGFR 25-29', () => {
    const results = evaluateSafetyGates({ ...NORMAL_VITALS, egfr: 28 });
    const gate = results.find((r) => r.parameter === 'eGFR (mL/min)');
    expect(gate!.status).toBe('blocked');
    expect(gate!.action).toMatch(/HOLD MRA \(spironolactone\)/);
  });

  it('returns "pass" when eGFR >= 30', () => {
    const results = evaluateSafetyGates({ ...NORMAL_VITALS, egfr: 35 });
    const gate = results.find((r) => r.parameter === 'eGFR (mL/min)');
    expect(gate!.status).toBe('pass');
    expect(gate!.action).toBe('eGFR acceptable');
  });

  it('existing 4-gate tests still pass with egfr field absent', () => {
    // NORMAL_VITALS has no egfr -- the original 4 gates should still return pass
    const results = evaluateSafetyGates(NORMAL_VITALS);
    const nonEgfr = results.filter((r) => r.parameter !== 'eGFR (mL/min)');
    expect(nonEgfr).toHaveLength(4);
    nonEgfr.forEach((r) => expect(r.status).toBe('pass'));
  });
});
