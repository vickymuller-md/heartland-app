'use client';

/**
 * SortControls -- Clickable sort buttons for the patient dashboard
 *
 * Updates ?sort= searchParam on click, which triggers server-side re-render.
 * Uses SORT_OPTIONS from constants for labels.
 *
 * Requirement: DASH-02 (sort by status, vitals date, risk tier)
 */

import { useRouter, useSearchParams } from 'next/navigation';
import { SORT_OPTIONS } from '@/lib/dashboard/constants';
import type { SortKey } from '@/lib/dashboard/types';

interface SortControlsProps {
  currentSort: SortKey;
}

export function SortControls({ currentSort }: SortControlsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function handleSort(value: SortKey) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('sort', value);
    router.push(`/dashboard?${params.toString()}`);
  }

  return (
    <div className="flex items-center gap-1" role="group" aria-label="Sort patients by">
      <span className="text-sm text-gray-500 mr-2 hidden sm:inline">Sort by:</span>
      {SORT_OPTIONS.map((option) => (
        <button
          key={option.value}
          onClick={() => handleSort(option.value)}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
            currentSort === option.value
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
          aria-pressed={currentSort === option.value}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
