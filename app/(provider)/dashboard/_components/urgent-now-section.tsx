'use client';

import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import type { PatientWithStatus } from '@/lib/dashboard/types';
import { FLAG_LABELS } from '@/lib/dashboard/constants';

/** Pure function -- exported for unit testing. */
export function filterUrgentPatients(patients: PatientWithStatus[]): PatientWithStatus[] {
  return patients
    .filter((p) => p.status === 'critical' || p.status === 'alert')
    .sort((a, b) => {
      // critical before alert
      if (a.status === 'critical' && b.status !== 'critical') return -1;
      if (b.status === 'critical' && a.status !== 'critical') return 1;
      return 0;
    })
    .slice(0, 5);
}

interface UrgentNowSectionProps {
  patients: PatientWithStatus[];
}

const STATUS_DOT_COLORS: Record<string, string> = {
  critical: 'bg-red-500',
  alert: 'bg-amber-500',
};

export function UrgentNowSection({ patients }: UrgentNowSectionProps) {
  const urgent = filterUrgentPatients(patients);
  if (urgent.length === 0) return null;

  return (
    <section className="rounded-lg border border-red-200 bg-red-50 p-4" aria-label="Urgent patients">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-red-800 uppercase tracking-wide">
        <AlertTriangle className="size-4" aria-hidden="true" />
        Urgent Now ({urgent.length})
      </h2>
      <ul className="space-y-2">
        {urgent.map((patient) => (
          <li
            key={patient.id}
            className="flex items-center justify-between gap-3 rounded-md bg-white px-3 py-2 shadow-sm"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span
                className={`size-2 shrink-0 rounded-full ${STATUS_DOT_COLORS[patient.status] ?? 'bg-gray-400'}`}
                aria-label={patient.status}
              />
              <span className="truncate text-sm font-medium text-gray-900">{patient.full_name}</span>
              {patient.latest_flags && patient.latest_flags.length > 0 && (
                <span className="hidden text-xs text-gray-500 sm:block">
                  {patient.latest_flags
                    .map((f) => FLAG_LABELS[f] ?? f)
                    .slice(0, 2)
                    .join(', ')}
                </span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Link
                href={`/alerts?patient=${patient.id}`}
                className="rounded px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50"
              >
                View Alerts
              </Link>
              <Link
                href={`/patients/${patient.id}`}
                className="rounded px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100"
              >
                Patient
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
