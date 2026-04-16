'use client';

/**
 * Track B: Batch Entry Grid (7-Day)
 * Requirement: TRKB-06
 *
 * Provider transcribes 7 days of paper diary readings in a single table submission.
 * Uses useActionState with submitBatchVitalsAsProvider Server Action.
 * Rows pre-populated with last 7 calendar dates (oldest first).
 */

import { useActionState, useState } from 'react';
import { subDays, format } from 'date-fns';
import { submitBatchVitalsAsProvider } from '@/lib/vitals/actions';
import type { BatchVitalsActionState, BatchRowResult } from '@/lib/vitals/types';
import { AlertTriangle, CheckCircle, Minus } from 'lucide-react';

interface BatchEntryGridProps {
  patientId: string;
}

const DYSPNEA_OPTIONS = [
  { value: 0, label: 'None' },
  { value: 1, label: 'Mild' },
  { value: 2, label: 'Moderate' },
  { value: 3, label: 'Severe' },
] as const;

export default function BatchEntryGrid({ patientId }: BatchEntryGridProps) {
  const [state, formAction, isPending] = useActionState<BatchVitalsActionState | null, FormData>(
    submitBatchVitalsAsProvider,
    null
  );
  const [weightUnit, setWeightUnit] = useState<'lbs' | 'kg'>('lbs');

  // Generate last 7 dates (oldest first)
  const today = new Date();
  const dates = Array.from({ length: 7 }, (_, i) => subDays(today, 6 - i));

  return (
    <div className="space-y-6">
      {/* Weight unit toggle */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-gray-700">Weight unit:</span>
        <div className="flex rounded-lg border overflow-hidden">
          <button
            type="button"
            onClick={() => setWeightUnit('lbs')}
            className={`px-3 py-1.5 text-sm font-medium transition-colors ${
              weightUnit === 'lbs'
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            lbs
          </button>
          <button
            type="button"
            onClick={() => setWeightUnit('kg')}
            className={`px-3 py-1.5 text-sm font-medium transition-colors ${
              weightUnit === 'kg'
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            kg
          </button>
        </div>
      </div>

      <form action={formAction}>
        <input type="hidden" name="patientId" value={patientId} />

        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b">
                <th scope="col" className="text-xs uppercase tracking-wide text-gray-500 px-2 py-2 text-left">Date</th>
                <th scope="col" className="text-xs uppercase tracking-wide text-gray-500 px-2 py-2 text-center">Weight</th>
                <th scope="col" className="text-xs uppercase tracking-wide text-gray-500 px-2 py-2 text-center">SBP</th>
                <th scope="col" className="text-xs uppercase tracking-wide text-gray-500 px-2 py-2 text-center">DBP</th>
                <th scope="col" className="text-xs uppercase tracking-wide text-gray-500 px-2 py-2 text-center">HR</th>
                <th scope="col" className="text-xs uppercase tracking-wide text-gray-500 px-2 py-2 text-center">SpO2</th>
                <th scope="col" className="text-xs uppercase tracking-wide text-gray-500 px-2 py-2 text-center">Dyspnea</th>
              </tr>
            </thead>
            <tbody>
              {dates.map((date, i) => {
                const dateStr = format(date, 'yyyy-MM-dd');
                const dateLabel = format(date, 'MMMM d');
                return (
                  <tr key={i} className="border-b">
                    <td className="px-2 py-2 text-gray-700 whitespace-nowrap text-sm">
                      {format(date, 'MMM d')}
                      <input type="hidden" name={`row_${i}_recordedAt`} value={dateStr} />
                      <input type="hidden" name={`row_${i}_weightUnit`} value={weightUnit} />
                    </td>
                    <td className="px-1 py-1 text-center">
                      <input
                        type="number"
                        name={`row_${i}_weight`}
                        step="0.1"
                        aria-label={`Weight for ${dateLabel}`}
                        className="w-16 border rounded px-1 py-0.5 text-center text-sm"
                      />
                    </td>
                    <td className="px-1 py-1 text-center">
                      <input
                        type="number"
                        name={`row_${i}_sbp`}
                        aria-label={`SBP for ${dateLabel}`}
                        className="w-14 border rounded px-1 py-0.5 text-center text-sm"
                      />
                    </td>
                    <td className="px-1 py-1 text-center">
                      <input
                        type="number"
                        name={`row_${i}_dbp`}
                        aria-label={`DBP for ${dateLabel}`}
                        className="w-14 border rounded px-1 py-0.5 text-center text-sm"
                      />
                    </td>
                    <td className="px-1 py-1 text-center">
                      <input
                        type="number"
                        name={`row_${i}_heartRate`}
                        aria-label={`HR for ${dateLabel}`}
                        className="w-14 border rounded px-1 py-0.5 text-center text-sm"
                      />
                    </td>
                    <td className="px-1 py-1 text-center">
                      <input
                        type="number"
                        name={`row_${i}_spo2`}
                        placeholder="opt"
                        aria-label={`SpO2 for ${dateLabel}`}
                        className="w-14 border rounded px-1 py-0.5 text-center text-sm"
                      />
                    </td>
                    <td className="px-1 py-1 text-center">
                      <select
                        name={`row_${i}_dyspnea`}
                        defaultValue="0"
                        aria-label={`Dyspnea for ${dateLabel}`}
                        className="w-20 border rounded px-1 py-0.5 text-sm"
                      >
                        {DYSPNEA_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* General error */}
        {state?.error && (
          <div className="mt-4 rounded-lg border-2 border-red-300 bg-red-50 p-4">
            <p className="text-base text-red-700">{state.error}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="mt-4 w-full min-h-[48px] text-base font-semibold bg-blue-600 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed py-3"
        >
          {isPending ? 'Saving...' : 'Save 7-Day Batch'}
        </button>
      </form>

      {/* Post-submit results summary */}
      {state?.results && <BatchResultSummary results={state.results} />}
    </div>
  );
}

function BatchResultSummary({ results }: { results: BatchRowResult[] }) {
  return (
    <div className="mt-6 space-y-2">
      <h3 className="text-lg font-semibold text-gray-900">Batch Results</h3>
      {results.map((row) => (
        <div
          key={row.rowIndex}
          className={`flex items-start gap-2 p-3 rounded-lg border ${
            row.skipped
              ? 'bg-gray-50 border-gray-200'
              : row.success
              ? row.redFlags.length > 0
                ? 'bg-amber-50 border-amber-300'
                : 'bg-green-50 border-green-300'
              : 'bg-red-50 border-red-300'
          }`}
        >
          {/* Status icon */}
          {row.skipped ? (
            <Minus className="h-5 w-5 text-gray-400 mt-0.5 shrink-0" />
          ) : row.success ? (
            <CheckCircle className="h-5 w-5 text-green-600 mt-0.5 shrink-0" />
          ) : (
            <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5 shrink-0" />
          )}

          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm text-gray-900">{row.date}</span>
              {row.skipped && <span className="text-sm text-gray-500">No data</span>}
              {row.success && row.redFlags.length === 0 && (
                <span className="text-sm text-green-700">Saved</span>
              )}
              {row.success && row.redFlags.length > 0 && (
                <span className="text-sm text-amber-700">Saved with alerts</span>
              )}
              {!row.success && !row.skipped && (
                <span className="text-sm text-red-700">{row.error ?? 'Error'}</span>
              )}
            </div>

            {/* Red flag details */}
            {row.redFlags.length > 0 && (
              <ul className="mt-1 space-y-0.5">
                {row.redFlags.map((flag) => (
                  <li key={flag.id} className="text-sm text-amber-800">
                    <span className="font-medium">{flag.message}</span> &mdash; {flag.action}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
