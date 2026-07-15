'use client';

/**
 * Alert Inbox -- Client Component
 *
 * Renders a chronological list of alerts with patient name, flags,
 * severity, timestamp, status, and action buttons. Responsive:
 * table on desktop, stacked cards on mobile.
 *
 * Requirements: DASH-05 (alert inbox)
 */

import type { AlertRow, AlertStatus } from '@/lib/dashboard/types';
import { AlertRowComponent } from './alert-row';
import { Bell } from 'lucide-react';

interface AlertInboxProps {
  alerts: AlertRow[];
  statusFilter: AlertStatus | 'all';
}

export function AlertInbox({ alerts, statusFilter }: AlertInboxProps) {
  if (alerts.length === 0) {
    const statusLabel = statusFilter === 'all' ? '' : ` ${statusFilter}`;
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
        <Bell className="mb-3 size-10 text-muted-foreground/50" />
        <h3 className="text-lg font-medium">No{statusLabel} alerts</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {statusFilter === 'open'
            ? 'The open-alert query loaded successfully and returned no items.'
            : statusFilter === 'resolved'
              ? 'No resolved alerts to display.'
              : 'No alerts matching this filter.'}
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-3 xl:grid-cols-2" data-testid="alert-list">
      {alerts.map((alert) => (
        <AlertRowComponent key={alert.id} alert={alert} layout="card" />
      ))}
    </div>
  );
}
