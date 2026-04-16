'use client';

/**
 * PeriodToggle -- 7/30/90 day period selector
 *
 * Elderly-optimized: 48px minimum tap targets, large text, high contrast.
 * Uses URL searchParams (Option A) so data fetching stays server-side.
 */

import { useRouter, useSearchParams } from 'next/navigation';

const PERIODS = [
  { value: 7, label: '7 Days' },
  { value: 30, label: '30 Days' },
  { value: 90, label: '90 Days' },
] as const;

export function PeriodToggle() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentPeriod = Number(searchParams.get('period')) || 7;

  function handlePeriodChange(period: number) {
    router.push(`/history?period=${period}`);
  }

  return (
    <div className="flex gap-2" role="group" aria-label="Time period">
      {PERIODS.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          onClick={() => handlePeriodChange(value)}
          aria-pressed={currentPeriod === value}
          className={`min-h-[48px] px-6 py-3 text-lg rounded-lg font-medium transition-colors ${
            currentPeriod === value
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
