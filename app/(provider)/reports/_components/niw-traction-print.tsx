/**
 * NiwTractionPrint -- Print Layout for NIW Petition Evidence
 *
 * Hidden on screen, visible when printing. One-page PDF layout showing
 * cumulative platform adoption: providers, patients, alerts, titrations,
 * geographic distribution (US choropleth), and monthly growth chart.
 *
 * Requirement: REPT-06 (NIW traction print page)
 * Pattern: hidden print:block (from monthly-report-print.tsx)
 */

'use client';

import React from 'react';
import type { NiwTractionData } from '@/lib/reports/types';
import { UsStateMap } from './us-state-map';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface NiwTractionPrintProps {
  data: NiwTractionData;
}

export const NiwTractionPrint = React.forwardRef<
  HTMLDivElement,
  NiwTractionPrintProps
>(function NiwTractionPrint({ data }, ref) {
  return (
    <div
      ref={ref}
      className="hidden print:block p-8 font-sans text-sm"
      data-testid="niw-traction-print"
    >
      {/* Header */}
      <h1 className="text-xl font-bold mb-1">
        HEARTLAND Protocol &mdash; NIW Traction Report
      </h1>
      <p className="text-base font-medium text-gray-700 mb-0">
        Cumulative Platform Adoption
      </p>
      <p className="text-xs text-gray-500 mb-6">
        Generated for National Interest Waiver petition evidence &mdash;{' '}
        {new Date().toLocaleDateString()}
      </p>

      {/* Stats grid: 3x2 */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="border rounded-lg p-4 text-center">
          <div className="text-3xl font-bold text-blue-800">
            {data.totalProviders}
          </div>
          <div className="text-xs text-gray-600 mt-1">Total Providers</div>
        </div>
        <div className="border rounded-lg p-4 text-center">
          <div className="text-3xl font-bold text-blue-800">
            {data.totalPatients}
          </div>
          <div className="text-xs text-gray-600 mt-1">Total Patients</div>
        </div>
        <div className="border rounded-lg p-4 text-center">
          <div className="text-3xl font-bold text-blue-800">
            {data.totalAlerts}
          </div>
          <div className="text-xs text-gray-600 mt-1">Total Alerts</div>
        </div>
        <div className="border rounded-lg p-4 text-center">
          <div className="text-3xl font-bold text-blue-800">
            {data.totalTitrations}
          </div>
          <div className="text-xs text-gray-600 mt-1">
            Titrations Completed
          </div>
        </div>
        <div className="border rounded-lg p-4 text-center">
          <div className="text-3xl font-bold text-emerald-700">
            {data.approvedProviders}
          </div>
          <div className="text-xs text-gray-600 mt-1">
            Approved Professional Registrations
          </div>
        </div>
        <div className="border rounded-lg p-4 text-center">
          <div className="text-3xl font-bold text-amber-700">
            {data.pendingAccessRequests}
          </div>
          <div className="text-xs text-gray-600 mt-1">
            Pending Access Requests
          </div>
        </div>
      </div>

      {/* Geographic Distribution */}
      <h2 className="text-base font-semibold mb-2">
        Geographic Distribution
      </h2>
      <div className="mb-8">
        <UsStateMap activeStates={data.activeStates} width={700} />
      </div>

      {/* Monthly Growth */}
      <h2 className="text-base font-semibold mb-2">
        Monthly Growth (Last 12 Months)
      </h2>
      <div className="mb-6">
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data.monthlyGrowth}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month" tick={{ fontSize: 10 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
            <Tooltip />
            <Bar dataKey="providers" fill="#1e40af" name="Providers" />
            <Bar dataKey="patients" fill="#7c3aed" name="Patients" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Footer disclaimer */}
      <p className="text-xs text-gray-400 border-t pt-2">
        Data exported from app.heartlandprotocol.org. For research and
        immigration purposes only.
      </p>
    </div>
  );
});
