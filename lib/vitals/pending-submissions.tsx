'use client';

import { useEffect, useState } from 'react';
import { listPendingVitalsSubmissions, recoverVitalsSubmission } from './submission-actions';
import type { VitalsActionState } from './types';
import { mergeRecoveredVitals } from './recovery-state';

export function PendingVitalsSubmissions({ patientId, refreshKey }: { patientId?: string; refreshKey?: string }) {
  const [offset, setOffset] = useState(0);
  const [version, setVersion] = useState(0);
  const [rows, setRows] = useState<VitalsActionState[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [reviewed, setReviewed] = useState<VitalsActionState>();
  useEffect(() => {
    let active = true;
    setBusy(true);
    setRows([]);
    void listPendingVitalsSubmissions(patientId, offset).then((result) => {
      if (!active) return;
      setError(result.error);
      if (!result.error) { setRows(result.receipts ?? []); setTotal(result.total ?? 0); }
    }).catch(() => { if (active) setError('Could not load pending evaluations. Reconnect and retry.'); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [patientId, refreshKey, offset, version]);

  async function retry(requestId: string) {
    if (busy) return;
    setBusy(true);
    try {
      const result = await recoverVitalsSubmission(patientId, requestId);
      setReviewed((previous) => mergeRecoveredVitals(previous ?? {}, result, requestId));
      setVersion((value) => value + 1);
    } catch { setReviewed((previous) => mergeRecoveredVitals(previous ?? {}, {
      error: 'Evaluation could not be checked. The saved record remains pending.', errorKind: 'unavailable',
    }, requestId)); }
    finally { setBusy(false); }
  }

  if (!total && !error && !reviewed) return null;
  return <section aria-label="Pending Evaluations" className="mb-6 space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4">
    <h2 className="text-lg font-semibold">Pending Evaluations ({total})</h2>
    <p className="text-base">These records are already saved. Acknowledging receipt did not complete evaluation or confirm care-team contact.</p>
    {error && <p role="alert">{error}</p>}
    <button type="button" onClick={() => setVersion((value) => value + 1)} disabled={busy} className="min-h-[48px] underline">Refresh Pending Evaluations</button>
    {rows.map((row) => <div key={row.requestId} className="rounded border border-amber-300 bg-white p-3">
      <p>{row.vitals?.recorded_at} · {row.vitals?.weight_lbs} lbs · {row.evaluationStatus}</p>
      <button type="button" disabled={busy} onClick={() => void retry(row.requestId!)} className="min-h-[48px] underline">Retry Saved Evaluation</button>
    </div>)}
    {reviewed && <div role="status">
      {reviewed.vitals && <p>Reviewed saved entry: {reviewed.vitals.recorded_at} · {reviewed.vitals.weight_lbs} lbs</p>}
      <p>{reviewed.success ? 'Saved evaluation completed. This is not confirmation of care-team contact.' : reviewed.error ?? 'Evaluation remains pending.'}</p>
      {!!reviewed.redFlags?.length && <ul role="alert">{reviewed.redFlags.map((flag) => <li key={flag.id}>{flag.message} — {flag.action}</li>)}</ul>}
    </div>}
    <div className="flex gap-4">
      {offset > 0 && <button type="button" disabled={busy} onClick={() => setOffset(Math.max(0, offset - 20))} className="min-h-[48px] underline">Previous Pending Records</button>}
      {offset + 20 < total && <button type="button" disabled={busy} onClick={() => setOffset(offset + 20)} className="min-h-[48px] underline">Next Pending Records</button>}
    </div>
  </section>;
}
