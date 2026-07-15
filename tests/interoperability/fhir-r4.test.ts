import { describe, expect, it } from 'vitest';
import { buildFhirR4Collection } from '@/lib/interoperability/fhir-r4';

describe('FHIR R4 read-only export', () => {
  const bundle = buildFhirR4Collection({
    patient: { id: 'patient-1', fullName: 'Maria Santos', patientCode: 'ABC123' },
    vitals: [{ id: 'v1', recorded_at: '2026-07-14T12:00:00Z', weight_lbs: 150, sbp: 118, dbp: 72, heart_rate: 68, spo2: 97 }],
    labs: [{ id: 'l1', collected_at: '2026-07-13T12:00:00Z', potassium: 4.2, creatinine: 1.1, egfr: 65, sodium: 139 }],
    medications: [{ id: 'm1', name: 'Synthetic medication', dosage: '10 mg', frequency: 'daily', timing: null, active: true, created_at: '2026-07-01T12:00:00Z' }],
    generatedAt: '2026-07-14T13:00:00Z',
  });

  it('creates a FHIR R4 collection with resolvable patient references', () => {
    expect(bundle.resourceType).toBe('Bundle');
    expect(bundle.type).toBe('collection');
    expect(bundle.entry[0].resource).toMatchObject({ resourceType: 'Patient', id: 'patient-1' });
    expect(bundle.entry.slice(1).every((entry) => JSON.stringify(entry.resource).includes('Patient/patient-1'))).toBe(true);
  });

  it('uses standard LOINC and UCUM coding for vitals and labs', () => {
    const serialized = JSON.stringify(bundle);
    for (const code of ['29463-7', '85354-9', '8867-4', '59408-5', '2823-3', '2160-0', '33914-3', '2951-2']) {
      expect(serialized).toContain(code);
    }
    expect(serialized).toContain('http://unitsofmeasure.org');
  });

  it('exports minimum-necessary identity and labels the bundle as educational', () => {
    const serialized = JSON.stringify(bundle);
    expect(serialized).not.toContain('email');
    expect(serialized).not.toContain('phone');
    expect(serialized).toContain('educational-export');
  });
});
