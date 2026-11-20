import { createClient } from '@/lib/supabase/server';
import { getProviderMetrics } from '@/lib/dashboard/metrics-queries';
import { MetricCard } from './metric-card';

interface MetricCardsProps {
  providerId: string;
}

export async function MetricCards({ providerId }: MetricCardsProps) {
  const supabase = await createClient();
  const metrics = await getProviderMetrics(supabase, providerId);

  return (
    <div className="mb-6 space-y-2">
      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <MetricCard
          label="Total Patients"
          value={metrics.totalPatients}
        />
        <MetricCard
          label="Active Alerts"
          value={metrics.activeAlerts}
          alert={metrics.activeAlerts > 0}
        />
        <MetricCard
          label="No Check-in (3d)"
          value={metrics.noCheckinCount}
          alert={metrics.noCheckinCount > 0}
        />
        <MetricCard
          label="Scheduled Doses Recorded (7d)"
          value={metrics.avgAdherence === null ? 'Unavailable' : `${metrics.avgAdherence}%`}
          valueTone={metrics.avgAdherence === null ? 'muted' : metrics.avgAdherence >= 80 ? 'positive' : 'warning'}
        />
        <MetricCard
          label="Alerts Addressed (30d)"
          value={metrics.addressedAlertsLast30Days}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Current totals are shown. Weekly trend data is unavailable. Scheduled doses recorded compares doses marked taken with expected slots on each patient’s local calendar. Missing schedules or an empty denominator have no percentage.
        Alerts Addressed counts alert work items closed in the last 30 days with a
        documented clinical outcome. Administrative closures and items closed without a
        recorded outcome are excluded; items created before the accountability model
        carry no outcome code and count on closure as they always did.
      </p>
    </div>
  );
}

/** Skeleton fallback for Suspense boundary */
export function MetricCardsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 mb-6">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="min-h-24 animate-pulse rounded-xl border border-border bg-muted"
        />
      ))}
    </div>
  );
}
