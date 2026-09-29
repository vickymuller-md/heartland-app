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
import { projectLabResults } from '@/lib/reports/lab-results';
import type { LabResultRow } from '@/lib/reports/types';

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

  it('exports projected wide results with exact collection time and blank unrecorded flag', () => {
    const original = '64000000-0000-4000-8000-000000000101';
    const patient = '64000000-0000-4000-8000-000000000011';
    const labs = projectLabResults((['potassium', 'creatinine'] as const).map((analyte, index) => ({
      id: `${original}:${analyte}`, original_lab_result_id: original, patient_id: patient,
      analyte, status: 'original', value: index === 0 ? '6.2' : '1.1', effective_lab_result_id: original,
      collected_at: '2025-08-01T09:15:00.123456-04:00', root_id: null, version_id: null, revision: null,
      notes: null, lab_facility: null, evaluation_status: null,
    })));
    const rows = buildLabsCSV(labs, { deidentify: false });
    expect(rows.slice(1).map((row) => row.slice(0, 6))).toEqual([
      [patient, 'Creatinine', '1.1', 'mg/dL', '2025-08-01T09:15:00.123456-04:00', ''],
      [patient, 'Potassium', '6.2', 'mEq/L', '2025-08-01T09:15:00.123456-04:00', ''],
    ]);
    expect(rows[1][13]).toBe(original);
    const reduced = buildLabsCSV(labs, { deidentify: true, patientMap: new Map([[patient, 'P001']]) });
    expect(reduced[1].slice(0, 6)).toEqual(['P001', 'Creatinine', '1.1', 'mg/dL', '2025', '']);
    expect(JSON.stringify(reduced)).not.toContain(original);
    expect(JSON.stringify(reduced)).not.toContain(patient);
    expect(reduced.slice(1).every((row) => row.slice(11).every((cell) => cell === ''))).toBe(true);
  });

  it('exports cancellation without value/flag and omits every provenance identifier when minimized', () => {
    const row: LabResultRow = { id: 'original:potassium', patient_id: 'patient', test_name: 'Potassium', value: '6.1',
      unit: 'mEq/L', collected_at: '2026-08-01T12:00:00.123456Z', flag: 'normal', source_status: 'cancelled',
      root_id: 'root', version_id: 'version', revision: '2', original_lab_result_id: 'original', effective_lab_result_id: null,
      evaluation_status: null, data_quality: 'cancelled', quality_reason: 'Cancelled source; reconcile.' };
    const exported = buildLabsCSV([row], { deidentify: false });
    expect(exported[1][2]).toBe(''); expect(exported[1][5]).toBe('');
    expect(exported[1][6]).toBe('cancelled'); expect(exported[1][7]).toBe('2');
    const minimized = buildLabsCSV([row], { deidentify: true, patientMap: new Map([['patient', 'P001']]) });
    expect(minimized[1].slice(11)).toEqual(['', '', '', '']);
    expect(minimized[1]).not.toContain(row.id);
  });
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

// ---------- REPT-08 Year-Only Date Reduction ----------

describe('REPT-08 year-only date reduction', () => {
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
      const labs: LabResultRow[] = [
        {
          id: 'lab-1',
          patient_id: 'uuid-1',
          test_name: 'BNP',
          value: '150',
          unit: 'pg/mL',
          collected_at: '2026-03-27T10:00:00Z',
          flag: 'normal' as const,
          source_status: 'original', root_id: null, version_id: null, revision: null,
          original_lab_result_id: 'lab-1', effective_lab_result_id: 'lab-1', evaluation_status: null,
          data_quality: 'recorded', quality_reason: 'Recorded source; suitability not assessed.',
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
