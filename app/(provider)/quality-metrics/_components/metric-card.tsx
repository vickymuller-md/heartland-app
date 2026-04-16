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
  const numericTarget = isTier1 ? definition.tier1Target : definition.tier23Target;
  const targetLabel = isTier1 ? definition.tier1TargetLabel : definition.tier23TargetLabel;

  // Compute current rate
  const currentRate = latestRecord
    ? formatRate(latestRecord.numerator, latestRecord.denominator)
    : null;
  const ratePct = latestRecord?.rate_pct ?? null;

  // Evaluate status
  let status: TargetStatus;
  if (numericTarget == null) {
    // Tier 1 readmission -- no numeric target, always neutral
    status = ratePct != null ? 'no_data' : 'no_data';
  } else {
    status = evaluateTarget(ratePct, numericTarget, definition.higherIsBetter);
  }

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
      </div>

      {/* Target */}
      <div className="mb-2 text-sm text-gray-500">
        Target: {targetLabel}
      </div>

      {/* Status Badge */}
      <div className="mb-3">
        <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyle.className}`}>
          {numericTarget == null && ratePct != null ? 'No Numeric Target' : statusStyle.label}
        </span>
      </div>

      {/* Trend Chart */}
      <MetricTrendChart
        data={history}
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
