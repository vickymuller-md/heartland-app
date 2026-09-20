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

import { useState, useTransition } from 'react';
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

/**
 * Accountability markers from the derived work item (migration 00041).
 * Renders nothing when the alert has no accountable provider and no pending outcome.
 */
function AccountabilityMarkers({ alert }: { alert: AlertRow }) {
  if (!alert.accountable_provider_name && !alert.outcome_required) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {alert.accountable_provider_name && (
        <span
          className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-800"
          data-testid="alert-accountable"
        >
          Accountable: {alert.accountable_provider_name}
        </span>
      )}
      {alert.outcome_required && (
        <span
          className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-900"
          data-testid="alert-outcome-required"
        >
          Outcome required
        </span>
      )}
    </div>
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
  onResolve: (resolutionNote: string) => void;
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
    return <ResolutionControl isPending={isPending} onResolve={onResolve} />;
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

function ResolutionControl({ isPending, onResolve }: { isPending: boolean; onResolve: (note: string) => void }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  if (!open) return <Button className="min-h-11" size="sm" variant="outline" onClick={() => setOpen(true)} disabled={isPending} data-testid="resolve-btn">Resolve</Button>;
  return (
    <form className="min-w-56 space-y-2" onSubmit={(event) => { event.preventDefault(); onResolve(note); }}>
      <label className="block text-left text-xs font-semibold">Resolution outcome<textarea value={note} onChange={(event) => setNote(event.target.value)} disabled={isPending} required minLength={3} maxLength={1000} rows={2} className="mt-1 w-full rounded-md border p-2 text-sm font-normal" /></label>
      <p className="text-left text-xs text-slate-600">Resolving the alert does not close the work item; it stays in the Daily Loop until an outcome is documented.</p>
      <div className="flex gap-2"><Button className="min-h-11" size="sm" type="submit" disabled={isPending}>{isPending ? <Loader2 className="mr-1 size-3 animate-spin" /> : null}Confirm</Button><Button className="min-h-11" size="sm" type="button" variant="ghost" disabled={isPending} onClick={() => setOpen(false)}>Cancel</Button></div>
    </form>
  );
}

export function AlertRowComponent({ alert, layout }: AlertRowComponentProps) {
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null);
  const router = useRouter();

  const runAction = (
    action: () => Promise<{ success: boolean; error?: string }>,
    successMessage: string,
    errorMessage: string,
  ) => {
    setFeedback(null);
    startTransition(async () => {
      let result;
      try {
        result = await action();
      } catch {
        // A lost response does not prove the server rejected the update.
        setFeedback({ error: true, message: 'The update could not be confirmed. Refresh the list before trying again.' });
        return;
      }
      if (!result.success) {
        setFeedback({ error: true, message: result.error || errorMessage });
        return;
      }
      setFeedback({ error: false, message: successMessage });
      router.refresh();
    });
  };

  const handleAcknowledge = () => runAction(
    () => acknowledgeAlert(alert.id), 'Acknowledgement saved.', 'Unable to acknowledge alert.',
  );

  const handleResolve = (resolutionNote: string) => runAction(
    () => resolveAlert({ alertId: alert.id, resolutionNote }), 'Resolution saved.', 'Unable to resolve alert.',
  );

  const actionFeedback = feedback && (
    <div role={feedback.error ? 'alert' : 'status'} className={`space-y-2 rounded-md p-3 text-left text-sm ${feedback.error ? 'bg-red-50 text-red-900' : 'bg-blue-50 text-blue-900'}`}>
      <p>{feedback.message}</p>
      <Button size="sm" variant="outline" onClick={() => router.refresh()} disabled={isPending}>Refresh list</Button>
    </div>
  );

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
        {(alert.occurrence_count ?? 1) > 1 && (
          <p className="text-xs font-semibold text-amber-800">
            Coalesced signal · {alert.occurrence_count} observations since {formatDistanceToNow(new Date(alert.first_seen_at ?? alert.created_at), { addSuffix: true })}
          </p>
        )}
        <AccountabilityMarkers alert={alert} />
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <StatusBadge status={alert.status} />
            <span className="text-xs text-muted-foreground">Last seen {formatDistanceToNow(new Date(alert.last_seen_at ?? alert.created_at), { addSuffix: true })}</span>
          </div>
          <ActionButtons
            alert={alert}
            isPending={isPending}
            onAcknowledge={handleAcknowledge}
            onResolve={handleResolve}
          />
        </div>
        {actionFeedback}
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
        <AccountabilityMarkers alert={alert} />
      </TableCell>
      <TableCell className="text-right">
        <ActionButtons
          alert={alert}
          isPending={isPending}
          onAcknowledge={handleAcknowledge}
          onResolve={handleResolve}
        />
        {actionFeedback}
      </TableCell>
    </TableRow>
  );
}
