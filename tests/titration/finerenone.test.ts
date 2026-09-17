import { describe, it, expect } from 'vitest';
import { getPerDrugRecommendations, detectFinerenonePresence } from '@/lib/titration/engine';
import {
  FINERENONE_POTASSIUM_BANDS,
  FINERENONE_RESTART_RULE,
  FINERENONE_KEYWORDS,
  TITRATION_DECISIONS,
} from '@/lib/titration/constants';
import type { VitalSigns } from '@/lib/titration/types';

// ==========================================================================
// Finerenone is a separate titration path from the steroidal MRAs.
// The heart failure indication (LVEF >=40%) has four potassium bands and a
// restart rule that differ from both the spironolactone rule and the CKD/T2D
// finerenone indication.
// Source: KERENDIA label Table 3 and §2.3, DailyMed SPL
// fc726765-5d5a-4d6e-b037-b847bda9fb7c (rev. 8/2025).
// ==========================================================================

const NORMAL_VITALS: VitalSigns = { sbp: 120, hr: 70, potassium: 4.0, creatinine: 1.0, egfr: 60 };

function finerenoneFor(overrides: Partial<VitalSigns>) {
  return getPerDrugRecommendations({ ...NORMAL_VITALS, ...overrides }, ['Finerenone'])[0];
}

function mraFor(overrides: Partial<VitalSigns>) {
  return getPerDrugRecommendations({ ...NORMAL_VITALS, ...overrides }, ['MRA'])[0];
}

describe('FINERENONE_POTASSIUM_BANDS mirror label Table 3', () => {
  it('has four bands, including the >=6.0 band the app was missing', () => {
    expect(FINERENONE_POTASSIUM_BANDS).toHaveLength(4);
    expect(FINERENONE_POTASSIUM_BANDS.map((b) => b.action)).toEqual([
      'increase',
      'maintain',
      'reduce-one-step',
      'withhold',
    ]);
  });

  it('uses the label bounds: 5.0, 5.5 and 6.0', () => {
    expect(FINERENONE_POTASSIUM_BANDS[0].maxExclusive).toBe(5.0);
    expect(FINERENONE_POTASSIUM_BANDS[1].minInclusive).toBe(5.0);
    expect(FINERENONE_POTASSIUM_BANDS[1].maxExclusive).toBe(5.5);
    expect(FINERENONE_POTASSIUM_BANDS[2].minInclusive).toBe(5.5);
    expect(FINERENONE_POTASSIUM_BANDS[2].maxExclusive).toBe(6.0);
    expect(FINERENONE_POTASSIUM_BANDS[3].minInclusive).toBe(6.0);
    expect(FINERENONE_POTASSIUM_BANDS[3].maxExclusive).toBeNull();
  });

  it('withholds at 10 mg instead of reducing in the 5.5 to <6.0 band', () => {
    expect(FINERENONE_POTASSIUM_BANDS[2].instruction).toMatch(/40 mg to 20 mg/);
    expect(FINERENONE_POTASSIUM_BANDS[2].instruction).toMatch(/withhold if.*10 mg/i);
  });

  it('declares the restart rule, with the repeated-measurement exception', () => {
    expect(FINERENONE_RESTART_RULE).toMatch(/restart at 10 mg/i);
    expect(FINERENONE_RESTART_RULE).toMatch(/<5\.5/);
    expect(FINERENONE_RESTART_RULE).toMatch(/<5\.0/);
  });
});

