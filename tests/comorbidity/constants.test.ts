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
