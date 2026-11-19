/**
 * NIW Traction Report Tests
 * Requirements: REPT-06 (NIW traction print page), REPT-07 (geographic choropleth)
 * Source: HEARTLAND Protocol v3.3 -- Phase 28 Reporting & NIW Evidence
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NiwTractionPrint } from '@/app/(provider)/reports/_components/niw-traction-print';
import { describe, it, expect } from 'vitest';
import type { NiwTractionData } from '@/lib/reports/types';
import { computeMonthlyGrowth } from '@/lib/reports/queries';

const data: NiwTractionData = {
  totalProviders: 5,
  totalPatients: 23,
  totalAlerts: 47,
  totalTitrations: 12,
  activeStates: ['California', 'Texas'],
  monthlyGrowth: [{ month: '2026-03', providers: 2, patients: 8 }],
  approvedAccessRequests: 5,
  pendingAccessRequests: 3,
  activeSandboxAccounts: 12,
  uniqueSandboxTesters30d: 10,
  sandboxViews30d: 15,
  sandboxFirstActions30d: 8,
  sandboxTaskCompletions30d: 19,
  sandboxActivationRate30d: 53,
  medianSandboxDurationSeconds: 142,
  campaignSources30d: [{ source: 'rural_health_outreach', sessions: 6 }],
};

describe('REPT-06 NiwTractionData type shape', () => {
  it('NiwTractionData has required fields', () => {
    expect(data.totalProviders).toBe(5);
    expect(data.approvedAccessRequests).toBe(5);
    expect(data.pendingAccessRequests).toBe(3);
    expect(data.uniqueSandboxTesters30d).toBe(10);
    expect(data.sandboxActivationRate30d).toBe(53);
    expect(data.campaignSources30d[0]).toEqual({ source: 'rural_health_outreach', sessions: 6 });
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
  const html = () => new DOMParser().parseFromString(renderToStaticMarkup(createElement(NiwTractionPrint, { data })), 'text/html');
  it('prints numeric evidence and monthly counts even when the report is hidden on screen', () => {
    const doc = html();
    expect(doc.body.textContent).toContain('5Provider profiles');
    expect(doc.body.textContent).toContain('23Patient profiles');
    expect(doc.body.textContent).toContain('Recorded alert rows');
    expect(doc.querySelector('tbody tr')?.textContent).toBe('2026-0328');
    expect(doc.querySelectorAll('tbody rect')).toHaveLength(2);
  });
  it('prints accessible state boundaries without fetching a map inside the print frame', () => {
    const map = html().querySelector('svg[role=img]')!;
    expect(map.querySelectorAll('path')).toHaveLength(51);
    const recorded = [...map.querySelectorAll('path')].filter(path => path.getAttribute('fill') === '#1e40af');
    expect(recorded.map(path => path.textContent)).toEqual(['California · State recorded', 'Texas · State recorded']);
    expect(map.querySelector('image,script')).toBeNull();
  });
});
