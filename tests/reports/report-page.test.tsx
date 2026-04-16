/**
 * Report Page Smoke Tests -- REPT-01, REPT-02, REPT-04, REPT-05
 * Requirements: REPT-04 (Date Range), REPT-05 (Sidebar Link)
 * Source: HEARTLAND Protocol v3.3 -- Phase 21 Reports & Data Export
 *
 * Smoke tests for report page rendering, date range selector,
 * and sidebar navigation link. Uses file-content tests (fs.readFileSync)
 * for structural verification (consistent with Phase 11 pattern).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('REPT-05 sidebar Reports link', () => {
  it('provider-shell.tsx contains href for /reports', () => {
    const shellPath = path.resolve(
      __dirname,
      '../../app/(provider)/_components/provider-shell.tsx'
    );
    const content = readFileSync(shellPath, 'utf-8');
    // This test will fail RED since /reports is not yet in navItems
    expect(content).toContain("href: '/reports'");
  });
});

describe('REPT-04 DateRangePicker', () => {
  it.todo('preset "Last 30 days" sets from to today minus 30 days');
  it.todo('custom from/to inputs push URL searchParams on change');
});

describe('REPT-01 monthly report render', () => {
  it.todo('MonthlyReportPrint renders all metric sections');
});

describe('REPT-02 patient summary render', () => {
  it.todo('PatientSummaryPrint renders vitals, labs, education sections');
});
