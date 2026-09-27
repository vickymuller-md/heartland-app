'use client';

import { useEffect, useRef, useState } from 'react';
import { SavedReassignment } from '@/components/saved-reassignment';
import { reassignWorkItem } from '@/lib/daily-loop/actions';
import { loadWorkReassignmentContext } from '@/lib/daily-loop/reassignment-actions';
import { reassignmentSchema, REASSIGNMENT_UNKNOWN, REASSIGNMENT_UNAVAILABLE,
  type ReassignmentContext, type ReassignmentInput, type ReassignmentResult, type ReassignmentState } from '@/lib/daily-loop/reassignment';

export function WorkReassignment({ workItemId, scopeKey }: { workItemId: string; scopeKey: string }) {
  return <ReassignmentControl key={`${scopeKey}:${workItemId}`} workItemId={workItemId} />;
}

function ReassignmentControl({ workItemId }: { workItemId: string }) {
  const [recovery, setRecovery] = useState<ReassignmentState | null>(null);
  const [context, setContext] = useState<ReassignmentContext | null>(null);
  const [attempt, setAttempt] = useState<ReassignmentInput | null>(null);
  const [result, setResult] = useState<ReassignmentResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState('');
  const busyRef = useRef(false);
  const generation = useRef(0);
  useEffect(() => () => { generation.current += 1; }, []);

  async function load(after: string | null = null) {
    if (busyRef.current || (attempt && !(result?.success === false && result.status === 'rejected'))) return;
    busyRef.current = true;
    const current = ++generation.current;
    setBusy(true); setError(null); setContext(null); setTarget(''); setAttempt(null); setResult(null);
    try {
      const response = await loadWorkReassignmentContext({ workItemId, after });
      if (current !== generation.current) return;
      setContext(response.data); setError(response.error); setRecovery(response.recovery ?? null);
    } catch {
      if (current === generation.current) setError(REASSIGNMENT_UNAVAILABLE);
    } finally {
      if (current === generation.current) { busyRef.current = false; setBusy(false); }
    }
  }

  async function submit(request: ReassignmentInput) {
    if (busyRef.current) return;
    busyRef.current = true;
    const current = ++generation.current;
    setBusy(true); setError(null); setResult(null); setAttempt(request);
    try {
      const response = await reassignWorkItem(request);
      if (current === generation.current) { setResult(response); setRecovery(response.recovery ?? null); }
    } catch {
      if (current === generation.current) setResult({ success: false, status: 'unknown', error: REASSIGNMENT_UNKNOWN });
    } finally {
      if (current === generation.current) { busyRef.current = false; setBusy(false); }
    }
  }

  if (recovery) return <div className="mt-3 rounded-lg border border-slate-300 bg-slate-50 p-3">
    <SavedReassignment key={recovery.request.requestId} initial={recovery} initialError={result && !result.success ? result.error : null} />
  </div>;
  return <div className="mt-3 space-y-3 rounded-lg border border-slate-300 bg-slate-50 p-3" aria-label="Recoverable reassignment" aria-busy={busy}>
    {!context && !attempt && <button type="button" disabled={busy} onClick={() => void load()}
      className="min-h-11 rounded-lg border bg-white px-4 text-sm font-medium">{busy ? 'Checking access…' : 'Reassign'}</button>}
    {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
    {context && !attempt && <>
      <p className="text-sm text-slate-700">Review current ownership and choose an eligible recipient. Reassignment does not record acceptance, contact or completed care.</p>
      {!context.eligible ? <p role="status">Closed items and legacy ownership require separate review. This control cannot adopt, merge or reopen them.</p>
        : <form className="space-y-3" onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          if (!context.targets.some((candidate) => candidate.id === target)) { setError('Choose an eligible recipient from the current page.'); return; }
          const parsed = reassignmentSchema.safeParse({ requestId: crypto.randomUUID(), workItemId,
            patientId: context.patient_id, expectedAssignee: context.current_assignee,
            expectedRevision: context.current_revision, assigneeId: target, reason: form.get('reason') });
          if (!parsed.success) { setError('Choose an eligible recipient and document a reason of 3–500 characters.'); return; }
          void submit(parsed.data);
        }}>
          <label className="block text-sm font-medium">Reassign to
            <select name="assigneeId" required value={target} disabled={busy} onChange={(event) => setTarget(event.target.value)}
              className="mt-1 min-h-11 w-full rounded-md border bg-white px-3">
              <option value="" disabled>Choose an eligible recipient</option>
              {context.targets.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
            </select>
          </label>
          {context.targets.length === 0 && <p role="status">No eligible recipient is visible in this page. No access or monitoring authorization was granted by this control.</p>}
          <label className="block text-sm font-medium">Why is this being reassigned?
            <textarea name="reason" required minLength={3} maxLength={500} rows={2} disabled={busy} className="mt-1 w-full rounded-md border bg-white p-3" />
          </label>
          <button type="submit" disabled={busy || !target} className="min-h-11 rounded-lg border bg-white px-4 font-medium disabled:opacity-50">Reassign item</button>
        </form>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => void load()} className="min-h-11 rounded-lg border px-3 text-sm">Refresh ownership</button>
        {context.next_cursor && <button type="button" disabled={busy} onClick={() => void load(context.next_cursor)} className="min-h-11 rounded-lg border px-3 text-sm">Next recipients</button>}
      </div>
    </>}
    {attempt && busy && <p role="status">Waiting for the recorded result. The request identity and its details are fixed.</p>}
    {result && !result.success && <>
      <p role="alert" className="text-sm text-red-800">{result.error}</p>
      {result.status === 'unknown' && attempt && <button type="button" disabled={busy} onClick={() => void submit(attempt)}
        className="min-h-11 rounded-lg border bg-white px-4 font-medium">Recover this same request</button>}
      {result.status === 'rejected' && <button type="button" disabled={busy} onClick={() => void load()}
        className="min-h-11 rounded-lg border bg-white px-4 font-medium">Refresh and review again</button>}
    </>}
  </div>;
}
