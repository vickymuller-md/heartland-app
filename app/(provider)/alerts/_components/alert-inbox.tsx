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
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
            ? 'All patient alerts have been addressed.'
            : statusFilter === 'resolved'
              ? 'No resolved alerts to display.'
              : 'No alerts matching this filter.'}
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Desktop: Table */}
      <div className="hidden md:block" data-testid="alert-table">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Patient</TableHead>
              <TableHead>Alert</TableHead>
              <TableHead>Severity</TableHead>
              <TableHead>Time</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {alerts.map((alert) => (
              <AlertRowComponent key={alert.id} alert={alert} layout="table" />
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile: Card layout */}
      <div className="space-y-3 md:hidden" data-testid="alert-cards">
        {alerts.map((alert) => (
          <AlertRowComponent key={alert.id} alert={alert} layout="card" />
        ))}
      </div>
    </>
  );
}
