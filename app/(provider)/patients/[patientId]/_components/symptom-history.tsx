'use client';

/**
 * SymptomHistory -- List of symptom entries for patient detail
 *
 * Each entry shows date, severity badges for dyspnea/edema/orthopnea/fatigue,
 * and red flag icon when red_flag is true.
 *
 * Requirement: DASH-03 (symptoms tab in patient detail)
 */

import { AlertTriangle, Stethoscope } from 'lucide-react';
import { formatDistanceToNow, parseISO, format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import type { SymptomEntry } from '@/lib/dashboard/types';

interface SymptomHistoryProps {
  symptoms: SymptomEntry[];
}

const SEVERITY_LABELS: Record<number, { text: string; className: string }> = {
  0: { text: 'None', className: 'bg-gray-100 text-gray-600' },
  1: { text: 'Mild', className: 'bg-green-100 text-green-700' },
  2: { text: 'Moderate', className: 'bg-amber-100 text-amber-700' },
  3: { text: 'Severe', className: 'bg-red-100 text-red-700' },
};

function SeverityBadge({ label, value }: { label: string; value: number }) {
  const style = SEVERITY_LABELS[value] ?? SEVERITY_LABELS[0];
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-gray-500 w-20">{label}</span>
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${style.className}`}>
        {style.text}
      </span>
    </div>
  );
}

export function SymptomHistory({ symptoms }: SymptomHistoryProps) {
  if (symptoms.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Stethoscope className="h-10 w-10 text-gray-300 mb-3" />
        <p className="text-gray-600">No symptoms reported</p>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="symptom-history">
      {symptoms.map((entry) => {
        let dateLabel: string;
        try {
          dateLabel = format(parseISO(entry.recorded_at), 'MMM d, yyyy');
        } catch {
          dateLabel = entry.recorded_at;
        }

        let relativeTime: string;
        try {
          relativeTime = formatDistanceToNow(parseISO(entry.recorded_at), { addSuffix: true });
        } catch {
          relativeTime = '';
        }

        return (
          <div
            key={entry.id}
            className={`rounded-lg border p-4 ${
              entry.red_flag ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-white'
            }`}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-sm font-medium text-gray-900">{dateLabel}</p>
                <p className="text-xs text-gray-500">{relativeTime}</p>
              </div>
              {entry.red_flag && (
                <Badge variant="destructive" className="gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  Red Flag
                </Badge>
              )}
            </div>

            {/* Severity grid */}
            <div className="grid grid-cols-2 gap-2">
              <SeverityBadge label="Dyspnea" value={entry.dyspnea} />
              <SeverityBadge label="Edema" value={entry.edema} />
              <SeverityBadge
                label="Orthopnea"
                value={typeof entry.orthopnea === 'boolean' ? (entry.orthopnea ? 1 : 0) : Number(entry.orthopnea)}
              />
              <SeverityBadge label="Fatigue" value={entry.fatigue} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
