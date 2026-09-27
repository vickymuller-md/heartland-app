'use client';

import { useEffect, useRef, useState } from 'react';
import { assignWorkItem, designatePatientAccountable } from '@/lib/daily-loop/actions';
import { loadTransferContext, loadDesignationContext } from '@/lib/daily-loop/ownership-context-actions';
import { OWNERSHIP_CONTEXT_UNAVAILABLE, OWNERSHIP_WRITE_UNCONFIRMED,
  type TransferContext, type DesignationContext } from '@/lib/daily-loop/ownership-context';

type Props = { scopeKey: string } & ({ kind: 'offer'; workItemId: string }
  | { kind: 'designation'; organizationId: string; patientId: string });
export function OwnershipSelector(props: Props) {
  const identity = props.kind === 'offer' ? props.workItemId : `${props.organizationId}:${props.patientId}`;
  return <SelectorState key={`${props.scopeKey}:${props.kind}:${identity}`} {...props} />;
}
function SelectorState(props: Props) {
  const [context, setContext] = useState<TransferContext | DesignationContext | null>(null);
  const [target, setTarget] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const generation = useRef(0);
  useEffect(() => () => { generation.current += 1; }, []);

  async function load(after: string | null = null) {
    if (inFlight.current) return;
    inFlight.current = true;
    const current = ++generation.current;
    setBusy(true); setContext(null); setTarget(''); setError(null); setNotice(null);
    try {
      const result = props.kind === 'offer'
        ? await loadTransferContext({ workItemId: props.workItemId, after })
        : await loadDesignationContext({ organizationId: props.organizationId, patientId: props.patientId, after });
      if (current !== generation.current) return;
      setContext(result.data); setError(result.error);
      const data = result.data;
      if (data && 'current' in data && data.current && data.targets.some((candidate) => candidate.id === data.current!.id)) setTarget(data.current.id);
    } catch {
      if (current === generation.current) setError(OWNERSHIP_CONTEXT_UNAVAILABLE);
    } finally {
      if (current === generation.current) { inFlight.current = false; setBusy(false); }
    }
  }
  async function submit() {
    if (inFlight.current || !context || !context.targets.some((candidate) => candidate.id === target)) return;
    if ('eligible' in context && !context.eligible) return;
    inFlight.current = true;
    const current = ++generation.current;
    const chosen = target;
    // Only a fresh read can restore the form after any write, including an ambiguous response.
    setBusy(true); setContext(null); setTarget(''); setError(null); setNotice(null);
    try {
      const result = props.kind === 'offer' && 'work_item_id' in context
        ? await assignWorkItem({ workItemId: context.work_item_id, patientId: context.patient_id, assigneeId: chosen })
        : props.kind === 'designation' && 'organization_id' in context
          ? await designatePatientAccountable({ organizationId: context.organization_id, patientId: context.patient_id, accountableId: chosen }) : null;
      if (current !== generation.current) return;
      if (result?.success === true) setNotice(props.kind === 'offer'
        ? 'Transfer offer recorded. The current owner remains responsible until the recipient accepts.'
        : 'Designation recorded for future work in this organization. Existing work was not transferred.');
      else setError(OWNERSHIP_WRITE_UNCONFIRMED);
    } catch {
      if (current === generation.current) setError(OWNERSHIP_WRITE_UNCONFIRMED);
    } finally {
      if (current === generation.current) { inFlight.current = false; setBusy(false); }
    }
  }
  const offer = context && 'eligible' in context ? context : null;
  const designation = context && 'current' in context ? context : null;
  return <section className="mt-3 space-y-3 rounded-lg border bg-slate-50 p-3 text-sm"
    aria-label={props.kind === 'offer' ? 'Transfer recipient review' : 'Designation recipient review'} aria-busy={busy}>
    <button type="button" disabled={busy} onClick={() => void load()} className="min-h-11 rounded-lg border bg-white px-3 font-medium">
      {props.kind === 'offer' ? 'Review eligible transfer recipients' : 'Load current responsibility'}
    </button>
    {busy && <p role="status">Checking current authority and the requested operation…</p>}
    {error && <p role="alert" className="text-red-800">{error}</p>}
    {notice && <p role="status" className="text-emerald-900">{notice}</p>}
    {designation && <p data-testid="accountability-current">{designation.current
      ? `Currently designated in this organization: ${designation.current.name}` : 'No accountable provider designated in this organization.'}</p>}
    {designation?.current && !designation.targets.some((candidate) => candidate.id === designation.current!.id)
      && <p>The current designation is not selectable on this eligible page. It may be outside this page or no longer eligible; it has not been replaced.</p>}
    {offer?.pending_recipient && <p role="status" className="break-words">An offer is already pending for recipient ID {offer.pending_recipient}. No new offer can be submitted here while it remains pending. Ownership has not transferred by this offer.</p>}
    {offer && !offer.eligible && !offer.pending_recipient && <p role="status">This item is not open for a new transfer offer.</p>}
    {context && (!offer || offer.eligible) && <>
      <p>Only currently eligible recipients appear. Access is checked again when saving; this list grants no authorization.</p>
      {context.targets.length === 0 ? <p role="status">No eligible recipient is visible on this page.</p>
        : <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <label className="block font-medium">{props.kind === 'offer' ? 'Transfer recipient' : 'Accountable provider'}
            <select value={target} disabled={busy} onChange={(event) => setTarget(event.target.value)} required className="mt-1 min-h-11 w-full rounded-md border bg-white px-3">
              <option value="" disabled>Choose an eligible recipient</option>
              {context.targets.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
            </select>
          </label>
          <button type="submit" disabled={busy || !target} className="min-h-11 rounded-lg border bg-white px-3 font-medium">
            {props.kind === 'offer' ? 'Confirm transfer offer' : 'Save designation'}
          </button>
        </form>}
      {context.next_cursor && <button type="button" disabled={busy} onClick={() => void load(context.next_cursor)} className="min-h-11 rounded-lg border px-3 font-medium">Next eligible recipients</button>}
    </>}
  </section>;
}