describe('finerenone potassium boundaries (below / equal / above)', () => {
  it('K+ 4.9 leaves finerenone free to move toward target', () => {
    expect(finerenoneFor({ potassium: 4.9 }).action).toBe('uptitrate');
  });

  it('K+ exactly 5.0 maintains the dose, it does not reduce it', () => {
    const rec = finerenoneFor({ potassium: 5.0 });
    expect(rec.action).toBe('hold');
    expect(rec.reason).toMatch(/maintain/i);
  });

  it('K+ 5.4 maintains the dose', () => {
    expect(finerenoneFor({ potassium: 5.4 }).reason).toMatch(/maintain/i);
  });

  it('K+ exactly 5.5 reduces one step rather than withholding', () => {
    const rec = finerenoneFor({ potassium: 5.5 });
    expect(rec.action).toBe('reduce');
    expect(rec.reason).toMatch(/one step/i);
  });

  it('K+ 5.9 reduces one step', () => {
    expect(finerenoneFor({ potassium: 5.9 }).action).toBe('reduce');
  });

  it('K+ exactly 6.0 withholds', () => {
    const rec = finerenoneFor({ potassium: 6.0 });
    expect(rec.action).toBe('hold');
    expect(rec.reason).toMatch(/withhold/i);
  });

  it('K+ 6.5 withholds', () => {
    expect(finerenoneFor({ potassium: 6.5 }).reason).toMatch(/withhold/i);
  });

  it('does not treat 5.6 and 6.5 as the same situation', () => {
    expect(finerenoneFor({ potassium: 5.6 }).action).not.toBe(finerenoneFor({ potassium: 6.5 }).action);
  });
});

describe('the steroidal MRA rule is unchanged', () => {
  it('K+ 5.2 still holds the steroidal MRA', () => {
    const rec = mraFor({ potassium: 5.2 });
    expect(rec.action).toBe('hold');
    expect(rec.reason).toBe('K+ 5.0-5.5');
  });

  it('K+ 5.8 still holds the steroidal MRA', () => {
    expect(mraFor({ potassium: 5.8 }).action).toBe('hold');
  });
});

describe('finerenone renal boundary (eGFR 25)', () => {
  it('eGFR 24 holds finerenone: initiation is not recommended below 25', () => {
    const rec = finerenoneFor({ egfr: 24 });
    expect(rec.action).toBe('hold');
    expect(rec.reason).toMatch(/not recommended/i);
  });

  it('eGFR exactly 25 does not hold finerenone', () => {
    expect(finerenoneFor({ egfr: 25 }).action).not.toBe('hold');
  });

  it('eGFR 27 does not hold finerenone, although the steroidal MRA is held', () => {
    expect(finerenoneFor({ egfr: 27 }).action).not.toBe('hold');
    expect(mraFor({ egfr: 27 }).action).toBe('hold');
  });

  it('eGFR missing leaves the finerenone renal gate incomplete', () => {
    const rec = getPerDrugRecommendations(
      { sbp: 120, hr: 70, potassium: 4.0, creatinine: 1.0 },
      ['Finerenone'],
    )[0];
    expect(rec.action).toBe('not-applicable');
  });
});

describe('the decision table separates the two MRA paths', () => {
  it('row 5 no longer tells the prescriber to reduce finerenone at K+ 5.0-5.5', () => {
    expect(TITRATION_DECISIONS[4].action).not.toMatch(/Reduce MRA\/finerenone/);
    expect(TITRATION_DECISIONS[4].action).toMatch(/finerenone: maintain/i);
  });

  it('row 6 names the finerenone step-down and the >=6.0 withhold', () => {
    expect(TITRATION_DECISIONS[5].action).toMatch(/one step/i);
    expect(TITRATION_DECISIONS[5].action).toMatch(/6\.0/);
  });
});

describe('FINERENONE_KEYWORDS route the drug to its own class', () => {
  it('covers the generic name and the brand', () => {
    expect(FINERENONE_KEYWORDS).toContain('finerenone');
    expect(FINERENONE_KEYWORDS).toContain('kerendia');
  });

  it('detects finerenone in a free-text medication list', () => {
    expect(detectFinerenonePresence(['Kerendia 20mg daily'])).toBe(true);
    expect(detectFinerenonePresence(['Finerenone 10 mg'])).toBe(true);
  });

  it('does not classify a steroidal MRA as finerenone', () => {
    expect(detectFinerenonePresence(['Spironolactone 25mg', 'Eplerenone 50mg'])).toBe(false);
  });
});
