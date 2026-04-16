'use client';

/**
 * Alert Row -- Client Component
 *
 * Renders a single alert as either a table row (desktop) or card (mobile).
 * Includes action buttons for acknowledge/resolve transitions using
 * server actions with useTransition for pending state.
 *
 * Requirements: DASH-05 (alert status transitions)
 */

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TableCell, TableRow } from '@/components/ui/table';
import { acknowledgeAlert, resolveAlert } from '@/lib/dashboard/actions';
import { FLAG_LABELS, SEVERITY_COLORS } from '@/lib/dashboard/constants';
import type { AlertRow, AlertFlag } from '@/lib/dashboard/types';
import { MuteToggle } from './mute-toggle';
import { Loader2 } from 'lucide-react';

interface AlertRowComponentProps {
  alert: AlertRow;
  layout: 'table' | 'card';
}

function FlagLabels({ flags }: { flags: AlertFlag[] }) {
  return (
    <span>
      {flags.map((f) => FLAG_LABELS[f] || f).join(', ')}
    </span>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const colors = SEVERITY_COLORS[severity as keyof typeof SEVERITY_COLORS];
  return (
    <Badge
      variant="outline"
      className={colors || ''}
      data-testid="severity-badge"
    >
      {severity}
    </Badge>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variantMap: Record<string, 'outline' | 'secondary' | 'default'> = {
    open: 'outline',
    acknowledged: 'secondary',
    resolved: 'default',
  };
  return (
    <Badge variant={variantMap[status] || 'outline'} data-testid="status-badge">
      {status}
    </Badge>
  );
}

function ActionButtons({
  alert,
  isPending,
  onAcknowledge,
  onResolve,
}: {
  alert: AlertRow;
  isPending: boolean;
  onAcknowledge: () => void;
  onResolve: () => void;
}) {
  if (alert.status === 'open') {
    return (
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant="outline"
          onClick={onAcknowledge}
          disabled={isPending}
          data-testid="acknowledge-btn"
        >
          {isPending ? <Loader2 className="mr-1 size-3 animate-spin" /> : null}
          Acknowledge
        </Button>
        {alert.severity === 'informational' && alert.flags[0] && (
          <MuteToggle
            patientId={alert.patient_id}
            alertType={alert.flags[0]}
          />
        )}
      </div>
    );
  }

  if (alert.status === 'acknowledged') {
    return (
      <Button
        size="sm"
        variant="outline"
        onClick={onResolve}
        disabled={isPending}
        data-testid="resolve-btn"
      >
        {isPending ? <Loader2 className="mr-1 size-3 animate-spin" /> : null}
        Resolve
      </Button>
    );
  }

  if (alert.status === 'resolved' && alert.resolved_at) {
    return (
      <span className="text-xs text-muted-foreground">
        Resolved {formatDistanceToNow(new Date(alert.resolved_at), { addSuffix: true })}
      </span>
    );
  }

  return null;
}

export function AlertRowComponent({ alert, layout }: AlertRowComponentProps) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleAcknowledge = () => {
    startTransition(async () => {
      await acknowledgeAlert(alert.id);
      router.refresh();
    });
  };

  const handleResolve = () => {
    startTransition(async () => {
      await resolveAlert(alert.id);
      router.refresh();
    });
  };

  const timeAgo = formatDistanceToNow(new Date(alert.created_at), {
    addSuffix: true,
  });

  if (layout === 'card') {
    return (
      <div
        className="rounded-lg border p-4 space-y-2"
        data-testid="alert-card"
      >
        <div className="flex items-start justify-between gap-2">
          <Link
            href={`/patients/${alert.patient_id}`}
            className="font-medium text-blue-600 hover:underline"
          >
            {alert.patient_name}
          </Link>
          <SeverityBadge severity={alert.severity} />
        </div>
        <p className="text-sm text-muted-foreground">
          <FlagLabels flags={alert.flags} />
        </p>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <StatusBadge status={alert.status} />
            <span className="text-xs text-muted-foreground">{timeAgo}</span>
          </div>
          <ActionButtons
            alert={alert}
            isPending={isPending}
            onAcknowledge={handleAcknowledge}
            onResolve={handleResolve}
          />
        </div>
      </div>
    );
  }

  // Table row layout
  return (
    <TableRow data-testid="alert-row">
      <TableCell>
        <Link
          href={`/patients/${alert.patient_id}`}
          className="font-medium text-blue-600 hover:underline"
        >
          {alert.patient_name}
        </Link>
      </TableCell>
      <TableCell className="max-w-[300px]">
        <span className="text-sm">
          <FlagLabels flags={alert.flags} />
        </span>
      </TableCell>
      <TableCell>
        <SeverityBadge severity={alert.severity} />
      </TableCell>
      <TableCell>
        <span className="text-sm text-muted-foreground">{timeAgo}</span>
      </TableCell>
      <TableCell>
        <StatusBadge status={alert.status} />
      </TableCell>
      <TableCell className="text-right">
        <ActionButtons
          alert={alert}
          isPending={isPending}
          onAcknowledge={handleAcknowledge}
          onResolve={handleResolve}
        />
      </TableCell>
    </TableRow>
  );
}
