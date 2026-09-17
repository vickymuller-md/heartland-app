'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { ArrowLeftRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { acceptTransfer, declineTransfer } from '@/lib/daily-loop/actions';
import type { PendingTransfer } from '@/lib/daily-loop/types';

function TransferRow({ transfer }: { transfer: PendingTransfer }) {
  const [pending, startTransition] = useTransition();
  const [declining, setDeclining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = () => {
    setError(null);
    startTransition(async () => {
      const result = await acceptTransfer({ workItemId: transfer.id, patientId: transfer.patient_id });
      if (!result.success) setError(result.error ?? 'This transfer could not be accepted.');
    });
  };

  const decline = (reason: string) => {
    setError(null);
    startTransition(async () => {
      const result = await declineTransfer({
        workItemId: transfer.id,
        patientId: transfer.patient_id,
        reason,
      });
      if (!result.success) setError(result.error ?? 'This transfer could not be declined.');
      else setDeclining(false);
    });
  };

  return (
    <li className="rounded-xl border border-violet-200 bg-white p-3" data-testid="pending-transfer">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/patients/${transfer.patient_id}`} className="font-semibold text-blue-700 hover:underline">
          {transfer.patient_name}
        </Link>
        <Badge variant="outline">{transfer.severity}</Badge>
        {transfer.offered_by_name && (
          <span className="text-xs text-slate-600">Offered by {transfer.offered_by_name}</span>
        )}
        {transfer.transfer_offered_at && (
          <span className="text-xs text-slate-500">
            {formatDistanceToNow(new Date(transfer.transfer_offered_at), { addSuffix: true })}
          </span>
        )}
      </div>
      <p className="mt-1 text-sm font-semibold text-slate-950">{transfer.title}</p>
      <p className="mt-1 text-sm text-slate-600">{transfer.reason}</p>

      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}

      {declining ? (
        <form
          className="mt-3 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            decline(String(new FormData(event.currentTarget).get('reason')));
          }}
        >
          <label className="block text-sm font-medium text-slate-800">
            Why are you declining this transfer?
            <textarea
              name="reason"
              required
              minLength={3}
              maxLength={500}
              rows={2}
              className="mt-1 w-full rounded-md border bg-white px-3 py-2"
            />
          </label>
          <div className="flex gap-2">
            <Button type="submit" className="min-h-11" disabled={pending}>Send decline</Button>
            <Button type="button" className="min-h-11" variant="ghost" onClick={() => setDeclining(false)}>Cancel</Button>
          </div>
        </form>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button className="min-h-11" size="sm" disabled={pending} onClick={accept}>Accept transfer</Button>
          <Button className="min-h-11" size="sm" variant="outline" disabled={pending} onClick={() => setDeclining(true)}>
            Decline
          </Button>
        </div>
      )}
    </li>
  );
}

export function PendingTransfers({ transfers }: { transfers: PendingTransfer[] }) {
  if (transfers.length === 0) return null;
  return (
    <section
      className="rounded-2xl border border-violet-300 bg-violet-50/60 p-4"
      aria-labelledby="pending-transfers-heading"
      data-testid="pending-transfers"
    >
      <h2 id="pending-transfers-heading" className="flex items-center gap-2 text-lg font-bold text-slate-950">
        <ArrowLeftRight className="size-5" aria-hidden="true" /> Transfers awaiting your response
        <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-700">{transfers.length}</span>
      </h2>
      <p className="mt-1 text-sm text-slate-700">
        The current provider stays accountable until you accept. Declining requires a reason.
      </p>
      <ul className="mt-3 space-y-3">
        {transfers.map((transfer) => (
          <TransferRow key={transfer.id} transfer={transfer} />
        ))}
      </ul>
    </section>
  );
}
