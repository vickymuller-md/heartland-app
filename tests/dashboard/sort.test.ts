/**
 * Patient List Sort Logic -- Tests
 * Requirements: DASH-02 (sort by status, vitals date, risk tier)
 * Source: HEARTLAND Protocol v3.3
 */

import { describe, it, expect } from 'vitest';
import { sortPatients } from '@/lib/dashboard/alert-engine';
import type { PatientWithStatus } from '@/lib/dashboard/types';

// ==========================================================================
// DASH-02: Patient list sort logic -- status priority, date, tier
// ==========================================================================

function makePatient(
  overrides: Partial<PatientWithStatus> & { id: string }
): PatientWithStatus {
  return {
    full_name: 'Test Patient',
    risk_tier: null,
    track_assignment: null,
    status: 'stable',
    open_alert_count: 0,
    last_vitals_at: null,
    latest_flags: null,
    setup_complete: true,
    ...overrides,
  };
}

describe('sortPatients', () => {
  it('status sort: critical first, then alert, then stable', () => {
    const patients = [
      makePatient({ id: '1', status: 'stable' }),
      makePatient({ id: '2', status: 'critical' }),
      makePatient({ id: '3', status: 'alert' }),
    ];

    const sorted = sortPatients(patients, 'status');
    expect(sorted.map((p) => p.id)).toEqual(['2', '3', '1']);
  });

  it('status sort: higher alert count first among same status', () => {
    const patients = [
      makePatient({ id: '1', status: 'critical', open_alert_count: 1 }),
      makePatient({ id: '2', status: 'critical', open_alert_count: 3 }),
    ];

    const sorted = sortPatients(patients, 'status');
    expect(sorted.map((p) => p.id)).toEqual(['2', '1']);
  });

  it('vitals_date sort: most recent first, null dates last', () => {
    const patients = [
      makePatient({ id: '1', last_vitals_at: null }),
      makePatient({ id: '2', last_vitals_at: '2026-03-25T10:00:00Z' }),
      makePatient({ id: '3', last_vitals_at: '2026-03-26T10:00:00Z' }),
    ];

    const sorted = sortPatients(patients, 'vitals_date');
    expect(sorted.map((p) => p.id)).toEqual(['3', '2', '1']);
  });

  it('risk_tier sort: high first, then moderate, then low, then null', () => {
    const patients = [
      makePatient({ id: '1', risk_tier: 'low' }),
      makePatient({ id: '2', risk_tier: null }),
      makePatient({ id: '3', risk_tier: 'high' }),
      makePatient({ id: '4', risk_tier: 'moderate' }),
    ];

    const sorted = sortPatients(patients, 'risk_tier');
    expect(sorted.map((p) => p.id)).toEqual(['3', '4', '1', '2']);
  });

  it('stable sort preserves order for equal values', () => {
    const patients = [
      makePatient({ id: '1', status: 'stable' }),
      makePatient({ id: '2', status: 'stable' }),
      makePatient({ id: '3', status: 'stable' }),
    ];

    const sorted = sortPatients(patients, 'status');
    expect(sorted.map((p) => p.id)).toEqual(['1', '2', '3']);
  });
});
