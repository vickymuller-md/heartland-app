/**
 * Report Query Tests -- REPT-01, REPT-02
 * Requirements: REPT-01 (Monthly Report), REPT-02 (Patient Summary)
 * Source: HEARTLAND Protocol v3.3 -- Phase 21 Reports & Data Export
 *
 * Tests query shape contracts for monthly report aggregation and
 * patient summary data retrieval. All imports point to
 * @/lib/reports/queries which does NOT exist yet.
 * Every test must fail RED (import error).
 */

import { describe, it, expect } from 'vitest';
import {
  getMonthlyReportData,
  getPatientSummaryData,
} from '@/lib/reports/queries';
import type {
  MonthlyReportData,
  PatientSummaryData,
} from '@/lib/reports/queries';

describe('REPT-01 getMonthlyReportData', () => {
  it('is a callable function', () => {
    // Ensures the import resolves -- will fail RED until lib/reports/queries.ts exists
    expect(typeof getMonthlyReportData).toBe('function');
  });

  it.todo('returns correct count of active patients for date range');
  it.todo('counts alerts generated in period by severity');
  it.todo('counts titration notes from provider_notes ILIKE [Titration]%');
  it.todo('calculates avgCheckInCompliance as % patients with >=16 vitals days');
});

describe('REPT-02 getPatientSummaryData', () => {
  it('is a callable function', () => {
    // Ensures the import resolves -- will fail RED until lib/reports/queries.ts exists
    expect(typeof getPatientSummaryData).toBe('function');
  });

  it.todo('returns vitals array ordered by recorded_at desc');
  it.todo('returns labs filtered by date range');
  it.todo('returns education progress per domain');
});
