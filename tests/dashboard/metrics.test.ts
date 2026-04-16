/**
 * Dashboard Metrics -- Stub Tests (Wave 0)
 * Requirements: METR-01 (provider metrics), METR-02 (GDMT rate),
 *               METR-03 (RPM eligibility), METR-05 (billing summary)
 * Source: HEARTLAND Protocol v3.3
 */

import { describe, it } from 'vitest';

// These imports will fail until Plan 13-01 creates the modules
// Commented out to follow Phase 1/4/5/6/7/8/9/10 Wave 0 pattern
// import { getProviderMetrics } from '@/lib/dashboard/metrics-queries';
// import { computeGdmtRate } from '@/lib/dashboard/metrics-queries';
// import { getRpmEligiblePatients } from '@/lib/dashboard/metrics-queries';
// import { computeBillingSummary } from '@/lib/dashboard/metrics-queries';

describe('getProviderMetrics', () => {
  it.todo('METR-01: returns totalPatients, activeAlerts, noCheckinCount, avgAdherence for linked patients');
  it.todo('METR-01: returns EMPTY_METRICS when provider has no linked patients (no NaN, no crash)');
});

describe('gdmt rate (METR-02)', () => {
  it.todo('METR-02: classifyGdmt identifies ARNI, Beta-blocker, MRA, SGLT2i from medication name strings');
  it.todo('METR-02: computeGdmtRate returns 100% for patient with sacubitril + carvedilol + spironolactone + dapagliflozin');
  it.todo('METR-02: computeGdmtRate returns 0 and label "N/A" when no HFrEF patients are classified');
});

describe('RPM eligibility (METR-03)', () => {
  it.todo('METR-03: getRpmEligiblePatients returns patients with >= 16 distinct vitals days this calendar month');
  it.todo('METR-03: patient with 15 vitals days is NOT included in eligible list');
  it.todo('METR-03: vitals days counted as distinct calendar dates in UTC');
});

describe('billing summary (METR-05)', () => {
  it.todo('METR-05: computeBillingSummary returns { eligibleCount, lowEstimate, highEstimate } with correct arithmetic');
  it.todo('METR-05: lowEstimate = eligibleCount * 150, highEstimate = eligibleCount * 200');
});
