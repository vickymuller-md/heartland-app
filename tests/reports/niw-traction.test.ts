/**
 * NIW Traction Report Tests
 * Requirements: REPT-06 (NIW traction print page), REPT-07 (geographic choropleth)
 * Source: HEARTLAND Protocol v3.3 -- Phase 28 Reporting & NIW Evidence
 */

import { describe, it, expect } from 'vitest';
import type { NiwTractionData } from '@/lib/reports/types';
import { computeMonthlyGrowth } from '@/lib/reports/queries';

describe('REPT-06 NiwTractionData type shape', () => {
  it('NiwTractionData has required fields', () => {
    const data: NiwTractionData = {
      totalProviders: 5,
      totalPatients: 23,
      totalAlerts: 47,
      totalTitrations: 12,
      activeStates: ['California', 'Texas'],
      monthlyGrowth: [{ month: '2026-03', providers: 2, patients: 8 }],
      approvedProviders: 5,
      pendingAccessRequests: 3,
    };
    expect(data.totalProviders).toBe(5);
    expect(data.approvedProviders).toBe(5);
    expect(data.pendingAccessRequests).toBe(3);
    expect(data.activeStates).toContain('California');
    expect(data.monthlyGrowth[0].month).toMatch(/^\d{4}-\d{2}$/);
  });
});

describe('REPT-06 computeMonthlyGrowth', () => {
  it('returns 12 months zero-filled', () => {
    const result = computeMonthlyGrowth([], []);
    expect(result).toHaveLength(12);
    result.forEach((entry) => {
      expect(entry.month).toMatch(/^\d{4}-\d{2}$/);
      expect(entry.providers).toBe(0);
      expect(entry.patients).toBe(0);
    });
  });

  it('counts rows matching each month', () => {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const providerRows = [
      { created_at: `${currentMonth}-01T00:00:00Z` },
      { created_at: `${currentMonth}-15T12:00:00Z` },
    ];
    const patientRows = [
      { created_at: `${currentMonth}-02T09:00:00Z` },
    ];
    const result = computeMonthlyGrowth(providerRows, patientRows);
    const currentEntry = result.find((e) => e.month === currentMonth);
    expect(currentEntry).toBeDefined();
    expect(currentEntry!.providers).toBe(2);
    expect(currentEntry!.patients).toBe(1);
  });

  it('months are ordered oldest to newest', () => {
    const result = computeMonthlyGrowth([], []);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].month > result[i - 1].month).toBe(true);
    }
  });
});

describe('REPT-06 NiwTractionPrint', () => {
  it.todo('renders cumulative stats from data');
  it.todo('renders UsStateMap with activeStates prop');
});
