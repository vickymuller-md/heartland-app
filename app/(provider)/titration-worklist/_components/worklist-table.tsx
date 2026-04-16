'use client';

import Link from 'next/link';
import { Phone } from 'lucide-react';
import type { TitrationWorklistRow } from '@/lib/dashboard/worklist-queries';
import { isLabStale } from '@/lib/dashboard/worklist-queries';

interface WorklistTableProps {
  rows: TitrationWorklistRow[];
}

function LabValue({ value, label }: { value: number | null; label: string }) {
  if (value === null) return <span className="text-gray-400 text-xs">--</span>;
  return (
    <span aria-label={label}>
      {value}
    </span>
  );
}

export function WorklistTable({ rows }: WorklistTableProps) {
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Patient</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Risk</th>
            <th className="px-4 py-3 text-right font-medium text-gray-600">K+ (mEq/L)</th>
            <th className="px-4 py-3 text-right font-medium text-gray-600">Cr (mg/dL)</th>
            <th className="px-4 py-3 text-right font-medium text-gray-600">SBP (mmHg)</th>
            <th className="px-4 py-3 text-right font-medium text-gray-600">Last Labs</th>
            <th className="px-4 py-3 text-right font-medium text-gray-600">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row) => {
            const stale = isLabStale(row.last_labs_at);
            return (
              <tr key={row.patient_id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">{row.full_name}</td>
                <td className="px-4 py-3 text-gray-600">{row.risk_tier ?? '--'}</td>
                <td className="px-4 py-3 text-right">
                  <LabValue value={row.last_k} label="Potassium" />
                </td>
                <td className="px-4 py-3 text-right">
                  <LabValue value={row.last_cr} label="Creatinine" />
                </td>
                <td className="px-4 py-3 text-right">
                  <LabValue value={row.last_sbp} label="Systolic BP" />
                </td>
                <td className="px-4 py-3 text-right">
                  {row.last_labs_at ? (
                    <span className={stale ? 'text-amber-600 font-medium' : 'text-gray-600'}>
                      {new Date(row.last_labs_at).toLocaleDateString()}
                      {stale && ' (stale)'}
                    </span>
                  ) : (
                    <span className="text-gray-400 text-xs">No labs</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/titration-checklist?patient=${row.patient_id}`}
                    className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                  >
                    <Phone className="size-3" aria-hidden="true" />
                    Start Call
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
