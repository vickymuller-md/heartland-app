'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { CareScope } from '@/lib/care-workflow/types';
import { canRecordCareStep, type CareWorkflowDetail } from '@/lib/care-workflow/step-types';
import { labCollectionMicros } from '@/lib/labs/quality';
import { acknowledgePostclosure, applyPostclosure, cancelPostclosure, loadPendingPostclosure, loadPostclosureContext,
  preparePostclosure, recoverPostclosure } from '@/lib/care-workflow/postclosure-actions';
import { postclosureInputFromState, validateNewPostclosure, type PostclosureContext, type PostclosureInput,
  type PostclosureNeed, type PostclosureState } from '@/lib/care-workflow/postclosure-types';
import { PostclosureNeedsReader, PostclosureOrigin } from './care-postclosure-needs-panel';

type Props = { scope: CareScope; workId: string; workflow: CareWorkflowDetail | null; peersReady: boolean; refreshToken: number;
  onReadiness: (ready: boolean) => void; onChanged: () => void };
const button = 'min-h-11 rounded-lg border bg-white px-3 py-2 font-medium disabled:opacity-50';
const control = 'mt-1 min-h-11 w-full rounded-md border bg-white px-3 py-2';
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const uncertain = 'Routing outcome is unconfirmed. Recover this exact request; do not replace its identity, origin, successor, evidence or revisions.';
function Evidence({ input }: { input: PostclosureInput }) {
  return <div className="space-y-1 break-words"><PostclosureOrigin snapshot={input.payload.snapshot} />
    <p className="break-all">Selected successor: {input.work_item_id}</p>
    <p>Expected routing revision: {input.expected_routing_revision} · Previous event: {input.previous_event_id ?? 'None (first routing)'}</p>
    <p>Expected workflow revision: {input.expected_revision} · Ownership revision: {input.expected_ownership_revision}</p>
    <p>Routing reason: {input.payload.reason}</p><p>Routing evidence: {input.payload.evidence}</p><p>Routing occurred: {input.payload.occurred_at}</p>
    <p>Existing successor review time explicitly acknowledged: {input.payload.review_at}</p>
    <p>{input.payload.supersession_acknowledged ? 'Replacement explicitly acknowledged; no earlier successor is cancelled.' : 'First delegation; responsibility explicitly acknowledged.'}</p></div>;
}
export function CarePostclosurePanel(props: Props) {
  return <RoutingState key={`${props.scope.actor_id}:${props.scope.organization_id}:${props.scope.patient_id}:${props.workId}`} {...props} />;
}
function RoutingState({ scope, workId, workflow, peersReady, refreshToken, onReadiness, onChanged }: Props) {
  const [requests, setRequests] = useState<PostclosureState[]>([]), [complete, setComplete] = useState(false);
  const [target, setTarget] = useState<PostclosureNeed | null>(null), [context, setContext] = useState<PostclosureContext | null>(null);
  const [selected, setSelected] = useState<PostclosureInput | null>(null), [saved, setSaved] = useState<PostclosureState | null>(null);
  const [phase, setPhase] = useState<'recovery' | 'current' | 'write' | null>(null), [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false), [epoch, setEpoch] = useState(0), [currentEpoch, setCurrentEpoch] = useState(0);
  const live = useRef(true), generation = useRef(0), inFlight = useRef<typeof phase>(null);
  const callbacks = useRef({ onReadiness, onChanged }); callbacks.current = { onReadiness, onChanged };
  useEffect(() => {
    live.current = true;
    const { data: { subscription } } = createClient().auth.onAuthStateChange((_event, session) => {
      if (session?.user.id === scope.actor_id) return;
      live.current = false; generation.current += 1; setInvalid(true); setRequests([]); setTarget(null); setContext(null); setSelected(null); setSaved(null);
      callbacks.current.onReadiness(false);
    });
    return () => { live.current = false; generation.current += 1; subscription.unsubscribe(); callbacks.current.onReadiness(false); };
  }, [scope.actor_id]);
  // Current needs/history/candidate reads and peer readiness are deliberately not dependencies of own recovery readiness.
  const ownReady = complete && !requests.some((row) => same(row.work_item_id, workId)) && !selected && phase !== 'write' && phase !== 'recovery';
  useEffect(() => { callbacks.current.onReadiness(live.current && ownReady); }, [ownReady, epoch]);
  function invalidateCurrent() {
    setTarget(null); setContext(null); setCurrentEpoch((value) => value + 1);
    if (inFlight.current === 'current') { generation.current++; inFlight.current = null; setPhase(null); }
  }
  const workflowRef = useRef(workflow);
  useEffect(() => {
    if (workflowRef.current === workflow) return;
    workflowRef.current = workflow; invalidateCurrent();
  }, [workflow]);
  const reload = useRef<() => void>(() => {});
  reload.current = () => {
    invalidateCurrent();
    // Preserve a frozen write's response even when another panel invalidates current clinical detail.
    if (selected || inFlight.current === 'write') return;
    if (inFlight.current === 'recovery') { generation.current++; inFlight.current = null; }
    void loadRecovery();
  };
  useEffect(() => { if (refreshToken > 0) reload.current(); }, [refreshToken]);
  async function loadRecovery() {
    if (!live.current || inFlight.current || selected) return;
    inFlight.current = 'recovery'; const version = ++generation.current;
    const valid = () => live.current && generation.current === version;
    setPhase('recovery'); setError(null); setRequests([]); setComplete(false); setContext(null); callbacks.current.onReadiness(false);
    const all: PostclosureState[] = []; let after: string | null = null;
    try {
      for (;;) {
        const result = await loadPendingPostclosure({ ...scope, after });
        if (!valid()) return;
        if (!result.data || result.data.items.some((row) => all.some((old) => same(old.request_id, row.request_id)))) throw new Error('Incomplete recovery');
        all.push(...result.data.items); setRequests([...all]);
        const next: string | null = result.data.next_cursor;
        if (next === null) { setComplete(true); break; }
        if (after !== null && next.toLowerCase() <= after.toLowerCase()) throw new Error('Nonforward recovery');
        after = next;
      }
    } catch { if (valid()) setError('Routing recovery is incomplete. Available private requests can still be recovered below; fresh preparation remains unavailable.'); }
    finally { if (valid()) { inFlight.current = null; setPhase(null); setEpoch((value) => value + 1); } }
  }
  async function verify() {
    if (!live.current || inFlight.current || selected || !target) return;
    inFlight.current = 'current'; const version = ++generation.current;
    setPhase('current'); setContext(null); setError(null);
    try {
      const result = await loadPostclosureContext({ ...scope, invalidation_id: target.invalidation_id, work_item_id: workId });
      if (!live.current || version !== generation.current) return;
      if (!result.data) setError('This successor and origin could not be verified for fresh routing. Private recovery remains available independently.');
      else setContext(result.data);
    } catch { if (live.current && version === generation.current) setError('Fresh routing context is unavailable. Private recovery remains separate.'); }
    finally { if (live.current && version === generation.current) { inFlight.current = null; setPhase(null); } }
  }
  async function operate(input: PostclosureInput, action: typeof preparePostclosure) {
    if (!live.current || inFlight.current) return;
    inFlight.current = 'write'; const version = ++generation.current;
    setSelected(input); setSaved(null); setContext(null); setComplete(false); setPhase('write'); setError(null); callbacks.current.onReadiness(false);
    try {
      const result = await action(input);
      if (!live.current || version !== generation.current) return;
      if (!result.data) setError(uncertain);
      else { setSaved(result.data); if (result.data.state === 'applied') callbacks.current.onChanged(); }
    } catch { if (live.current && version === generation.current) setError(uncertain); }
    finally { if (live.current && version === generation.current) { inFlight.current = null; setPhase(null); } }
  }
  const coherent = workflow?.kind === 'laboratory_order' && workflow.stage === 'requested' && workflow.revision === '1' && context !== null
    && context.workflow_revision === workflow.revision && context.ownership_revision === workflow.ownership_revision
    && same(context.work_item_id, workId) && target !== null && same(context.snapshot.invalidation_id, target.invalidation_id)
    && JSON.stringify(context.snapshot) === JSON.stringify(target.snapshot)
    && (['actor_id', 'organization_id', 'patient_id'] as const).every((key) => same(context[key], scope[key]));
  const sameTargetPending = target !== null && requests.some((row) => same(row.invalidation_id, target.invalidation_id));
  const mayPrepare = coherent && ownReady && peersReady && !sameTargetPending && canRecordCareStep(workflow!, scope.actor_id);
  function prepare(form: HTMLFormElement) {
    if (!live.current || inFlight.current || !context || !mayPrepare) return;
    const values = new FormData(form), value = (key: string) => String(values.get(key) ?? ''), time = value('occurred_at');
    const input = validateNewPostclosure({ ...scope, request_id: '00000000-0000-4000-8000-000000000000', work_item_id: workId,
      invalidation_id: context.snapshot.invalidation_id, predecessor_work_item_id: context.snapshot.predecessor_work_item_id,
      expected_revision: context.workflow_revision, expected_ownership_revision: context.ownership_revision,
      expected_routing_revision: context.routing_revision, previous_event_id: context.previous_event_id,
      payload: { snapshot: context.snapshot, occurred_at: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(time) ? time + (time.length === 16 ? ':00Z' : 'Z') : '',
        reason: value('reason'), evidence: value('evidence'), review_at: context.review_at,
        responsibility_acknowledged: values.get('responsibility') === 'on', supersession_acknowledged: values.get('supersession') === 'on' } });
    if (!input || labCollectionMicros(input.payload.occurred_at)! < labCollectionMicros(context.successor_created_at)!
      || labCollectionMicros(input.payload.occurred_at)! < labCollectionMicros(context.successor_accepted_at)!) {
      setError('Provide meaningful reason and evidence, explicit responsibility/review acknowledgement and any required replacement acknowledgement. The UTC occurrence must follow the origin, successor creation and acceptance, must not be future, and the existing review time must still be future.'); return;
    }
    void operate({ ...input, request_id: crypto.randomUUID() }, preparePostclosure);
  }
  if (invalid) return <p role="alert">Your session changed. Reload routing recovery before continuing.</p>;
  const busy = phase !== null;
  return <section aria-label="Post-closure routing recovery" aria-busy={busy} className="space-y-4 rounded-xl border border-amber-200 p-4 text-sm">
    <h2 className="text-lg font-bold">Route a post-closure source change</h2>
    <p>Synthetic information only. Explicit delegation to this accepted laboratory follow-up is not clinical reconciliation, review, confirmed communication or completed care. The closed predecessor remains unchanged. No deadline is invented or overwritten.</p>
    {!selected && <>
      <button className={button} disabled={busy} onClick={() => void loadRecovery()}>Check routing pending records</button>
      {requests.length > 0 && <ul aria-label="Pending routing requests" className="space-y-2">{requests.map((row) => <li key={row.request_id} className="rounded-lg border p-3 break-all">
        <p>{row.state === 'applied' ? 'Delegated; receipt unacknowledged' : 'Prepared; not delegated by this request'}</p>
        <p>Source-change record: {row.invalidation_id}</p>
        {same(row.work_item_id, workId) ? <button className={button} disabled={busy} onClick={() => void operate(postclosureInputFromState(row), recoverPostclosure)}>Recover routing request {row.request_id}</button>
          : <a className="underline" href={`/patients/${row.patient_id}/care/${row.work_item_id}?organization=${row.organization_id}`}>Open other routing follow-up {row.work_item_id}</a>}
      </li>)}</ul>}
      <PostclosureNeedsReader key={currentEpoch} scope={scope} disabled={busy} onSelect={(need) => { setTarget(need); setContext(null); }} />
      <button className={button} disabled={busy || !target} onClick={() => void verify()}>Verify this successor for selected origin</button>
      <p>Fresh routing requires all recovery families to be complete, current accepted responsibility, an untouched initial laboratory follow-up, and exact current routing context. History and needs reads do not block private recovery.</p>
      {sameTargetPending && <p>An own pending request already references this origin. Recover it through its follow-up above before preparing another.</p>}
      {context && <div aria-label="Verified routing context"><p className="break-all">Proposed successor: {context.work_item_id}</p>
        <p>Successor created: {context.successor_created_at} · Responsibility accepted: {context.successor_accepted_at}</p>
        <p>Existing review time to acknowledge: {context.review_at}</p><p>Current routing revision: {context.routing_revision}</p>
        {context.previous_work_item_id && <p className="break-all">Earlier successor to replace: {context.previous_work_item_id}. It will not be cancelled.</p>}</div>}
      {mayPrepare && <form key={JSON.stringify(context)} aria-label="New post-closure routing" className="space-y-3" onSubmit={(event) => { event.preventDefault(); prepare(event.currentTarget); }}>
        <label className="block">Routing reason<textarea className={control} name="reason" required minLength={3} maxLength={1000} /></label>
        <label className="block">Routing evidence<textarea className={control} name="evidence" required minLength={3} maxLength={1000} /></label>
        <label className="block">Routing occurrence at (UTC)<input className={control} name="occurred_at" type="datetime-local" step="1" required /></label>
        <label className="flex items-start gap-2"><input type="checkbox" name="responsibility" required className="mt-1" />I acknowledge accepted responsibility and the displayed existing review time for this successor</label>
        {context!.routing_revision !== '0' && <label className="flex items-start gap-2"><input type="checkbox" name="supersession" required className="mt-1" />I explicitly replace the earlier routing without cancelling the earlier successor</label>}
        <button className={button} type="submit">Prepare routing for review</button>
      </form>}
    </>}
    {selected && <div aria-label="Frozen post-closure routing" className="space-y-3 rounded-lg border bg-amber-50 p-4">
      <h3 className="font-semibold">Frozen post-closure routing</h3><p className="break-all">Request: {selected.request_id}</p><Evidence input={selected} />
      {!saved && <p>Outcome unconfirmed. Keep this exact identity. Recovery never requires a fresh clinical snapshot; failed reads do not establish absence. Recover and cancel a still-prepared request before replacing stale evidence.</p>}
      {saved?.state === 'prepared' && <p role="status">Routing preparation saved. No delegation recorded by this request.</p>}
      {saved?.state === 'cancelled' && <p role="status">Routing preparation cancelled. The origin and any earlier routing remain unchanged.</p>}
      {saved?.state === 'applied' && <div role="status"><p>Delegation recorded, not clinical resolution. No clinical review, confirmed contact or completed care recorded.</p>
        <p>Historical routing revision: {saved.receipt!.routing_revision} · Recorded: {saved.receipt!.recorded_at}</p>
        <p>Workflow revision remains {saved.receipt!.workflow_revision}. This historical receipt does not prove current responsibility or a current deadline.</p></div>}
      <div className="flex flex-wrap gap-2">
        <button className={button} disabled={busy} onClick={() => void operate(selected, recoverPostclosure)}>Check saved routing request</button>
        {!saved && <button className={button} disabled={busy} onClick={() => void operate(selected, preparePostclosure)}>Retry routing preparation with same ID</button>}
        {saved?.state === 'prepared' && <><button className={button} disabled={busy} onClick={() => void operate(selected, applyPostclosure)}>Confirm explicit delegation</button>
          <button className={button} disabled={busy} onClick={() => void operate(selected, cancelPostclosure)}>Cancel routing preparation only</button></>}
        {saved?.state === 'applied' && !saved.acknowledged_at && <button className={button} disabled={busy} onClick={() => void operate(selected, acknowledgePostclosure)}>Acknowledge routing receipt</button>}
        {(saved?.state === 'cancelled' || saved?.acknowledged_at) && <button className={button} disabled={busy} onClick={() => {
          setSelected(null); setSaved(null); setRequests([]); setComplete(false); invalidateCurrent(); callbacks.current.onChanged();
        }}>Return to routing recovery</button>}
      </div>
    </div>}
    {busy && <p role="status">Checking authorized routing state…</p>}
    {error && <p role="alert" className="text-red-800">{error}</p>}
  </section>;
}
