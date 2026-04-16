'use client';

/**
 * PatientCard -- Individual patient card with status, risk tier, alerts
 *
 * Shows patient name, risk tier badge, status indicator dot, alert count badge,
 * and relative time since last vitals. Entire card links to patient detail.
 *
 * Requirements: DASH-01 (patient display), DASH-04 (alert badges)
 */

import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import type { PatientWithStatus } from '@/lib/dashboard/types';
import { STATUS_COLORS } from '@/lib/dashboard/constants';

interface PatientCardProps {
  patient: PatientWithStatus;
}

/** Status dot colors (inline styles for the small indicator) */
const STATUS_DOT: Record<string, string> = {
  stable: 'bg-green-500',
  alert: 'bg-amber-500',
  critical: 'bg-red-500',
};

/** Risk tier display labels and colors */
const TIER_STYLES: Record<string, { label: string; className: string }> = {
  low: { label: 'Low', className: 'bg-green-100 text-green-700' },
  moderate: { label: 'Moderate', className: 'bg-amber-100 text-amber-700' },
  high: { label: 'High', className: 'bg-red-100 text-red-700' },
  very_high: { label: 'Very High', className: 'bg-red-200 text-red-800' },
};

function formatLastVitals(dateStr: string | null): string {
  if (!dateStr) return 'No vitals recorded';
  try {
    return formatDistanceToNow(parseISO(dateStr), { addSuffix: true });
  } catch {
    return 'No vitals recorded';
  }
}

export function PatientCard({ patient }: PatientCardProps) {
  const tierStyle = patient.risk_tier
    ? TIER_STYLES[patient.risk_tier]
    : null;

  return (
    <Link href={`/patients/${patient.id}`} className="block group">
      <Card className="transition-shadow duration-200 hover:shadow-md group-hover:ring-2 group-hover:ring-blue-200">
        <CardContent className="flex flex-col gap-3">
          {/* Top row: name + alert badge */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              {/* Status dot */}
              <span
                className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_DOT[patient.status] ?? STATUS_DOT.stable}`}
                aria-label={`Status: ${patient.status}`}
              />
              <h3 className="font-semibold text-gray-900 truncate">
                {patient.full_name}
              </h3>
            </div>

            {/* Alert badge */}
            {patient.open_alert_count > 0 && (
              <Badge variant="destructive" className="shrink-0 gap-1">
                <AlertTriangle className="h-3 w-3" />
                {patient.open_alert_count}
              </Badge>
            )}
          </div>

          {/* Risk tier + status */}
          <div className="flex items-center gap-2 flex-wrap">
            {tierStyle && (
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tierStyle.className}`}>
                {tierStyle.label}
              </span>
            )}
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_COLORS[patient.status] ?? ''}`}>
              {patient.status}
            </span>
            {!patient.setup_complete && (
              <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                Setup incomplete
              </span>
            )}
          </div>

          {/* Last vitals */}
          <p className="text-xs text-gray-500">
            Last vitals: {formatLastVitals(patient.last_vitals_at)}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}
