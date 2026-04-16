'use client';

/**
 * VitalsChart -- Line chart for vitals trend visualization
 *
 * Uses shadcn/ui chart (Recharts v3) for weight, systolic BP, heart rate,
 * and optional SpO2 trend lines.
 *
 * Elderly-optimized: 14px+ axis text, 16px tooltip text, high-contrast colors,
 * 250px minimum chart height.
 */

import { format, parseISO } from 'date-fns';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import type { VitalsDataPoint } from '@/lib/vitals/types';

interface VitalsChartProps {
  data: VitalsDataPoint[];
}

const chartConfig = {
  weight: {
    label: 'Weight (lbs)',
    color: 'var(--chart-1)',
  },
  sbp: {
    label: 'Systolic BP',
    color: 'var(--chart-2)',
  },
  hr: {
    label: 'Heart Rate',
    color: 'var(--chart-3)',
  },
  spo2: {
    label: 'SpO2 (%)',
    color: 'var(--chart-4)',
  },
} satisfies ChartConfig;

function formatDate(dateStr: string): string {
  try {
    return format(parseISO(dateStr), 'MMM d');
  } catch {
    return dateStr;
  }
}

export function VitalsChart({ data }: VitalsChartProps) {
  const hasSpO2 = data.some((d) => d.spo2 !== undefined && d.spo2 !== null);

  return (
    <ChartContainer config={chartConfig} className="h-[250px] w-full">
      <LineChart data={data} accessibilityLayer>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={formatDate}
          tick={{ fontSize: 14 }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis tick={{ fontSize: 14 }} tickLine={false} axisLine={false} />
        <ChartTooltip
          content={<ChartTooltipContent className="text-base" />}
        />
        <Line
          type="monotone"
          dataKey="weight"
          stroke="var(--color-weight)"
          strokeWidth={2}
          dot={false}
          name="Weight (lbs)"
        />
        <Line
          type="monotone"
          dataKey="sbp"
          stroke="var(--color-sbp)"
          strokeWidth={2}
          dot={false}
          name="Systolic BP"
        />
        <Line
          type="monotone"
          dataKey="hr"
          stroke="var(--color-hr)"
          strokeWidth={2}
          dot={false}
          name="Heart Rate"
        />
        {hasSpO2 && (
          <Line
            type="monotone"
            dataKey="spo2"
            stroke="var(--color-spo2)"
            strokeWidth={2}
            dot={false}
            name="SpO2 (%)"
          />
        )}
      </LineChart>
    </ChartContainer>
  );
}
