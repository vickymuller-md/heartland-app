'use client';

/**
 * MetricTrendChart -- 6-month bar trend chart for a quality metric.
 *
 * Uses Recharts BarChart pattern (project standard from Phase 10).
 * Shows ReferenceLine at target value (green dashed for higherIsBetter, red for lower).
 * For Tier 1 readmission (target=null), shows gray baseline at first data point.
 */

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  ReferenceLine,
  Tooltip,
} from 'recharts';
import { parseISO, format } from 'date-fns';
import type { MonthlyTrend } from '@/lib/quality-metrics/types';

interface MetricTrendChartProps {
  data: MonthlyTrend[];
  target: number | null;
  higherIsBetter: boolean;
}

export function MetricTrendChart({ data, target, higherIsBetter }: MetricTrendChartProps) {
  const chartData = data.map((d) => ({
    month: format(parseISO(d.period_month), 'MMM'),
    rate: d.rate_pct,
  }));

  if (chartData.length === 0) {
    return (
      <div className="flex h-[120px] items-center justify-center text-sm text-gray-400">
        No data yet
      </div>
    );
  }

  // For Tier 1 readmission (target=null), use first data point as baseline
  const baselineRate =
    target == null && data.length > 0 ? data[0].rate_pct : null;

  const refLineColor = target != null
    ? (higherIsBetter ? '#22c55e' : '#ef4444')
    : '#9ca3af'; // gray for baseline

  const refLineValue = target ?? baselineRate;

  return (
    <ResponsiveContainer width="100%" height={120}>
      <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
        <XAxis dataKey="month" fontSize={11} tickLine={false} />
        <YAxis domain={[0, 100]} fontSize={11} tickLine={false} />
        {refLineValue != null && (
          <ReferenceLine
            y={refLineValue}
            stroke={refLineColor}
            strokeDasharray="4 4"
          />
        )}
        <Tooltip
          formatter={(v) => [`${Number(v).toFixed(1)}%`, 'Rate']}
          contentStyle={{ fontSize: 12 }}
        />
        <Bar dataKey="rate" fill="#3b82f6" radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
