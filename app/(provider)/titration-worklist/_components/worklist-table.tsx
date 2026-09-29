'use client';

import Link from 'next/link';
import { Phone } from 'lucide-react';
import type { TitrationWorklistRow } from '@/lib/dashboard/worklist-queries';
import { LAB_QUALITY_LABELS, labCollectionUTC, type LabQuality } from '@/lib/labs/quality';
import { RiskTierDisclaimer } from '@/components/disclaimers/risk-score-disclaimer';

interface WorklistTableProps {
  rows: TitrationWorklistRow[];
}

function LabValue({ value, label }: { value: number | string | null; label: string }) {
  if (value === null) return <span className="text-gray-400 text-xs">--</span>;
  return (
    <span aria-label={label}>
      {value}
    </span>
  );
}

function AnalyteCell({ quality, label }: { quality: LabQuality; label: string }) {
  return <div aria-label={`${label} data quality`} className="space-y-1">
    <LabValue value={quality.value} label={label} />
    <p className={quality.status === 'current' ? 'text-xs text-gray-600' : 'text-xs font-medium text-amber-800'}>
      {LAB_QUALITY_LABELS[quality.status]}
    </p>
    {quality.collectedAt && <time className="block text-xs text-gray-600" dateTime={quality.collectedAt}>
      {labCollectionUTC(quality.collectedAt)} (UTC)
    </time>}
    <p className="max-w-56 text-xs text-gray-600">{quality.reason}</p>
    {quality.source && <p className="max-w-56 text-xs text-gray-600">
      Source: {quality.source.status}{quality.source.revision ? ` · revision ${quality.source.revision}` : ' · authority not registered'}.
      {quality.source.evaluationStatus === 'pending' && ' Alert processing pending.'}
    </p>}
  </div>;
}

export function WorklistTable({ rows }: WorklistTableProps) {
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
      <p className="border-b p-4 text-sm text-gray-700">
        Recency is checked separately for each analyte using the existing worklist advisory
        (stale after more than 14 complete days). This is not a medication-specific clearance,
        normal-range classification, clinical deadline, or confirmation of professional review.
        Missing, invalid and cancelled data appear first for reconciliation, not as clinical triage.
      </p>
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Patient</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Risk</th>
            <th className="px-4 py-3 text-right font-medium text-gray-600">K+ (mEq/L)</th>
            <th className="px-4 py-3 text-right font-medium text-gray-600">Cr (mg/dL)</th>
            <th className="px-4 py-3 text-right font-medium text-gray-600">eGFR (mL/min/1.73m²)</th>
            <th className="px-4 py-3 text-right font-medium text-gray-600">SBP (mmHg)</th>
            <th className="px-4 py-3 text-right font-medium text-gray-600">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row) => (
              <tr key={row.patient_id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">{row.full_name}</td>
                <td className="px-4 py-3 text-gray-600">{row.risk_tier ?? '--'}</td>
                <td className="px-4 py-3 text-right">
                  <AnalyteCell quality={row.labs.potassium} label="Potassium" />
                </td>
                <td className="px-4 py-3 text-right">
                  <AnalyteCell quality={row.labs.creatinine} label="Creatinine" />
                </td>
                <td className="px-4 py-3 text-right">
                  <AnalyteCell quality={row.labs.egfr} label="eGFR" />
                </td>
                <td className="px-4 py-3 text-right">
                  <LabValue value={row.last_sbp} label="Systolic BP" />
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
          ))}
        </tbody>
      </table>
      <RiskTierDisclaimer className="border-t border-gray-200 px-4 py-3" />
    </div>
  );
}
