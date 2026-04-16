'use client';

/**
 * MetricEntryForm -- Manual data entry form for quality metrics.
 *
 * Opens as a dialog. Fields: period (month picker), numerator, denominator, notes.
 * Validates numerator <= denominator before submission.
 * Calls upsertQualityMetricRecord server action on submit.
 */

import { useState, useTransition } from 'react';
import { format, startOfMonth, parseISO } from 'date-fns';
import { upsertQualityMetricRecord } from '@/lib/quality-metrics/actions';
import type { MetricKey } from '@/lib/quality-metrics/types';

interface MetricEntryFormProps {
  metricKey: MetricKey;
  metricLabel: string;
  open: boolean;
  onClose: () => void;
}

export function MetricEntryForm({ metricKey, metricLabel, open, onClose }: MetricEntryFormProps) {
  const [period, setPeriod] = useState(format(new Date(), 'yyyy-MM'));
  const [numerator, setNumerator] = useState('');
  const [denominator, setDenominator] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!open) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const num = parseInt(numerator, 10);
    const den = parseInt(denominator, 10);

    if (isNaN(num) || isNaN(den)) {
      setError('Please enter valid numbers');
      return;
    }
    if (num > den) {
      setError('Numerator cannot exceed denominator');
      return;
    }

    // Normalize period to first day of month
    const periodMonth = format(startOfMonth(parseISO(period + '-01')), 'yyyy-MM-dd');

    startTransition(async () => {
      const result = await upsertQualityMetricRecord({
        metric_key: metricKey,
        period_month: periodMonth,
        numerator: num,
        denominator: den,
        notes: notes || undefined,
      });

      if (result.error) {
        setError(result.error);
      } else {
        // Reset form and close
        setNumerator('');
        setDenominator('');
        setNotes('');
        onClose();
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h3 className="mb-4 text-lg font-semibold">Add Data: {metricLabel}</h3>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="period" className="mb-1 block text-sm font-medium text-gray-700">
              Month
            </label>
            <input
              id="period"
              type="month"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="numerator" className="mb-1 block text-sm font-medium text-gray-700">
                Numerator
              </label>
              <input
                id="numerator"
                type="number"
                min="0"
                step="1"
                value={numerator}
                onChange={(e) => setNumerator(e.target.value)}
                placeholder="e.g. 14"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                required
              />
            </div>
            <div>
              <label htmlFor="denominator" className="mb-1 block text-sm font-medium text-gray-700">
                Denominator
              </label>
              <input
                id="denominator"
                type="number"
                min="1"
                step="1"
                value={denominator}
                onChange={(e) => setDenominator(e.target.value)}
                placeholder="e.g. 20"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                required
              />
            </div>
          </div>

          <div>
            <label htmlFor="notes" className="mb-1 block text-sm font-medium text-gray-700">
              Notes (optional)
            </label>
            <textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              disabled={isPending}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              disabled={isPending}
            >
              {isPending ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
