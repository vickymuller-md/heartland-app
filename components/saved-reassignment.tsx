'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { reassignWorkItem } from '@/lib/daily-loop/actions';
import { finishWorkReassignment } from '@/lib/daily-loop/reassignment-actions';
import { REASSIGNMENT_UNKNOWN, type ReassignmentState } from '@/lib/daily-loop/reassignment';

/** Parent keys this view by the authenticated server snapshot and request identity. */
export function SavedReassignment({ initial, initialError = null }: { initial: ReassignmentState; initialError?: string | null }) {
  const [saved, setSaved] = useState(initial);
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);
  const active = useRef(true);
  const inFlight = useRef(false);
  const router = useRouter();
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);

  async function run(kind: 'apply' | 'cancel' | 'seen') {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      if (kind === 'apply') {
        const result = await reassignWorkItem(saved.request);
        if (!active.current) return;
        if (result.recovery) setSaved(result.recovery);
        if (!result.success) setError(result.error);
      } else {
        const result = await finishWorkReassignment({ requestId: saved.request.requestId,
          receiptId: kind === 'seen' ? saved.receipt?.event_id ?? null : null, cancel: kind === 'cancel' });
        if (!active.current) return;
        if (result.data) setSaved(result.data);
        setError(result.error);
      }
    } catch {
      if (active.current) setError(REASSIGNMENT_UNKNOWN);
    } finally {
      if (active.current) { inFlight.current = false; setBusy(false); }
    }
  }
  const terminal = saved.state === 'seen' || saved.state === 'cancelled';
  return <section className="space-y-3 text-sm" aria-label="Saved reassignment request" aria-busy={busy}>
    <p>The server keeps this request until you review its receipt or cancel an unapplied request. Leaving this page does not discard it.</p>
    <dl className="space-y-1 break-words">
      <div><dt className="font-semibold">Original patient ID</dt><dd className="break-all">{saved.request.patientId}</dd></div>
      <div><dt className="font-semibold">Original work item ID</dt><dd className="break-all">{saved.request.workItemId}</dd></div>
      <div><dt className="font-semibold">Saved reason</dt><dd>{saved.request.reason}</dd></div>
      <div><dt className="font-semibold">Saved recipient ID</dt><dd className="break-all">{saved.request.assigneeId}</dd></div>
      <div><dt className="font-semibold">Request ID</dt><dd className="break-all">{saved.request.requestId}</dd></div>
    </dl>
    <Link href={`/patients/${saved.request.patientId}`} prefetch={false} className="inline-flex min-h-11 items-center text-blue-700 underline">Review the original patient workspace</Link>
    <p>Verify the original patient and work item before applying the saved request.</p>
    {error && <p role="alert" className="text-red-800">{error}</p>}
    {busy && <p role="status">Checking the saved request. Do not create a second transfer.</p>}
    {saved.receipt && <div role="status" className="space-y-2 text-emerald-900">
      <p>Reassignment recorded at {saved.receipt.recorded_at}. Acceptance was not recorded by this operation.</p>
      <p>This receipt describes that transition, not necessarily the current owner.</p>
      {saved.state === 'applied' && <button type="button" disabled={busy} onClick={() => void run('seen')}
        className="min-h-11 rounded-lg border bg-white px-3 font-medium">Confirm I reviewed this technical receipt</button>}
    </div>}
    {saved.state === 'prepared' && <>
      <p role="status">Saved request; application is not confirmed in this view. The original recipient, reason and ownership revision are fixed.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => void run('apply')} className="min-h-11 rounded-lg border bg-white px-3 font-medium">Apply or recover saved request</button>
        <button type="button" disabled={busy} onClick={() => void run('cancel')} className="min-h-11 rounded-lg border bg-white px-3 font-medium">Cancel only if not applied</button>
      </div>
      <p>Cancellation cannot undo a recorded transfer. If application won the race, its receipt will be shown instead.</p>
    </>}
    {terminal && <p role="status">{saved.state === 'seen'
      ? 'Technical receipt review recorded. This does not record recipient acceptance, patient contact or completed care.'
      : 'Request cancelled without applying a reassignment. A new transfer requires a fresh ownership review.'}</p>}
    <div className="flex flex-wrap gap-3">
      <button type="button" disabled={busy} onClick={() => router.refresh()} className="min-h-11 rounded-lg border px-3 font-medium">Refresh current work</button>
      <Link href="/team/reassignment-requests" prefetch={false} className="inline-flex min-h-11 items-center text-blue-700 underline">My pending reassignment requests</Link>
    </div>
  </section>;
}
