'use client';

import { useEffect, useRef, useState } from 'react';
import { SavedReassignment } from '@/components/saved-reassignment';
import { loadMyReassignmentRequests } from '@/lib/daily-loop/reassignment-actions';
import { REASSIGNMENT_UNAVAILABLE, type ReassignmentPage } from '@/lib/daily-loop/reassignment';

type Props = { scopeKey: string; initial: { data: ReassignmentPage | null; error: string | null } };
export function ReassignmentRequestsPanel(props: Props) {
  return <RequestsState key={props.scopeKey} {...props} />;
}
function RequestsState({ initial }: Props) {
  const [result, setResult] = useState(initial);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const inFlight = useRef(false);
  useEffect(() => () => { generation.current += 1; }, []);
  async function load(after: string | null) {
    if (inFlight.current) return;
    inFlight.current = true;
    const current = ++generation.current;
    setBusy(true); setResult({ data: null, error: null });
    try {
      const next = await loadMyReassignmentRequests(after);
      if (current === generation.current) setResult(next);
    } catch {
      if (current === generation.current) setResult({ data: null, error: REASSIGNMENT_UNAVAILABLE });
    } finally {
      if (current === generation.current) { inFlight.current = false; setBusy(false); }
    }
  }
  return <section aria-label="Pending reassignment requests" aria-busy={busy} className="space-y-4">
    <button type="button" disabled={busy} onClick={() => void load(null)} className="min-h-11 rounded-lg border px-4 font-medium">Refresh from first page</button>
    {busy && <p role="status">Loading your current authorized requests…</p>}
    {result.error && <p role="alert" className="text-red-800">{result.error}</p>}
    {result.data && <>
      {result.data.inaccessible_count > 0 && <p role="status">{result.data.inaccessible_count} of your pending requests cannot be displayed with your current access. No patient or item identifiers are shown for them.</p>}
      {result.data.items.length === 0 && <p>No pending requests are visible on this page within your current access. This is not a clinical all-clear.</p>}
      <ul className="space-y-4">{result.data.items.map((saved) => <li key={saved.request.requestId} className="rounded-lg border bg-slate-50 p-4">
        <SavedReassignment initial={saved} />
      </li>)}</ul>
      {result.data.next_cursor && <button type="button" disabled={busy} onClick={() => void load(result.data!.next_cursor)} className="min-h-11 rounded-lg border px-4 font-medium">Next requests</button>}
    </>}
  </section>;
}
