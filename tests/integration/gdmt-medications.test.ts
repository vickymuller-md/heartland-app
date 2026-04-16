// INTG-05: GDMT selections optionally add to patient medication list
// Key: deduplication check required before INSERT
import { describe, it, expect } from 'vitest';
import { buildGdmtMedications } from '@/lib/integration/actions';
import type { GdmtMedicationInput } from '@/lib/integration/types';

describe('buildGdmtMedications (INTG-05)', () => {
  const selected: GdmtMedicationInput[] = [
    { name: 'Lisinopril', dosage: '5mg', frequency: 'daily' },
    { name: 'Metoprolol Succinate', dosage: '25mg', frequency: 'daily' },
    { name: 'Spironolactone', dosage: '25mg', frequency: 'daily' },
    { name: 'Empagliflozin', dosage: '10mg', frequency: 'daily' },
  ];

  it('returns all medications when none exist already', () => {
    const result = buildGdmtMedications(selected, []);
    expect(result).toHaveLength(4);
    expect(result.map(m => m.name)).toEqual([
      'Lisinopril', 'Metoprolol Succinate', 'Spironolactone', 'Empagliflozin',
    ]);
  });

  it('filters out drugs already in the existing medication list (deduplication)', () => {
    const existing = ['Lisinopril', 'Spironolactone'];
    const result = buildGdmtMedications(selected, existing);
    expect(result).toHaveLength(2);
    expect(result.map(m => m.name)).toEqual(['Metoprolol Succinate', 'Empagliflozin']);
  });

  it('deduplication is case-insensitive', () => {
    const existing = ['lisinopril', 'SPIRONOLACTONE'];
    const result = buildGdmtMedications(selected, existing);
    expect(result).toHaveLength(2);
    expect(result.map(m => m.name)).toEqual(['Metoprolol Succinate', 'Empagliflozin']);
  });

  it('returns empty array when all selected drugs already exist', () => {
    const existing = ['Lisinopril', 'Metoprolol Succinate', 'Spironolactone', 'Empagliflozin'];
    const result = buildGdmtMedications(selected, existing);
    expect(result).toHaveLength(0);
  });

  it('trims whitespace during comparison', () => {
    const existing = ['  Lisinopril  ', 'Spironolactone '];
    const result = buildGdmtMedications(selected, existing);
    expect(result).toHaveLength(2);
    expect(result.map(m => m.name)).toEqual(['Metoprolol Succinate', 'Empagliflozin']);
  });
});
