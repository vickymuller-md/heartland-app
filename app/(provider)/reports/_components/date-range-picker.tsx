'use client';

/**
 * DateRangePicker -- Client Component
 *
 * Preset buttons (This Month, Last 30 Days, Last 90 Days) plus
 * custom date inputs. Pushes URL searchParams for server-side re-fetch.
 *
 * Requirement: REPT-04 (Date Range Selection)
 */

import { useRouter } from 'next/navigation';
import { startOfMonth, subDays, format } from 'date-fns';

interface DateRangePickerProps {
  from: string;
  to: string;
}

export function DateRangePicker({ from, to }: DateRangePickerProps) {
  const router = useRouter();

  const push = (newFrom: string, newTo: string) => {
    router.push(`/reports?from=${newFrom}&to=${newTo}`);
  };

  const today = new Date();
  const todayStr = format(today, 'yyyy-MM-dd');

  const presets = [
    {
      label: 'This Month',
      getRange: () => ({
        from: format(startOfMonth(today), 'yyyy-MM-dd'),
        to: todayStr,
      }),
    },
    {
      label: 'Last 30 Days',
      getRange: () => ({
        from: format(subDays(today, 30), 'yyyy-MM-dd'),
        to: todayStr,
      }),
    },
    {
      label: 'Last 90 Days',
      getRange: () => ({
        from: format(subDays(today, 90), 'yyyy-MM-dd'),
        to: todayStr,
      }),
    },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      {presets.map((preset) => (
        <button
          key={preset.label}
          type="button"
          className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50"
          onClick={() => {
            const r = preset.getRange();
            push(r.from, r.to);
          }}
        >
          {preset.label}
        </button>
      ))}

      <div className="flex items-center gap-1 ml-2">
        <label htmlFor="range-from" className="text-sm text-gray-600">
          From
        </label>
        <input
          id="range-from"
          type="date"
          className="rounded border border-gray-300 px-2 py-1 text-sm"
          value={from}
          onChange={(e) => push(e.target.value, to)}
        />
      </div>

      <div className="flex items-center gap-1">
        <label htmlFor="range-to" className="text-sm text-gray-600">
          To
        </label>
        <input
          id="range-to"
          type="date"
          className="rounded border border-gray-300 px-2 py-1 text-sm"
          value={to}
          onChange={(e) => push(from, e.target.value)}
        />
      </div>
    </div>
  );
}
