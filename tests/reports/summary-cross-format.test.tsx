import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PatientSummaryPrint } from '@/app/(provider)/reports/_components/patient-summary-print';
import type { EffectiveLabObservation } from '@/lib/labs/effective';
import { projectLabResults } from '@/lib/reports/lab-results';
import { arrayToCSV, buildLabsCSV } from '@/lib/reports/csv-builders';
import type { PatientSummaryData } from '@/lib/reports/types';
import { buildFhirR4Collection, serializeFhirR4 } from '@/lib/interoperability/fhir-r4';

const id = (n: number) => '64000000-0000-4000-8000-' + String(n).padStart(12, '0');
const patientId = id(11);
const now = '2026-09-29T12:00:00Z';
const collection = '2026-09-25T14:00:00.123456Z';
const original: EffectiveLabObservation = { id: id(100)+':potassium', patient_id: patientId,
  analyte: 'potassium', original_lab_result_id: id(100), collected_at: collection, status: 'original',
  root_id: null, version_id: null, revision: null, effective_lab_result_id: id(100), value: '4.2000',
  lab_facility: null, notes: null, evaluation_status: null };
const summary: PatientSummaryData = {
  patient: { id: patientId, full_name: 'Synthetic report case', risk_tier: null, track_assignment: null },
  dateRange: { from: '2026-09-24', to: '2026-09-25' }, openAlerts: [], notes: [], vitals: [], labs: [],
  adherenceSummary: [
    { date: '2026-09-24', totalDoses: 2, takenDoses: 1, status: 'partial' },
    { date: '2026-09-25', totalDoses: 0, takenDoses: 0, status: 'unconfirmed' },
  ],
  educationProgress: { completedDomains: 1, totalDomains: 3, completionRate: 33,
    domains: [
      { id: 'd1', title: 'Module one', completed: true, attempts: 1 },
      { id: 'd2', title: 'Module two', completed: false, attempts: 1 },
      { id: 'd3', title: 'Module three', completed: false, attempts: 0 },
    ] },
};
afterEach(cleanup);

describe('one synthetic source through the chart summary, CSV and FHIR', () => {
  const amended = { ...original, root_id: id(31), version_id: id(32), revision: '2',
    status: 'corrected' as const, effective_lab_result_id: id(33), value: '4.1371' };
  const cancelled = { ...amended, status: 'cancelled' as const, version_id: id(34), revision: '3', effective_lab_result_id: null, value: null };
  it.each([original, amended, cancelled])('preserves current $status status, collection, revision and value availability', source => {
    const labs = projectLabResults([source], new Date(now));
    render(<PatientSummaryPrint data={{ ...summary, labs }} />);
    const pdf = within(screen.getByTestId('patient-summary-print'));
    const csv = buildLabsCSV(labs, { deidentify: false });
    const fhir = JSON.parse(serializeFhirR4(buildFhirR4Collection({
      patient: { id: patientId, fullName: 'Synthetic report case', patientCode: null },
      vitals: [], medications: [], labs: [source], generatedAt: now,
    }))).entry[1].resource;
    expect(pdf.getByText(collection)).toBeVisible();
    expect(pdf.getByText(new RegExp('^'+source.status+' ·'))).toBeInTheDocument();
    expect(csv[1][4]).toBe(collection);
    expect(csv[1][6]).toBe(source.status);
    expect(csv[1][7]).toBe(source.revision ?? '');
    const encoded = arrayToCSV(csv);
    expect(encoded).toContain(collection);
    expect(encoded).toContain(source.status);
    expect(fhir.effectiveDateTime).toBe(collection);
    expect(fhir.note[0].text).toContain('Source status: '+source.status);
    if (source.value === null) {
      expect(pdf.getByText('No current value')).toBeInTheDocument();
      expect(csv[1][2]).toBe(''); expect(encoded).not.toContain(amended.value);
      expect(fhir.valueQuantity).toBeUndefined();
      expect(fhir.dataAbsentReason.text).toBeTruthy();
    } else {
      expect(pdf.getByText(source.value+' mEq/L')).toBeInTheDocument();
      expect(csv[1][2]).toBe(source.value);
      expect(fhir.valueQuantity.value).toBe(Number(source.value));
    }
  });

  it('describes recorded dose counts, excluded days and all three education states', () => {
    render(<PatientSummaryPrint data={summary} />);
    const pdf = within(screen.getByTestId('patient-summary-print'));
    expect(pdf.getByText(/1 of 2 scheduled doses logged as taken \(50%\)/)).toHaveTextContent('incomplete on 1 day');
    expect(pdf.getByText(/1 of 3 available modules completed/)).toBeInTheDocument();
    expect(pdf.getByText('Module two · In progress')).toBeInTheDocument();
    expect(pdf.getByText('Module three · Not started')).toBeInTheDocument();
  });
});
