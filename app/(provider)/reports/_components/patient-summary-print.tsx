/**
 * PatientSummaryPrint -- Print Layout
 *
 * Hidden on screen, visible when printing. Contains the full patient
 * summary with profile, vitals, labs, medication adherence, education,
 * alerts, notes, and clinical disclaimer.
 *
 * Requirement: REPT-02 (Patient Summary PDF)
 * Pattern: hidden print:block (from titration-checklist/print-layout.tsx)
 */

import React from 'react';
import type { PatientSummaryData } from '@/lib/reports/types';

interface PatientSummaryPrintProps {
  data: PatientSummaryData | null;
}

export const PatientSummaryPrint = React.forwardRef<
  HTMLDivElement,
  PatientSummaryPrintProps
>(function PatientSummaryPrint({ data }, ref) {
  return (
    <div ref={ref} className="hidden print:block p-8 text-sm font-sans" data-testid="patient-summary-print">
      {!data ? (
        <p className="text-gray-500 italic">No patient selected.</p>
      ) : (
        <>
          {/* Header */}
          <h1 className="text-xl font-bold mb-1">HEARTLAND Patient Summary Report</h1>
          <p className="text-sm text-gray-600 mb-1">
            Patient: {data.patient.full_name}
          </p>
          <p className="text-sm text-gray-600 mb-4">
            Period: {data.dateRange.from} &ndash; {data.dateRange.to}
          </p>

          {/* Disclaimer */}
          <p className="text-xs italic border p-2 mb-6">
            This tool is designed for healthcare professionals as an educational implementation-support resource.
            It does not provide medical diagnoses, treatment recommendations for individual patients,
            or replace clinical judgment. Not intended for direct patient care. For professional use only.
          </p>

          {/* a. Patient Profile */}
          <h2 className="font-semibold mt-4 mb-2 border-b pb-1">Patient Profile</h2>
          <table className="w-full text-sm mb-4">
            <tbody>
              <tr>
                <td className="py-1 font-medium w-48">Name</td>
                <td>{data.patient.full_name}</td>
              </tr>
              <tr>
                <td className="py-1 font-medium">Risk Tier</td>
                <td>
                  <span className="inline-block rounded px-2 py-0.5 text-xs font-semibold bg-gray-100">
                    {data.patient.risk_tier ?? 'Not assessed'}
                  </span>
                </td>
              </tr>
              <tr>
                <td className="py-1 font-medium">Track Assignment</td>
                <td>{data.patient.track_assignment ?? 'Not assigned'}</td>
              </tr>
            </tbody>
          </table>

          {/* b. Vitals Summary */}
          <h2 className="font-semibold mt-4 mb-2 border-b pb-1">Vitals Summary (Last 5)</h2>
          {data.vitals.length === 0 ? (
            <p className="text-sm text-gray-500 mb-4">No vitals recorded in period.</p>
          ) : (
            <table className="w-full text-sm mb-4 border-collapse">
              <thead>
                <tr className="border-b">
                  <th className="py-1 text-left font-medium">Date</th>
                  <th className="py-1 text-left font-medium">Weight (lbs)</th>
                  <th className="py-1 text-left font-medium">SBP/DBP</th>
                  <th className="py-1 text-left font-medium">HR</th>
                  <th className="py-1 text-left font-medium">SpO2</th>
                </tr>
              </thead>
              <tbody>
                {data.vitals.slice(0, 5).map((v, i) => (
                  <tr key={i} className="border-b border-gray-200">
                    <td className="py-1">{v.date}</td>
                    <td className="py-1">{v.weight_lbs ?? '-'}</td>
                    <td className="py-1">
                      {v.sbp != null && v.dbp != null
                        ? `${v.sbp}/${v.dbp}`
                        : '-'}
                    </td>
                    <td className="py-1">{v.heart_rate ?? '-'}</td>
                    <td className="py-1">{v.spo2 != null ? `${v.spo2}%` : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* c. Lab Results */}
          <h2 className="font-semibold mt-4 mb-2 border-b pb-1">Lab Results</h2>
          {data.labs.length === 0 ? (
            <p className="text-sm text-gray-500 mb-4">No labs in period.</p>
          ) : (
            <table className="w-full text-sm mb-4 border-collapse">
              <thead>
                <tr className="border-b">
                  <th className="py-1 text-left font-medium">Test</th>
                  <th className="py-1 text-left font-medium">Value</th>
                  <th className="py-1 text-left font-medium">Date</th>
                  <th className="py-1 text-left font-medium">Flag</th>
                </tr>
              </thead>
              <tbody>
                {data.labs.slice(0, 10).map((lab) => (
                  <tr key={lab.id} className="border-b border-gray-200">
                    <td className="py-1">{lab.test_name}</td>
                    <td className="py-1">
                      {lab.value} {lab.unit}
                    </td>
                    <td className="py-1">{lab.collected_at}</td>
                    <td className="py-1">
                      {lab.flag && lab.flag !== 'normal' ? (
                        <span
                          className={
                            lab.flag === 'critical'
                              ? 'font-bold text-red-700'
                              : lab.flag === 'high'
                              ? 'text-orange-600'
                              : 'text-blue-600'
                          }
                        >
                          {lab.flag.toUpperCase()}
                        </span>
                      ) : (
                        <span className="text-green-600">Normal</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* d. Medication Adherence */}
          <h2 className="font-semibold mt-4 mb-2 border-b pb-1">Medication Adherence</h2>
          <p className="text-sm mb-4">
            {data.adherenceSummary &&
            typeof data.adherenceSummary === 'object' &&
            'adherenceRate' in (data.adherenceSummary as Record<string, unknown>)
              ? `${(data.adherenceSummary as Record<string, unknown>).adherenceRate}% taken`
              : 'No adherence data available.'}
          </p>

          {/* e. Education Progress */}
          <h2 className="font-semibold mt-4 mb-2 border-b pb-1">Education Progress</h2>
          {data.educationProgress &&
          Array.isArray(data.educationProgress) ? (
            <ul className="list-none text-sm mb-4">
              {(
                data.educationProgress as Array<{
                  domain: string;
                  completed: boolean;
                }>
              ).map((d, i) => (
                <li key={i} className="py-0.5">
                  {d.completed ? '[x]' : '[ ]'} {d.domain}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-500 mb-4">
              No education progress data available.
            </p>
          )}

          {/* f. Active Alerts */}
          <h2 className="font-semibold mt-4 mb-2 border-b pb-1">Active Alerts</h2>
          {data.openAlerts.length === 0 ? (
            <p className="text-sm text-gray-500 mb-4">No active alerts.</p>
          ) : (
            <ul className="list-none text-sm mb-4">
              {data.openAlerts.map((alert) => (
                <li key={alert.id} className="py-0.5">
                  <span
                    className={
                      alert.severity === 'critical'
                        ? 'font-bold text-red-700'
                        : alert.severity === 'warning'
                        ? 'text-yellow-700'
                        : 'text-gray-600'
                    }
                  >
                    [{alert.severity.toUpperCase()}]
                  </span>{' '}
                  {alert.flags.join(', ')} &mdash; {alert.created_at}
                </li>
              ))}
            </ul>
          )}

          {/* g. Recent Notes */}
          <h2 className="font-semibold mt-4 mb-2 border-b pb-1">Recent Provider Notes</h2>
          {data.notes.length === 0 ? (
            <p className="text-sm text-gray-500 mb-4">No notes recorded.</p>
          ) : (
            <ul className="list-none text-sm mb-4">
              {data.notes.slice(0, 3).map((note) => (
                <li key={note.id} className="py-1 border-b border-gray-100">
                  <span className="text-xs text-gray-400">
                    {note.created_at}
                  </span>
                  <p className="mt-0.5">{note.content}</p>
                </li>
              ))}
            </ul>
          )}

          {/* Footer */}
          <p className="text-xs text-gray-400 border-t pt-2">
            Generated by HEARTLAND Protocol App &mdash; app.heartlandprotocol.org &mdash;{' '}
            {new Date().toLocaleDateString()}
          </p>
        </>
      )}
    </div>
  );
});
