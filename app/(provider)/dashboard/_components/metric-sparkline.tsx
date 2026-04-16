'use client';

/**
 * MetricSparkline -- Minimal trend line chart (client island)
 *
 * Renders a 40px-height Recharts LineChart with no axes, labels, or tooltips.
 * Used as a client island inside server-rendered MetricCard components.
 *
 * Requirement: METR-04 (sparkline trends)
 */

import { LineChart, Line, ResponsiveContainer } from 'recharts';
import type { MetricTrend } from '@/lib/dashboard/metrics-types';

interface MetricSparklineProps {
  data: MetricTrend[];
  color: string;
}

export function MetricSparkline({ data, color }: MetricSparklineProps) {
  if (data.length < 2) return <div className="h-10" aria-hidden />;
  return (
    <ResponsiveContainer width="100%" height={40}>
      <LineChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
        <Line
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
