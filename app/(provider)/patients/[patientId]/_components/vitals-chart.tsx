'use client';

/**
 * VitalsChart -- Provider-facing multi-series vitals trend chart
 *
 * Recharts LineChart with dual Y-axes:
 * - Left axis: Weight (lbs)
 * - Right axis: BP/HR/SpO2
 *
 * 5 lines: weight (blue), SBP (red), DBP (orange), HR (green), SpO2 (purple)
 * Period toggle (7/30/90 days) filters data client-side.
 *
 * Requirement: DASH-03 (vitals trends in patient detail)
 */

import { useState, useMemo } from 'react';
import { format, parseISO, subDays } from 'date-fns';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import type { VitalsChartPoint } from '@/lib/dashboard/types';
import { TrendingUp } from 'lucide-react';

interface VitalsChartProps {
  data: VitalsChartPoint[];
}

const PERIODS = [7, 30, 90] as const;
type Period = (typeof PERIODS)[number];

const chartConfig = {
  weight_lbs: { label: 'Weight (lbs)', color: 'hsl(221, 83%, 53%)' },
  sbp: { label: 'SBP (mmHg)', color: 'hsl(0, 72%, 51%)' },
  dbp: { label: 'DBP (mmHg)', color: 'hsl(25, 95%, 53%)' },
  heart_rate: { label: 'HR (bpm)', color: 'hsl(142, 71%, 45%)' },
  spo2: { label: 'SpO2 (%)', color: 'hsl(271, 76%, 53%)' },
} satisfies ChartConfig;

function formatDate(dateStr: string): string {
  try {
    return format(parseISO(dateStr), 'MMM d');
  } catch {
    return dateStr;
  }
}

export function VitalsChart({ data }: VitalsChartProps) {
  const [period, setPeriod] = useState<Period>(30);

  const filteredData = useMemo(() => {
    const cutoff = subDays(new Date(), period);
    return data.filter((d) => {
      try {
        return parseISO(d.date) >= cutoff;
      } catch {
        return false;
      }
    });
  }, [data, period]);

  const hasSpO2 = filteredData.some(
    (d) => d.spo2 !== null && d.spo2 !== undefined
  );

  if (filteredData.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <TrendingUp className="h-10 w-10 text-gray-300 mb-3" />
        <p className="text-gray-600">
          No vitals recorded in the last {period} days
        </p>
        <div className="mt-4 flex gap-2">
          {PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                period === p
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {p}d
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Period toggle */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-500">Period:</span>
        {PERIODS.map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              period === p
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
            aria-pressed={period === p}
          >
            {p}d
          </button>
        ))}
      </div>

      {/* Chart */}
      <ChartContainer config={chartConfig} className="h-[350px] w-full">
        <LineChart data={filteredData} accessibilityLayer>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            tickFormatter={formatDate}
            tick={{ fontSize: 12 }}
            tickLine={false}
            axisLine={false}
          />
          {/* Left Y-axis: Weight */}
          <YAxis
            yAxisId="weight"
            orientation="left"
            tick={{ fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            label={{
              value: 'Weight (lbs)',
              angle: -90,
              position: 'insideLeft',
              style: { fontSize: 11, fill: '#6b7280' },
            }}
          />
          {/* Right Y-axis: BP/HR/SpO2 */}
          <YAxis
            yAxisId="vitals"
            orientation="right"
            tick={{ fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            label={{
              value: 'BP / HR / SpO2',
              angle: 90,
              position: 'insideRight',
              style: { fontSize: 11, fill: '#6b7280' },
            }}
          />
          <ChartTooltip
            content={<ChartTooltipContent />}
          />
          <Legend />
          <Line
            yAxisId="weight"
            type="monotone"
            dataKey="weight_lbs"
            stroke="var(--color-weight_lbs)"
            strokeWidth={2}
            dot={false}
            name="Weight (lbs)"
            connectNulls
          />
          <Line
            yAxisId="vitals"
            type="monotone"
            dataKey="sbp"
            stroke="var(--color-sbp)"
            strokeWidth={2}
            dot={false}
            name="SBP"
            connectNulls
          />
          <Line
            yAxisId="vitals"
            type="monotone"
            dataKey="dbp"
            stroke="var(--color-dbp)"
            strokeWidth={2}
            dot={false}
            name="DBP"
            connectNulls
          />
          <Line
            yAxisId="vitals"
            type="monotone"
            dataKey="heart_rate"
            stroke="var(--color-heart_rate)"
            strokeWidth={2}
            dot={false}
            name="HR"
            connectNulls
          />
          {hasSpO2 && (
            <Line
              yAxisId="vitals"
              type="monotone"
              dataKey="spo2"
              stroke="var(--color-spo2)"
              strokeWidth={2}
              dot={false}
              name="SpO2"
              connectNulls
            />
          )}
        </LineChart>
      </ChartContainer>
    </div>
  );
}
