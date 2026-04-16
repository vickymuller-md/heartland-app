'use client';

/**
 * PatientList -- Responsive grid of patient cards
 *
 * Renders a responsive grid: 1 column mobile, 2 columns md, 3 columns lg.
 *
 * Requirement: DASH-01 (patient list)
 */

import type { PatientWithStatus } from '@/lib/dashboard/types';
import { PatientCard } from './patient-card';

interface PatientListProps {
  patients: PatientWithStatus[];
}

export function PatientList({ patients }: PatientListProps) {
  return (
    <div
      className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"
      data-testid="patient-list"
    >
      {patients.map((patient) => (
        <PatientCard key={patient.id} patient={patient} />
      ))}
    </div>
  );
}
