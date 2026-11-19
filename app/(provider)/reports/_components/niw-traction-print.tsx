'use client';

import React from 'react';
import type { NiwTractionData } from '@/lib/reports/types';
import { UsStateMap } from './us-state-map';
interface NiwTractionPrintProps {
  data: NiwTractionData;
}

export const NiwTractionPrint = React.forwardRef<
  HTMLDivElement,
  NiwTractionPrintProps
>(function NiwTractionPrint({ data }, ref) {
  const maximum = Math.max(1, ...data.monthlyGrowth.flatMap(row => [row.providers, row.patients]));
  return (
    <div
      ref={ref}
      className="hidden print:block p-5 font-sans text-sm"
      data-testid="niw-traction-print"
    >
      {/* Header */}
      <h1 className="text-xl font-bold mb-1">
        HEARTLAND Protocol &mdash; NIW Traction Report
      </h1>
      <p className="text-base font-medium text-gray-700 mb-0">
        Registered profiles and recorded app activity
      </p>
      <p className="text-xs text-gray-500 mb-6">
        Generated for National Interest Waiver petition evidence &mdash;{' '}
        {new Date().toLocaleDateString()}
      </p>

      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="border rounded-lg p-2 text-center">
          <div className="text-2xl font-bold text-blue-800">
            {data.totalProviders}
          </div>
          <div className="text-xs text-gray-600 mt-1">Provider profiles</div>
        </div>
        <div className="border rounded-lg p-2 text-center">
          <div className="text-2xl font-bold text-blue-800">
            {data.totalPatients}
          </div>
          <div className="text-xs text-gray-600 mt-1">Patient profiles</div>
        </div>
        <div className="border rounded-lg p-2 text-center">
          <div className="text-2xl font-bold text-blue-800">
            {data.totalAlerts}
          </div>
          <div className="text-xs text-gray-600 mt-1">Recorded alert rows</div>
        </div>
        <div className="border rounded-lg p-2 text-center">
          <div className="text-2xl font-bold text-blue-800">
            {data.totalTitrations}
          </div>
          <div className="text-xs text-gray-600 mt-1">
            Titration checklist notes
          </div>
        </div>
        <div className="border rounded-lg p-2 text-center">
          <div className="text-2xl font-bold text-emerald-700">
            {data.approvedAccessRequests}
          </div>
          <div className="text-xs text-gray-600 mt-1">
            Approved access requests
          </div>
        </div>
        <div className="border rounded-lg p-2 text-center">
          <div className="text-2xl font-bold text-amber-700">
            {data.pendingAccessRequests}
          </div>
          <div className="text-xs text-gray-600 mt-1">
            Pending access requests
          </div>
        </div>
        <div className="border rounded-lg p-2 text-center">
          <div className="text-2xl font-bold text-violet-700">{data.uniqueSandboxTesters30d}</div>
          <div className="text-xs text-gray-600 mt-1">Tester accounts and anonymous sessions · 30d</div>
        </div>
        <div className="border rounded-lg p-2 text-center">
          <div className="text-2xl font-bold text-violet-700">{data.sandboxActivationRate30d === null ? 'No sessions' : `${data.sandboxActivationRate30d}%`}</div>
          <div className="text-xs text-gray-600 mt-1">First-action activation · 30d</div>
        </div>
        <div className="border rounded-lg p-2 text-center">
          <div className="text-2xl font-bold text-violet-700">{data.medianSandboxDurationSeconds === null ? 'No durations' : `${data.medianSandboxDurationSeconds}s`}</div>
          <div className="text-xs text-gray-600 mt-1">Median recorded session duration · 30d</div>
        </div>
      </div>

      <div className="mb-4 border rounded-lg p-3">
        <h2 className="text-sm font-semibold mb-1">Dissemination Sources · 30d</h2>
        <p className="text-xs text-gray-600">
          {data.campaignSources30d.length === 0
            ? 'No campaign-tagged sandbox sessions recorded.'
            : data.campaignSources30d
              .slice(0, 5)
              .map(({ source, sessions }) => `${source}: ${sessions}`)
              .join(' · ')}
        </p>
      </div>

      <div className="mb-4 grid grid-cols-2 items-start gap-4">
        <section>
          <h2 className="text-sm font-semibold mb-2 break-after-avoid">
            States and territories on provider and patient profiles
          </h2>
          <UsStateMap activeStates={data.activeStates} width={700} />
          <p className="mt-2 text-xs">{data.activeStates.join(', ') || 'No recognized state or territory recorded.'}</p>
        </section>
        <section>
          <h2 className="text-sm font-semibold mb-2 break-after-avoid">
            Profiles created by month (last 12 months)
          </h2>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left">
                <th scope="col" className="py-1">Month (UTC)</th>
                <th scope="col" className="w-1/3">Provider profiles</th>
                <th scope="col" className="w-1/3">Patient profiles</th>
              </tr>
            </thead>
            <tbody>
              {data.monthlyGrowth.map(row => (
                <tr key={row.month}>
                  <th scope="row" className="py-0.5 text-left font-normal">{row.month}</th>
                  {[row.providers, row.patients].map((amount, i) => (
                    <td key={i} className="pr-3">
                      <span className="inline-block w-8 tabular-nums">{amount}</span>
                      <svg width="55%" height="5" viewBox="0 0 100 5" preserveAspectRatio="none" aria-hidden="true" className="inline-block align-middle">
                        <rect width={amount * 100 / maximum} height="5" fill={i === 0 ? '#1e40af' : '#7c3aed'} />
                      </svg>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      {/* Footer disclaimer */}
      <p className="text-xs text-gray-600 border-t pt-2">
        Counts come from app profiles, access requests, alert rows, saved checklist notes and synthetic sandbox events. Each source measures recorded activity. Verification of institutional use or patient outcomes requires independent evidence.
      </p>
    </div>
  );
});
