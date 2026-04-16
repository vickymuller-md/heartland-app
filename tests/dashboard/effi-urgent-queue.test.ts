// EFFI-01: Dashboard "Urgent Now" section
// Tests for filterUrgentPatients pure function
// Implementation in: app/(provider)/dashboard/_components/urgent-now-section.tsx (exported util)

import { describe, it, expect } from 'vitest';
import { filterUrgentPatients } from '@/app/(provider)/dashboard/_components/urgent-now-section';
import type { PatientWithStatus } from '@/lib/dashboard/types';

function makePatient(overrides: Partial<PatientWithStatus> = {}): PatientWithStatus {
  return {
    id: overrides.id ?? 'p1',
    full_name: overrides.full_name ?? 'Test Patient',
    risk_tier: overrides.risk_tier ?? null,
    track_assignment: overrides.track_assignment ?? null,
    status: overrides.status ?? 'stable',
    open_alert_count: overrides.open_alert_count ?? 0,
    last_vitals_at: overrides.last_vitals_at ?? null,
    latest_flags: overrides.latest_flags ?? null,
    setup_complete: overrides.setup_complete ?? true,
  };
}

describe('filterUrgentPatients (EFFI-01)', () => {
  it('returns only critical and warning patients', () => {
    const patients = [
      makePatient({ id: '1', status: 'critical' }),
      makePatient({ id: '2', status: 'stable' }),
      makePatient({ id: '3', status: 'alert' }),
      makePatient({ id: '4', status: 'stable' }),
    ];
    const result = filterUrgentPatients(patients);
    expect(result).toHaveLength(2);
    expect(result.every((p) => p.status === 'critical' || p.status === 'alert')).toBe(true);
  });

  it('caps result at 5 patients when more than 5 are critical/warning', () => {
    const patients = Array.from({ length: 10 }, (_, i) =>
      makePatient({ id: `p${i}`, status: 'critical' }),
    );
    const result = filterUrgentPatients(patients);
    expect(result).toHaveLength(5);
  });

  it('returns empty array when all patients are stable', () => {
    const patients = [
      makePatient({ id: '1', status: 'stable' }),
      makePatient({ id: '2', status: 'stable' }),
    ];
    const result = filterUrgentPatients(patients);
    expect(result).toHaveLength(0);
  });

  it('sorts critical before warning in output', () => {
    const patients = [
      makePatient({ id: 'alert1', status: 'alert' }),
      makePatient({ id: 'crit1', status: 'critical' }),
      makePatient({ id: 'alert2', status: 'alert' }),
      makePatient({ id: 'crit2', status: 'critical' }),
    ];
    const result = filterUrgentPatients(patients);
    expect(result[0].status).toBe('critical');
    expect(result[1].status).toBe('critical');
    expect(result[2].status).toBe('alert');
    expect(result[3].status).toBe('alert');
  });
});
