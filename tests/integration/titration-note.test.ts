// INTG-04: Titration completion saved as structured provider_notes entry
// formatTitrationNote is a pure function -- test without Supabase mocking
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatTitrationNote } from '@/lib/integration/actions';
import type { TitrationNoteData } from '@/lib/integration/types';

// Mock date-fns format to return a predictable date
vi.mock('date-fns', () => ({
  format: vi.fn(() => '03/27/2026'),
}));

const baseTitrationData: TitrationNoteData = {
  vitals: { sbp: 120, hr: 72, potassium: 4.2, creatinine: 1.1 },
  safetyGateResults: [
    { parameter: 'SBP', status: 'pass' },
    { parameter: 'Potassium', status: 'pass' },
    { parameter: 'Creatinine', status: 'warning' },
  ],
  titrationAction: { action: 'uptitrate', details: 'Increase lisinopril to 20mg daily' },
  providerNotes: 'Patient tolerating well.',
  nextCallDate: '04/03/2026',
};

describe('formatTitrationNote (INTG-04)', () => {
  it('includes [TITRATION CHECKLIST -- date] header line', () => {
    const result = formatTitrationNote(baseTitrationData);
    expect(result).toContain('[TITRATION CHECKLIST');
    expect(result).toContain('03/27/2026');
  });

  it('includes SBP, HR, K+, Cr vitals in output', () => {
    const result = formatTitrationNote(baseTitrationData);
    expect(result).toContain('SBP 120');
    expect(result).toContain('HR 72');
    expect(result).toContain('K+ 4.2');
    expect(result).toContain('Cr 1.1');
  });

  it('includes all safety gate results as PASS/BLOCKED/WARNING', () => {
    const result = formatTitrationNote(baseTitrationData);
    expect(result).toContain('SBP: PASS');
    expect(result).toContain('Potassium: PASS');
    expect(result).toContain('Creatinine: WARNING');
  });

  it('includes titration action decision (UPTITRATE / HOLD / REDUCE)', () => {
    const result = formatTitrationNote(baseTitrationData);
    expect(result).toContain('UPTITRATE');
    expect(result).toContain('Increase lisinopril to 20mg daily');
  });

  it('includes provider notes when provided, omits when empty', () => {
    const result = formatTitrationNote(baseTitrationData);
    expect(result).toContain('Notes: Patient tolerating well.');

    const noNotes = formatTitrationNote({ ...baseTitrationData, providerNotes: '' });
    expect(noNotes).not.toContain('Notes:');
  });

  it('rejects provider text over the explicit limit rather than silently truncating it', () => {
    const longData: TitrationNoteData = {
      ...baseTitrationData,
      providerNotes: 'A'.repeat(4000),
    };
    expect(() => formatTitrationNote(longData)).toThrow(/2,000/);
  });

  it('preserves all2000 allowed characters when the whole note fits', () => {
    const longData: TitrationNoteData = {
      ...baseTitrationData,
      providerNotes: 'B'.repeat(2000),
    };
    const result = formatTitrationNote(longData);
    // The notes section should not contain more than 2000 Bs
    const notesLine = result.split('\n').find(l => l.startsWith('Notes:'));
    expect(notesLine).toBeDefined();
    // "Notes: " is 7 chars, so the B content should be at most 2000
    const bCount = (notesLine?.match(/B/g) ?? []).length;
    expect(bCount).toBe(2000);
  });

  it('shows N/A for null potassium and creatinine', () => {
    const data: TitrationNoteData = {
      ...baseTitrationData,
      vitals: { sbp: 110, hr: 80, potassium: null, creatinine: null },
    };
    const result = formatTitrationNote(data);
    expect(result).toContain('K+ N/A');
    expect(result).toContain('Cr N/A');
  });

  it('includes next call date when provided', () => {
    const result = formatTitrationNote(baseTitrationData);
    expect(result).toContain('Next call: 04/03/2026');
  });

  it('omits next call date line when not provided', () => {
    const data: TitrationNoteData = { ...baseTitrationData, nextCallDate: '' };
    const result = formatTitrationNote(data);
    expect(result).not.toContain('Next call:');
  });
  it('does not silently discard a required justification near the5000-character boundary', () => {
    const minimal = { ...baseTitrationData, providerNotes: '', symptomsReported: '' };
    const fixedLength = formatTitrationNote(minimal).length;
    // The formatter alone is also guarded, even before action-schema bounds are considered.
    const nearlyFull = { ...minimal, symptomsReported: 'S'.repeat(4999 - fixedLength - 'Symptoms: '.length - 1) };
    expect(formatTitrationNote(nearlyFull)).toHaveLength(4999);
    expect(() => formatTitrationNote({ ...nearlyFull, providerNotes: 'Required justification' })).toThrow(/complete note/);
  });
});
