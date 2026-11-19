'use client';

/**
 * MetricCard -- Quality metric card with current rate, target, status badge, and trend chart.
 *
 * Displays tier-appropriate target string and evaluates status.
 * For Tier 1 readmission (tier1Target=null), shows text target and neutral badge.
 */

import { useState } from 'react';
import { Pencil } from 'lucide-react';
import type { MetricDefinition, QualityMetricRecord, MonthlyTrend } from '@/lib/quality-metrics/types';
import { formatRate, evaluateTarget, type TargetStatus } from '@/lib/quality-metrics/utils';
import { MetricTrendChart } from './metric-trend-chart';
import { MetricEntryForm } from './metric-entry-form';

interface MetricCardProps {
  definition: MetricDefinition;
  latestRecord: QualityMetricRecord | null;
  history: MonthlyTrend[];
  facilityTier: number | null;
}

const STATUS_STYLES: Record<TargetStatus, { label: string; className: string }> = {
  met: { label: 'Met', className: 'bg-green-100 text-green-800' },
  approaching: { label: 'Approaching', className: 'bg-amber-100 text-amber-800' },
  below: { label: 'Below Target', className: 'bg-red-100 text-red-800' },
  no_data: { label: 'No Data', className: 'bg-gray-100 text-gray-600' },
};

export function MetricCard({ definition, latestRecord, history, facilityTier }: MetricCardProps) {
  const [formOpen, setFormOpen] = useState(false);

  const isTier1 = facilityTier === 1;
  const hasExample = isTier1 || facilityTier === 2 || facilityTier === 3;
  const numericTarget = hasExample ? (isTier1 ? definition.tier1Target : definition.tier23Target) : null;
  const targetLabel = hasExample ? (isTier1 ? definition.tier1TargetLabel : definition.tier23TargetLabel) : 'Select an example above';
  const numerator = latestRecord?.numerator;
  const denominator = latestRecord?.denominator;
  const currentRate = formatRate(numerator ?? null, denominator ?? null);
  const ratePct = numerator != null && denominator ? (numerator / denominator) * 100 : null;
  const status = evaluateTarget(ratePct, numericTarget, definition.higherIsBetter);
  const statusStyle = STATUS_STYLES[status];

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      {/* Header */}
      <div className="mb-3 flex items-start justify-between">
        <h3 className="text-sm font-medium text-gray-700">{definition.label}</h3>
        <button
          onClick={() => setFormOpen(true)}
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          aria-label={`Add data for ${definition.label}`}
        >
          <Pencil className="size-4" />
        </button>
      </div>

      {/* Current Rate */}
      <div className="mb-2">
        <span className="text-3xl font-bold text-gray-900">
          {currentRate ?? '\u2014'}
        </span>
        {currentRate && <span className="ml-2 text-sm text-slate-700">{numerator} of {denominator} recorded</span>}
      </div>

      {/* Target */}
      <div className="mb-2 text-sm text-gray-500">
        Historical planning example: {targetLabel}
      </div>

      {/* Status Badge */}
      {hasExample && <div className="mb-3">
        <p className="mb-1 text-xs text-gray-500">Comparison with the planning example, not a clinical adequacy assessment.</p>
        <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyle.className}`}>
          {numericTarget == null && ratePct != null ? 'No Numeric Target' : statusStyle.label}
        </span>
      </div>}

      {/* Trend Chart */}
      <MetricTrendChart
        data={history}
        showBaseline={isTier1 && numericTarget === null}
        target={numericTarget}
        higherIsBetter={definition.higherIsBetter}
      />

      {/* Entry Form Modal */}
      <MetricEntryForm
        metricKey={definition.key}
        metricLabel={definition.label}
        open={formOpen}
        onClose={() => setFormOpen(false)}
      />
    </div>
  );
}
