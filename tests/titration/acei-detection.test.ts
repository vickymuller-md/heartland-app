import { describe, it, expect } from 'vitest';

/**
 * SAFE-07: ACEi detection in medication list + washout warning
 *
 * RED state: lib/titration/acei.ts does not exist.
 * The import below will fail at module resolution, causing all tests to fail.
 */

import {
  detectAceiInMedications,
  detectArniInMedications,
  ACEI_DRUG_NAMES,
} from '@/lib/titration/acei';

describe('detectAceiInMedications -- SAFE-07', () => {
  it('returns true for lisinopril (case-insensitive)', () => {
    expect(
      detectAceiInMedications([{ name: 'Lisinopril 10mg' }]),
    ).toBe(true);
  });

  it('returns true for enalapril in mixed medication list', () => {
    expect(
      detectAceiInMedications([
        { name: 'enalapril 5mg' },
        { name: 'metoprolol 25mg' },
      ]),
    ).toBe(true);
  });

  it('returns true for ramipril', () => {
    expect(
      detectAceiInMedications([{ name: 'Ramipril 2.5mg' }]),
    ).toBe(true);
  });

  it('returns false when no ACEi present', () => {
    expect(
      detectAceiInMedications([
        { name: 'metoprolol 50mg' },
        { name: 'furosemide 40mg' },
        { name: 'carvedilol 12.5mg' },
      ]),
    ).toBe(false);
  });

  it('returns false for empty medication list', () => {
    expect(detectAceiInMedications([])).toBe(false);
  });

  it('ACEI_DRUG_NAMES exports at least 8 drug names', () => {
    expect(ACEI_DRUG_NAMES.length).toBeGreaterThanOrEqual(8);
  });

  it('ACEI_DRUG_NAMES includes common ACEi drugs', () => {
    const names = ACEI_DRUG_NAMES.map((n: string) => n.toLowerCase());
    expect(names).toContain('lisinopril');
    expect(names).toContain('enalapril');
    expect(names).toContain('ramipril');
    expect(names).toContain('captopril');
    expect(names).toContain('benazepril');
  });
});

describe('detectArniInMedications -- SAFE-07', () => {
  it('returns true for sacubitril/valsartan', () => {
    expect(
      detectArniInMedications([{ name: 'sacubitril/valsartan' }]),
    ).toBe(true);
  });

  it('returns true for Entresto (case-insensitive)', () => {
    expect(
      detectArniInMedications([{ name: 'Entresto 49/51mg' }]),
    ).toBe(true);
  });

  it('returns false when no ARNI present', () => {
    expect(
      detectArniInMedications([{ name: 'metoprolol 50mg' }]),
    ).toBe(false);
  });
});
