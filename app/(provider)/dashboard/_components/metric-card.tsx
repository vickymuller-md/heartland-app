/**
 * MetricCard -- Single dashboard metric display
 *
 * Server component that renders icon, label, large value, optional trend indicator,
 * and a MetricSparkline client island at the bottom.
 *
 * Design follows patient-card.tsx patterns (border, shadow, rounded-lg).
 *
 * Requirements: METR-01 (metric display), METR-04 (sparkline)
 */

import type { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { MetricSparkline } from './metric-sparkline';
import type { MetricTrend } from '@/lib/dashboard/metrics-types';

interface MetricCardProps {
  /** Display label */
  label: string;
  /** Formatted value (number, percentage string, etc.) */
  value: string | number;
  /** Lucide icon component */
  icon: LucideIcon;
  /** Weekly trend data for sparkline */
  trend: MetricTrend[];
  /** Sparkline stroke color */
  color: string;
  /** Whether to apply alert styling (amber border) */
  alert?: boolean;
}

export function MetricCard({
  label,
  value,
  icon: Icon,
  trend,
  color,
  alert = false,
}: MetricCardProps) {
  const formattedValue =
    typeof value === 'number' ? value.toLocaleString() : value;

  return (
    <Card
      className={
        alert
          ? 'border-amber-400 ring-amber-200 shadow-sm'
          : 'shadow-sm'
      }
      aria-label={`${label}: ${formattedValue}`}
    >
      <CardContent className="flex flex-col gap-2">
        {/* Header: icon + label */}
        <div className="flex items-center gap-2 text-muted-foreground">
          <Icon className="h-4 w-4 shrink-0" />
          <span className="text-xs font-medium">{label}</span>
        </div>

        {/* Large value */}
        <p className="text-2xl font-bold tracking-tight text-foreground">
          {formattedValue}
        </p>

        {/* Sparkline */}
        <MetricSparkline data={trend} color={color} />
      </CardContent>
    </Card>
  );
}
