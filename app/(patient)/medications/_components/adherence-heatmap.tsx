'use client';

/**
 * HEARTLAND Adherence Heatmap -- 30-day calendar grid
 *
 * Color-coded cells showing daily adherence status:
 * green=complete, yellow=partial, gray=missed, white=future/no_meds
 *
 * Pure Tailwind CSS grid -- no charting library needed.
 * Cells are larger than typical heatmaps (40px) for elderly visibility.
 */

import { useState } from 'react';
import type { AdherenceDay } from '@/lib/medications/types';

const STATUS_COLORS: Record<AdherenceDay['status'], string> = {
  complete: 'bg-green-500 text-white',
  partial: 'bg-yellow-400 text-gray-900',
  missed: 'bg-gray-300 text-gray-700',
  future: 'bg-white border border-gray-100 text-gray-400',
  no_meds: 'bg-white text-gray-300',
};

const DAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function getDayOfWeek(dateStr: string): number {
  // Returns 0=Mon, 1=Tue, ..., 6=Sun (ISO week)
  const d = new Date(dateStr + 'T00:00:00');
  return (d.getDay() + 6) % 7;
}

export function AdherenceHeatmap({ data }: { data: AdherenceDay[] }) {
  const [tooltip, setTooltip] = useState<{
    day: AdherenceDay;
    index: number;
  } | null>(null);

  if (data.length === 0) return null;

  // Compute leading empty cells for grid alignment
  const firstDow = getDayOfWeek(data[0].date);

  return (
    <div>
      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 gap-1 mb-1">
        {DAY_HEADERS.map((d) => (
          <div
            key={d}
            className="text-xs text-center text-gray-500 font-medium"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1">
        {/* Leading empty cells */}
        {Array.from({ length: firstDow }).map((_, i) => (
          <div key={`empty-${i}`} className="w-8 h-8 sm:w-10 sm:h-10" />
        ))}

        {/* Day cells */}
        {data.map((day, i) => {
          const dayNum = new Date(day.date + 'T00:00:00').getDate();
          return (
            <button
              key={day.date}
              type="button"
              className={`rounded-sm w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center relative ${STATUS_COLORS[day.status]}`}
              onClick={() =>
                setTooltip(tooltip?.index === i ? null : { day, index: i })
              }
              aria-label={`${day.date}: ${day.takenDoses} of ${day.totalDoses} doses taken`}
            >
              <span className="text-xs text-center">{dayNum}</span>
            </button>
          );
        })}
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div className="mt-2 p-2 bg-gray-50 border border-gray-200 rounded-lg text-sm">
          <p className="font-medium">{tooltip.day.date}</p>
          <p className="text-gray-600">
            {tooltip.day.status === 'future'
              ? 'Future date'
              : tooltip.day.status === 'no_meds'
                ? 'No medications scheduled'
                : `${tooltip.day.takenDoses} of ${tooltip.day.totalDoses} doses taken`}
          </p>
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-3">
        {[
          { status: 'complete' as const, label: 'Taken' },
          { status: 'partial' as const, label: 'Partial' },
          { status: 'missed' as const, label: 'Missed' },
          { status: 'future' as const, label: 'Future' },
        ].map(({ status, label }) => (
          <div key={status} className="flex items-center gap-1">
            <div
              className={`w-4 h-4 rounded-sm ${STATUS_COLORS[status]}`}
            />
            <span className="text-xs text-gray-600">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
