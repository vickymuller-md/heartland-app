import { Card, CardContent } from '@/components/ui/card';
import { MetricSparkline } from './metric-sparkline';
import type { MetricTrend } from '@/lib/dashboard/metrics-types';

interface MetricCardProps {
  /** Display label */
  label: string;
  /** Formatted value (number, percentage string, etc.) */
  value: string | number;
  /** Weekly trend data for sparkline */
  trend?: MetricTrend[];
  valueTone?: 'muted' | 'positive' | 'warning';
  /** Whether to apply alert styling (amber border) */
  alert?: boolean;
}

export function MetricCard({
  label,
  value,
  trend,
  valueTone,
  alert = false,
}: MetricCardProps) {
  const formattedValue =
    typeof value === 'number' ? value.toLocaleString() : value;

  const valueColor = valueTone === 'warning' ? 'text-amber-800'
    : valueTone === 'positive' ? 'text-emerald-800'
    : valueTone === 'muted' ? 'text-muted-foreground' : 'text-foreground';

  return (
    <Card
      className={
        alert
          ? 'h-full border-amber-400'
          : 'h-full'
      }
      aria-label={`${label}: ${formattedValue}`}
    >
      <CardContent className="flex flex-col gap-2">
        <span className="section-kicker">{label}</span>

        {/* Large value */}
        <p className={`text-3xl font-medium tracking-tight tabular-nums ${valueColor}`}>
          {formattedValue}
        </p>

        {trend && trend.length > 1 && <MetricSparkline data={trend} color="var(--primary)" />}
      </CardContent>
    </Card>
  );
}
