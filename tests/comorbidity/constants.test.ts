import { describe, it, expect } from 'vitest';
import { COMORBIDITY_DATA } from '@/lib/comorbidity/constants';
import type { ComorbidityKey } from '@/lib/comorbidity/types';

const EXPECTED_KEYS: ComorbidityKey[] = [
  'afib',
  'osa',
  'iron_deficiency',
  'diabetes',
  'ckd',
  'copd',
  'depression',
  'hypertension',
];

describe('COMORBIDITY_DATA constants (COMR-01)', () => {
  it('has exactly 8 entries', () => {
    expect(COMORBIDITY_DATA).toHaveLength(8);
  });

  it('all 8 expected keys present', () => {
    const keys = COMORBIDITY_DATA.map((d) => d.key);
    expect(keys).toEqual(expect.arrayContaining(EXPECTED_KEYS));
    expect(keys).toHaveLength(EXPECTED_KEYS.length);
  });

  it('each entry has a non-empty label string', () => {
    for (const entry of COMORBIDITY_DATA) {
      expect(entry.label).toBeTruthy();
      expect(typeof entry.label).toBe('string');
    }
  });

  it('each entry has a non-empty keyConsiderations string', () => {
    for (const entry of COMORBIDITY_DATA) {
      expect(entry.keyConsiderations).toBeTruthy();
      expect(typeof entry.keyConsiderations).toBe('string');
    }
  });

  it('each entry has a non-empty whatToDo string', () => {
    for (const entry of COMORBIDITY_DATA) {
      expect(entry.whatToDo).toBeTruthy();
      expect(typeof entry.whatToDo).toBe('string');
    }
  });
});

describe('COMORBIDITY_DATA GDMT interactions (COMR-02)', () => {
  it('each comorbidity has at least 1 gdmtInteractions entry', () => {
    for (const entry of COMORBIDITY_DATA) {
      expect(entry.gdmtInteractions.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('no gdmtInteractions entry is an empty string', () => {
    for (const entry of COMORBIDITY_DATA) {
      for (const interaction of entry.gdmtInteractions) {
        expect(interaction.trim()).not.toBe('');
      }
    }
  });
});

// ==========================================================================
// COMR-03: the CKD line follows the current FDA labels
// Source: adjudication packet 2026-09-17, F9 (ARNI renal rule)
// ==========================================================================
describe('COMORBIDITY_DATA CKD renal rules (COMR-03)', () => {
  const ckd = COMORBIDITY_DATA.find((d) => d.key === 'ckd')!;
  const lineStartingWith = (prefix: string) =>
    ckd.gdmtInteractions.find((i) => i.startsWith(prefix))!;

  it('ARNI: half dose below eGFR 30 and no renal floor (ENTRESTO label §2.7)', () => {
    const arni = lineStartingWith('ARNI');
    expect(arni).toMatch(/half/i);
    expect(arni).not.toMatch(/hold if eGFR <20/i);
  });

  it('MRA: carries the spironolactone eGFR 30-50 dose reduction (ALDACTONE §2.2)', () => {
    const mra = lineStartingWith('MRA');
    expect(mra).toMatch(/eGFR 30-50/);
    expect(mra).toMatch(/half the dose|25 mg every other day/i);
  });

  it('SGLT2i: per agent and per moment, with no minimum eGFR 20 (FARXIGA §2.3, JARDIANCE §2)', () => {
    const sglt2i = lineStartingWith('SGLT2i');
    expect(sglt2i).toMatch(/dapagliflozin/i);
    expect(sglt2i).toMatch(/empagliflozin/i);
    expect(sglt2i).not.toMatch(/minimum eGFR 20/i);
  });

  // F10: keep the 1-2 week recheck and add the 4-week label milestone, each
  // with its source (KERENDIA §2.3; 2022 AHA/ACC/HFSA p. e932).
  it('monitoring: keeps the 1-2 week recheck and names the 4-week finerenone lab', () => {
    const monitoring = lineStartingWith('Monitor BMP');
    expect(monitoring).toMatch(/1-2 weeks/);
    expect(monitoring).toMatch(/4 weeks/);
    expect(monitoring).toMatch(/KERENDIA/);
    expect(monitoring).toMatch(/2022 AHA\/ACC\/HFSA/);
  });
});
