'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { CareScope } from '@/lib/care-workflow/types';
import { canRecordCareStep, type CareWorkflowDetail } from '@/lib/care-workflow/step-types';
import { loadCompositionIntentions } from '@/lib/care-workflow/composition-actions';
import { acknowledgeUnsaved, applyUnsaved, cancelUnsaved, loadPendingUnsaved, loadUnsavedContext, loadUnsavedHistory,
  prepareUnsaved, recoverUnsaved } from '@/lib/care-workflow/unsaved-intent-actions';
import { unsavedInputFromState, validateNewUnsavedInput, type UnsavedContext, type UnsavedHistoryItem,
  type UnsavedInput, type UnsavedState } from '@/lib/care-workflow/unsaved-intent-types';

type Props = { scope: CareScope; workId: string; workflow: CareWorkflowDetail | null; peersReady: boolean; refreshToken: number;
  onReadiness: (ready: boolean) => void; onChanged: () => void };
type Target = NonNullable<Awaited<ReturnType<typeof loadCompositionIntentions>>['data']>['items'][number];
const button = 'min-h-11 rounded-lg border bg-white px-3 py-2 font-medium disabled:opacity-50';
const control = 'mt-1 min-h-11 w-full rounded-md border bg-white px-3 py-2';
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const uncertain = 'Administrative state is unconfirmed. Recover this exact request; do not replace its identity, target, evidence or revisions.';
function Snapshot({ value }: { value: UnsavedContext['snapshot'] }) {
  return <div className="space-y-1 break-words" aria-label="Exact unsaved intention snapshot">
    <p className="break-all">Intention: {value.intent_id}</p><p>Intention recorded: {value.recorded_at}</p>
    <p>{value.submission_status === 'awaiting_save' ? 'Submission has no saved result in this snapshot.' : 'Submission was already cancelled; its intention is still pending.'}</p>
    {value.submission_cancelled_at && <p>Original submission cancellation: {value.submission_cancelled_at}</p>}
  </div>;
}
function Evidence({ payload }: { payload: UnsavedInput['payload'] }) {
  return <div className="space-y-1 break-words"><Snapshot value={payload.snapshot} />
    <p>Administrative reason: {payload.reason}</p><p>Administrative evidence: {payload.evidence}</p>
    <p>Disposition occurred: {payload.occurred_at}</p><p>Unsaved cancellation explicitly acknowledged.</p></div>;
}
export function CareUnsavedIntentPanel(props: Props) {
  return <UnsavedStatePanel key={`${props.scope.actor_id}:${props.scope.organization_id}:${props.scope.patient_id}:${props.workId}`} {...props} />;
}
function UnsavedStatePanel({ scope, workId, workflow, peersReady, refreshToken, onReadiness, onChanged }: Props) {
  const [requests, setRequests] = useState<UnsavedState[]>([]), [complete, setComplete] = useState(false);
  const [targets, setTargets] = useState<Target[] | null>(null), [target, setTarget] = useState('');
  const [history, setHistory] = useState<UnsavedHistoryItem[] | null>(null);
  const [context, setContext] = useState<UnsavedContext | null>(null);
  const [selected, setSelected] = useState<UnsavedInput | null>(null), [saved, setSaved] = useState<UnsavedState | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [sessionChanged, setSessionChanged] = useState(false), [epoch, setEpoch] = useState(0);
  const live = useRef(true), generation = useRef(0), inFlight = useRef<'recovery' | 'current' | 'write' | null>(null);
  const callbacks = useRef({ onReadiness, onChanged }); callbacks.current = { onReadiness, onChanged };
  useEffect(() => {
    live.current = true;
    const { data: { subscription } } = createClient().auth.onAuthStateChange((_event, session) => {
      if (session?.user.id === scope.actor_id) return;
      live.current = false; generation.current += 1; setSessionChanged(true);
      setRequests([]); setTargets(null); setTarget(''); setHistory(null); setContext(null); setSelected(null); setSaved(null);
      callbacks.current.onReadiness(false);
    });
    return () => { live.current = false; generation.current += 1; subscription.unsubscribe(); callbacks.current.onReadiness(false); };
  }, [scope.actor_id]);
  const ownReady = complete && !requests.some((row) => same(row.work_item_id, workId)) && !selected && !busy;
  useEffect(() => { callbacks.current.onReadiness(live.current && ownReady); }, [ownReady, epoch]);
  function invalidateCurrent() {
    setContext(null); setTargets(null); setTarget(''); setHistory(null);
    if (inFlight.current === 'current') {
      generation.current += 1; inFlight.current = null; setBusy(false); setEpoch((value) => value + 1);
    }
  }
  const workflowRef = useRef(workflow);
  useEffect(() => {
    if (workflowRef.current === workflow) return;
    workflowRef.current = workflow; invalidateCurrent();
  }, [workflow]);
  const reload = useRef<() => void>(() => {});
  reload.current = () => {
    invalidateCurrent();
    // A current-state refresh must never invalidate an exact private write's response.
    if (selected || inFlight.current === 'write') return;
    if (inFlight.current === 'recovery') { generation.current += 1; inFlight.current = null; }
    void loadRecovery();
  };
  useEffect(() => { if (refreshToken > 0) reload.current(); }, [refreshToken]);
  async function loadRecovery() {
    if (!live.current || inFlight.current || selected) return;
    inFlight.current = 'recovery'; const version = ++generation.current;
    const valid = () => live.current && version === generation.current;
    setBusy(true); setError(null); setComplete(false); setRequests([]); setContext(null); callbacks.current.onReadiness(false);
    const all: UnsavedState[] = []; let after: string | null = null;
    try {
      for (;;) {
        const result = await loadPendingUnsaved({ ...scope, after });
        if (!valid()) return;
        if (!result.data || result.data.items.some((row) => all.some((old) => same(old.request_id, row.request_id)))) throw new Error('Incomplete recovery');
        all.push(...result.data.items); setRequests([...all]);
        const next: string | null = result.data.next_cursor;
        if (next === null) { setComplete(true); break; }
        if (after !== null && next.toLowerCase() <= after.toLowerCase()) throw new Error('Nonforward page');
        after = next;
      }
    } catch { if (valid()) setError('The full administrative recovery list could not be verified. Recover available private requests below; new preparation remains unavailable.'); }
    finally { if (valid()) { inFlight.current = null; setBusy(false); setEpoch((value) => value + 1); } }
  }
  async function loadCurrent(mode: 'targets' | 'history' | 'context') {
    if (!live.current || inFlight.current || selected || mode === 'context' && !targets?.some((row) => same(row.intent_id, target))) return;
    inFlight.current = 'current'; const version = ++generation.current;
    const valid = () => live.current && version === generation.current;
    setBusy(true); setError(null); callbacks.current.onReadiness(false);
    if (mode !== 'history') setContext(null);
    if (mode === 'targets') { setTargets(null); setTarget(''); }
    if (mode === 'history') setHistory(null);
    try {
      if (mode === 'context') {
        const response = await loadUnsavedContext({ ...scope, work_item_id: workId, intent_id: target });
        if (!valid()) return;
        if (!response.data) throw new Error('Unavailable target');
        setContext(response.data);
      } else {
        const allTargets: Target[] = [], allHistory: UnsavedHistoryItem[] = [];
        let after: string | null = null;
        for (;;) {
          let next: string | null;
          if (mode === 'targets') {
            const response = await loadCompositionIntentions({ ...scope, work_item_id: workId, after });
            if (!valid()) return;
            if (!response.data || response.data.items.some((row) => allTargets.some((old) => same(old.intent_id, row.intent_id)))) throw new Error('Incomplete targets');
            allTargets.push(...response.data.items); next = response.data.next_cursor;
          } else {
            const response = await loadUnsavedHistory({ ...scope, work_item_id: workId, after });
            if (!valid()) return;
            if (!response.data || response.data.items.some((row) => allHistory.some((old) => same(old.event_id, row.event_id)
              || same(old.intent_id, row.intent_id) || same(old.receipt.request_id, row.receipt.request_id)))) throw new Error('Incomplete history');
            allHistory.push(...response.data.items); next = response.data.next_cursor;
          }
          if (next === null) {
            if (mode === 'targets') setTargets(allTargets.filter((row) => ['awaiting_save', 'submission_cancelled'].includes(row.submission.status)));
            else setHistory(allHistory);
            break;
          }
          if (after !== null && next.toLowerCase() <= after.toLowerCase()) throw new Error('Nonforward page');
          after = next;
        }
      }
    } catch { if (valid()) setError('Current administrative evidence is unavailable or incomplete. Private recovery remains separate. Your own laboratory intention uses the existing laboratory recovery controls.'); }
    finally { if (valid()) { inFlight.current = null; setBusy(false); setEpoch((value) => value + 1); } }
  }
  async function operate(input: UnsavedInput, action: typeof prepareUnsaved) {
    if (!live.current || inFlight.current) return;
    inFlight.current = 'write'; const version = ++generation.current;
    setSelected(input); setSaved(null); setContext(null); setComplete(false); setBusy(true); setError(null); callbacks.current.onReadiness(false);
    try {
      const result = await action(input);
      if (!live.current || generation.current !== version) return;
      if (!result.data) setError(uncertain);
      else { setSaved(result.data); if (result.data.state === 'applied') callbacks.current.onChanged(); }
    } catch { if (live.current && generation.current === version) setError(uncertain); }
    finally { if (live.current && generation.current === version) { inFlight.current = null; setBusy(false); } }
  }
  const coherent = workflow?.kind === 'laboratory_order' && context !== null && context.workflow_revision === workflow.revision
    && context.ownership_revision === workflow.ownership_revision && same(context.snapshot.intent_id, target)
    && same(context.work_item_id, workId) && (['actor_id', 'organization_id', 'patient_id'] as const).every((key) => same(context[key], scope[key]));
  const mayPrepare = coherent && ownReady && peersReady && canRecordCareStep(workflow!, scope.actor_id);
  function prepare(form: HTMLFormElement) {
    if (!live.current || inFlight.current || !context || !mayPrepare) return;
    const values = new FormData(form), value = (key: string) => String(values.get(key) ?? '');
    const time = value('occurred_at');
    const input = validateNewUnsavedInput({ ...scope, request_id: '00000000-0000-4000-8000-000000000000', work_item_id: workId,
      intent_id: context.snapshot.intent_id, expected_revision: context.workflow_revision, expected_ownership_revision: context.ownership_revision,
      payload: { snapshot: context.snapshot, occurred_at: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(time) ? time + (time.length === 16 ? ':00Z' : 'Z') : '',
        evidence: value('evidence'), reason: value('reason'), unsaved_cancellation_acknowledged: values.get('ack') === 'on' } });
    if (!input) { setError('Supply an explicit cancellation acknowledgement, meaningful reason and evidence, and a nonfuture UTC occurrence after the displayed intention and any earlier cancellation.'); return; }
    void operate({ ...input, request_id: crypto.randomUUID() }, prepareUnsaved);
  }
  if (sessionChanged) return <p role="alert">Your session changed. Reload administrative recovery before continuing.</p>;
  return <section aria-label="Unsaved intention administration" aria-busy={busy} className="space-y-4 rounded-xl border border-amber-200 p-4 text-sm">
    <h2 className="text-lg font-bold">Resolve an unsaved former-owner intention</h2>
    <p>Synthetic information only. This is an explicit administrative cancellation, not a saved result, clinical review, contact or completed care. It does not close the workflow or create a deadline.</p>
    {!selected && <>
      <button className={button} disabled={busy} onClick={() => void loadRecovery()}>Check administrative pending records</button>
      {requests.length > 0 && <ul aria-label="Pending administrative requests" className="space-y-2">{requests.map((row) => <li key={row.request_id} className="rounded-lg border p-3 break-all">
        <p>{row.state === 'applied' ? 'Intention cancelled; receipt unacknowledged' : 'Prepared; intention not cancelled by this request'}</p>
        {same(row.work_item_id, workId) ? <button className={button} disabled={busy} onClick={() => void operate(unsavedInputFromState(row), recoverUnsaved)}>Recover administrative request {row.request_id}</button>
          : <a href={`/patients/${row.patient_id}/care/${row.work_item_id}?organization=${row.organization_id}`}>Open other follow-up</a>}
      </li>)}</ul>}
      <button className={button} disabled={busy} onClick={() => void loadCurrent('targets')}>Load pending laboratory intentions</button>
      <p>Only unsaved intentions can use this control. Saved results require source reconciliation. Eligibility requires the accepted current owner after responsibility changed; your own intention uses laboratory recovery.</p>
      {targets !== null && <label className="block">Unsaved intention to resolve<select className={control} value={target} disabled={busy} onChange={(event) => {
        if (inFlight.current === 'write') return;
        setContext(null); setTarget(event.target.value);
      }}><option value="" disabled>Choose an exact unsaved intention</option>{targets.map((row) =>
        <option key={row.intent_id} value={row.intent_id}>{row.intent_id} · {row.submission.status === 'submission_cancelled' ? 'Submission already cancelled' : 'Awaiting save'}</option>)}</select></label>}
      {targets?.length === 0 && <p>No unsaved intention appears in this complete list. This does not establish workflow completion.</p>}
      <button className={button} disabled={busy || !target} onClick={() => void loadCurrent('context')}>Verify exact unsaved intention</button>
      {context && <Snapshot value={context.snapshot} />}
      {mayPrepare && <form key={JSON.stringify(context)} aria-label="New administrative disposition" className="space-y-3" onSubmit={(event) => { event.preventDefault(); prepare(event.currentTarget); }}>
        <label className="block">Administrative cancellation reason<textarea className={control} name="reason" required minLength={3} maxLength={1000} /></label>
        <label className="block">Administrative cancellation evidence<textarea className={control} name="evidence" required minLength={3} maxLength={1000} /></label>
        <label className="block">Administrative occurrence at (UTC)<input className={control} name="occurred_at" type="datetime-local" step="1" required /></label>
        <label className="flex items-start gap-2"><input type="checkbox" name="ack" required className="mt-1" />I explicitly acknowledge cancelling this unsaved intention; no result or completed care is recorded</label>
        <button className={button} type="submit">Prepare administrative disposition</button>
      </form>}
      <button className={button} disabled={busy} onClick={() => void loadCurrent('history')}>Load administrative journal</button>
      {history !== null && <div aria-label="Administrative journal" className="space-y-3">
        <h3 className="font-semibold">Administrative journal — not clinical workflow progress</h3>
        <p>Complete paginated read, ordered by event identity. No revision increment is implied. Dates and earlier source states are historical.</p>
        {!history.length && <p>No administrative disposition recorded in this journal.</p>}
        {history.map((row) => <div key={row.event_id} className="rounded-lg border p-3"><Evidence payload={row.payload} />
          <p className="break-all">Recorded by: {row.actor_id} · Event: {row.event_id}</p><p>Administrative event recorded: {row.recorded_at}</p>
          <p>Submission cancelled: {row.receipt.submission_cancelled_at}</p><p>Intention cancelled: {row.receipt.intent_cancelled_at}</p>
          <p>Historical workflow revision: {row.receipt.workflow_revision} (unchanged by this disposition).</p></div>)}
      </div>}
    </>}
    {selected && <div aria-label="Frozen administrative disposition" className="space-y-3 rounded-lg border bg-amber-50 p-4">
      <h3 className="font-semibold">Frozen administrative disposition</h3><p className="break-all">Request: {selected.request_id}</p>
      <p>Expected workflow revision: {selected.expected_revision} · Ownership revision: {selected.expected_ownership_revision}</p>
      <Evidence payload={selected.payload} />
      {!saved && <p>Outcome unconfirmed. Keep this identity and recover it. After a revision or permission change, recover and cancel the still-prepared administrative request; never replace unknown evidence or infer absence from a failed read.</p>}
      {saved?.state === 'prepared' && <p role="status">Administrative preparation saved. The intention has not been cancelled by this request.</p>}
      {saved?.state === 'cancelled' && <p role="status">Administrative preparation cancelled. This does not cancel the laboratory intention.</p>}
      {saved?.state === 'applied' && <div role="status"><p>Unsaved intention cancelled. No result saved or linked, clinical review, confirmed contact or completed care was recorded.</p>
        <p>Administrative event recorded: {saved.receipt!.recorded_at}</p><p>Submission cancelled: {saved.receipt!.submission_cancelled_at}</p>
        <p>Intention cancelled: {saved.receipt!.intent_cancelled_at}</p><p>Workflow revision remains {saved.receipt!.workflow_revision}; this historical receipt is not a fresh workflow snapshot.</p></div>}
      <div className="flex flex-wrap gap-2">
        <button className={button} disabled={busy} onClick={() => void operate(selected, recoverUnsaved)}>Check saved administrative request</button>
        {!saved && <button className={button} disabled={busy} onClick={() => void operate(selected, prepareUnsaved)}>Retry administrative preparation with same ID</button>}
        {saved?.state === 'prepared' && <><button className={button} disabled={busy} onClick={() => void operate(selected, applyUnsaved)}>Confirm cancellation of unsaved intention</button>
          <button className={button} disabled={busy} onClick={() => void operate(selected, cancelUnsaved)}>Cancel administrative preparation only</button></>}
        {saved?.state === 'applied' && !saved.acknowledged_at && <button className={button} disabled={busy} onClick={() => void operate(selected, acknowledgeUnsaved)}>Acknowledge administrative receipt</button>}
        {(saved?.state === 'cancelled' || saved?.acknowledged_at) && <button className={button} disabled={busy} onClick={() => {
          setSelected(null); setSaved(null); setRequests([]); setComplete(false); invalidateCurrent(); callbacks.current.onChanged();
        }}>Return to administrative recovery</button>}
      </div>
    </div>}
    {busy && <p role="status">Checking authorized administrative state…</p>}
    {error && <p role="alert" className="text-red-800">{error}</p>}
  </section>;
}
