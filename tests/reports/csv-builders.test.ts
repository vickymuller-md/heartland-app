/**
 * CSV Builder Tests -- REPT-03
 * Requirements: REPT-03 (CSV export with RFC 4180 quoting and de-identification)
 * Source: HEARTLAND Protocol v3.3 -- Phase 21 Reports & Data Export
 *
 * Tests CSV builder functions for vitals, labs, and medications export.
 * All imports point to @/lib/reports/csv-builders which does NOT exist yet.
 * Every test must fail RED (import error).
 */

import { describe, it, expect } from 'vitest';
import {
  arrayToCSV,
  buildVitalsCSV,
  buildLabsCSV,
  buildMedsCSV,
  truncateToYear,
} from '@/lib/reports/csv-builders';

describe('REPT-03 downloadCSV / arrayToCSV', () => {
  it('wraps each cell in double quotes per RFC 4180', () => {
    const rows = [['name,comma', 'say "hi"']];
    const result = arrayToCSV(rows);
    expect(result).toContain('"name,comma","say ""hi"""');
  });

  it('escapes internal double quotes by doubling them', () => {
    const rows = [['value with "quotes" inside']];
    const result = arrayToCSV(rows);
    expect(result).toContain('"value with ""quotes"" inside"');
  });

  it('handles null and undefined cells as empty string', () => {
    const rows = [['value', null, undefined]];
    const result = arrayToCSV(rows as unknown as string[][]);
    expect(result).toContain('"value","",""');
  });
});

describe('REPT-03 buildVitalsCSV', () => {
  it('returns header row with correct column names', () => {
    const result = buildVitalsCSV([], { deidentify: false });
    expect(result[0]).toEqual([
      'patient_id',
      'recorded_at',
      'weight_lbs',
      'sbp',
      'dbp',
      'heart_rate',
      'spo2',
    ]);
  });

  it('replaces patient_id with token from patientMap when deidentify is true', () => {
    const vitals = [
      {
        patient_id: 'uuid-1',
        recorded_at: '2026-01-01',
        weight_lbs: 180,
        sbp: 120,
        dbp: 80,
        heart_rate: 72,
        spo2: 98,
      },
    ];
    const result = buildVitalsCSV(vitals, {
      deidentify: true,
      patientMap: new Map([['uuid-1', 'P001']]),
    });
    // First data row (index 1) should start with de-identified token
    expect(result[1][0]).toBe('P001');
  });
});

describe('REPT-03 buildLabsCSV', () => {
  it('returns header row with lab-specific columns', () => {
    const result = buildLabsCSV([], { deidentify: false });
    const headers = result[0];
    expect(headers).toContain('patient_id');
    expect(headers).toContain('test_name');
    expect(headers).toContain('value');
    expect(headers).toContain('unit');
    expect(headers).toContain('collected_at');
  });

  it.todo('returns correct data row shape once lab query is defined');
});

describe('REPT-03 buildMedsCSV', () => {
  it('returns header row with medication-specific columns', () => {
    const result = buildMedsCSV([], { deidentify: false });
    const headers = result[0];
    expect(headers).toContain('patient_id');
    expect(headers).toContain('medication_name');
    expect(headers).toContain('dose');
    expect(headers).toContain('frequency');
    expect(headers).toContain('taken_at');
  });

  it.todo('returns correct data row shape once medication query is defined');
});

// ---------- REPT-08 HIPAA Safe Harbor Date Truncation ----------

describe('REPT-08 HIPAA Safe Harbor date truncation', () => {
  describe('truncateToYear', () => {
    it('truncates ISO timestamp to year-only', () => {
      expect(truncateToYear('2026-03-27T14:30:00Z')).toBe('2026');
    });

    it('truncates date string to year-only', () => {
      expect(truncateToYear('2026-03-27')).toBe('2026');
    });

    it('returns empty string for null', () => {
      expect(truncateToYear(null)).toBe('');
    });

    it('returns empty string for undefined', () => {
      expect(truncateToYear(undefined)).toBe('');
    });
  });

  describe('buildVitalsCSV with deidentify:true', () => {
    it('shows year-only in recorded_at column', () => {
      const vitals = [
        {
          patient_id: 'uuid-1',
          recorded_at: '2026-03-27T14:30:00Z',
          weight_lbs: 180,
          sbp: 120,
          dbp: 80,
          heart_rate: 72,
          spo2: 98,
        },
      ];
      const result = buildVitalsCSV(vitals, {
        deidentify: true,
        patientMap: new Map([['uuid-1', 'P001']]),
      });
      // recorded_at is column index 1
      expect(result[1][1]).toBe('2026');
    });

    it('retains full timestamp when deidentify is false', () => {
      const vitals = [
        {
          patient_id: 'uuid-1',
          recorded_at: '2026-03-27T14:30:00Z',
          weight_lbs: 180,
          sbp: 120,
          dbp: 80,
          heart_rate: 72,
          spo2: 98,
        },
      ];
      const result = buildVitalsCSV(vitals, { deidentify: false });
      expect(result[1][1]).toBe('2026-03-27T14:30:00Z');
    });
  });

  describe('buildLabsCSV with deidentify:true', () => {
    it('shows year-only in collected_at column', () => {
      const labs = [
        {
          id: 'lab-1',
          patient_id: 'uuid-1',
          test_name: 'BNP',
          value: 150,
          unit: 'pg/mL',
          collected_at: '2026-03-27T10:00:00Z',
          flag: 'normal' as const,
        },
      ];
      const result = buildLabsCSV(labs, {
        deidentify: true,
        patientMap: new Map([['uuid-1', 'P001']]),
      });
      // collected_at is column index 4
      expect(result[1][4]).toBe('2026');
    });
  });

  describe('buildMedsCSV with deidentify:true', () => {
    it('shows year-only in taken_at column', () => {
      const meds = [
        {
          patient_id: 'uuid-1',
          medication_name: 'Carvedilol',
          dose: '6.25mg',
          frequency: 'BID',
          taken_at: '2026-03-27T08:00:00Z',
          taken: true,
        },
      ];
      const result = buildMedsCSV(meds, {
        deidentify: true,
        patientMap: new Map([['uuid-1', 'P001']]),
      });
      // taken_at is column index 4
      expect(result[1][4]).toBe('2026');
    });
  });
});
