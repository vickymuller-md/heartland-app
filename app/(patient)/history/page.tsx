import { Suspense } from 'react';
import Link from 'next/link';
import { TrendingUp, Heart } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getVitalsHistory } from '@/lib/vitals/queries';
import type { VitalsDataPoint } from '@/lib/vitals/types';
import { VitalsChart } from './_components/vitals-chart';
import { PeriodToggle } from './_components/period-toggle';

/**
 * History page -- Server Component
 *
 * Fetches vitals history server-side based on period searchParam.
 * Renders PeriodToggle (client) and VitalsChart (client) with transformed data.
 * Empty state shows encouraging message instead of empty chart.
 */

interface HistoryPageProps {
  searchParams: Promise<{ period?: string }>;
}

export default async function HistoryPage({ searchParams }: HistoryPageProps) {
  const params = await searchParams;
  const periodParam = Number(params?.period) || 7;
  const period = ([7, 30, 90] as const).includes(periodParam as 7 | 30 | 90)
    ? (periodParam as 7 | 30 | 90)
    : 7;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let data: VitalsDataPoint[] = [];
  if (user) {
    const vitals = await getVitalsHistory(supabase, user.id, period);
    data = vitals.map((v) => ({
      date: v.recorded_at,
      weight: v.weight_lbs,
      sbp: v.sbp,
      dbp: v.dbp,
      hr: v.heart_rate,
      spo2: v.spo2 ?? undefined,
    }));
  }

  const latest = data.length > 0 ? data[data.length - 1] : null;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight text-gray-900">
        Your Health Trends
      </h1>

      <Suspense fallback={null}>
        <PeriodToggle />
      </Suspense>

      {data.length === 0 ? (
        /* Empty state */
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <TrendingUp className="h-12 w-12 text-gray-300 mb-4" />
          <p className="text-lg text-gray-600 mb-2">
            Your health trends will appear here after a few days of entries.
          </p>
          <p className="text-base text-gray-500 mb-6">
            Start by logging today&apos;s vitals!
          </p>
          <Link
            href="/today"
            className="min-h-[48px] px-6 py-3 text-lg font-semibold bg-blue-600 text-white rounded-lg inline-flex items-center"
          >
            <Heart className="h-5 w-5 mr-2" />
            Log Today&apos;s Vitals
          </Link>
        </div>
      ) : (
        <>
          {/* Chart */}
          <VitalsChart data={data} />

          {/* Latest readings summary */}
          {latest && (
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border bg-white p-4 text-center">
                <p className="text-sm text-gray-500">Weight</p>
                <p className="text-xl font-bold text-gray-900">
                  {latest.weight} <span className="text-sm font-normal">lbs</span>
                </p>
              </div>
              <div className="rounded-lg border bg-white p-4 text-center">
                <p className="text-sm text-gray-500">Blood Pressure</p>
                <p className="text-xl font-bold text-gray-900">
                  {latest.sbp}/{latest.dbp}
                </p>
              </div>
              <div className="rounded-lg border bg-white p-4 text-center">
                <p className="text-sm text-gray-500">Heart Rate</p>
                <p className="text-xl font-bold text-gray-900">
                  {latest.hr} <span className="text-sm font-normal">bpm</span>
                </p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
