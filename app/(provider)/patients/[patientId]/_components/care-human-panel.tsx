'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { labCollectionMicros } from '@/lib/labs/quality';
import type { CareScope } from '@/lib/care-workflow/types';
import { canRecordCareStep, type CareWorkflowDetail } from '@/lib/care-workflow/step-types';
import { acknowledgeHuman, applyHuman, cancelHuman, loadHumanContext, loadPendingHuman, prepareHuman, recoverHuman } from '@/lib/care-workflow/human-actions';
import { humanCommandSchema, humanInputFromState, validateNewHumanInput, type HumanContext, type HumanInput, type HumanState } from '@/lib/care-workflow/human-types';
import { CareHumanBasis, CareHumanEvidence } from './care-human-evidence';

type Props = { scope: CareScope; workId: string; workflow: CareWorkflowDetail | null; peersReady: boolean; refreshToken: number;
  onReadiness: (ready: boolean) => void; onChanged: () => void };
const button = 'min-h-11 rounded-lg border bg-white px-3 py-2 font-medium disabled:opacity-50';
const control = 'mt-1 min-h-11 w-full rounded-md border bg-white px-3 py-2';
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const uncertain = 'Human record state is unconfirmed. Recover the exact request; do not replace its ID, evidence, payload or revisions.';
const label = (value: string) => value.replaceAll('_', ' ');

export function CareHumanPanel(props: Props) {
  return <HumanStatePanel key={`${props.scope.actor_id}:${props.scope.organization_id}:${props.scope.patient_id}:${props.workId}`} {...props} />;
}
function HumanStatePanel({ scope, workId, workflow, peersReady, refreshToken, onReadiness, onChanged }: Props) {
  const [context, setContext] = useState<HumanContext | null>(null);
  const [command, setCommand] = useState<HumanInput['command']>('record_review');
  const [requests, setRequests] = useState<HumanState[]>([]);
  const [complete, setComplete] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const [selected, setSelected] = useState<HumanInput | null>(null);
  const [saved, setSaved] = useState<HumanState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionChanged, setSessionChanged] = useState(false);
  const live = useRef(true), generation = useRef(0), inFlight = useRef<'recovery' | 'context' | 'write' | null>(null);
  const callbacks = useRef({ onReadiness, onChanged }); callbacks.current = { onReadiness, onChanged };
  useEffect(() => {
    live.current = true;
    const { data: { subscription } } = createClient().auth.onAuthStateChange((_event, session) => {
      if (session?.user.id === scope.actor_id) return;
      live.current = false; generation.current += 1; setSessionChanged(true);
      setContext(null); setSelected(null); setSaved(null); setRequests([]); callbacks.current.onReadiness(false);
    });
    return () => { live.current = false; generation.current += 1; subscription.unsubscribe(); callbacks.current.onReadiness(false); };
  }, [scope.actor_id]);
  const own = requests.filter((row) => same(row.work_item_id, workId));
  const ownReady = complete && !own.length && !selected && !busy;
  useEffect(() => { callbacks.current.onReadiness(live.current && ownReady); }, [ownReady, epoch]);
  function invalidateContext() {
    setContext(null);
    if (inFlight.current === 'context') {
      generation.current += 1; inFlight.current = null; setBusy(false); setEpoch((value) => value + 1);
    }
  }
  const workflowRef = useRef(workflow);
  useEffect(() => {
    if (workflowRef.current === workflow) return;
    workflowRef.current = workflow; invalidateContext();
  }, [workflow]);
  const reload = useRef<() => void>(() => {});
  reload.current = () => {
    invalidateContext();
    // Refresh only current reads. A frozen private write must still deliver its receipt.
    if (selected || inFlight.current === 'write') return;
    if (inFlight.current === 'recovery') { generation.current += 1; inFlight.current = null; }
    void loadRecovery();
  };
  useEffect(() => { if (refreshToken > 0) reload.current(); }, [refreshToken]);
  async function loadRecovery() {
    if (!live.current || inFlight.current || selected) return;
    inFlight.current = 'recovery'; const version = ++generation.current;
    const valid = () => live.current && version === generation.current;
    setBusy(true); setError(null); setContext(null); setComplete(false); setRequests([]); callbacks.current.onReadiness(false);
    const all: HumanState[] = []; let after: string | null = null;
    try {
      for (;;) {
        const result = await loadPendingHuman({ ...scope, after });
        if (!valid()) return;
        if (!result.data) throw new Error('Incomplete recovery');
        all.push(...result.data.items); setRequests([...all]);
        const next: string | null = result.data.next_cursor;
        if (next === null) { setComplete(true); break; }
        if (after !== null && next.toLowerCase() <= after.toLowerCase()) throw new Error('Nonforward page');
        after = next;
      }
    } catch { if (valid()) setError('The full human recovery list could not be verified. Recover available private requests below; new records remain unavailable.'); }
    finally { if (valid()) { inFlight.current = null; setBusy(false); setEpoch((value) => value + 1); } }
  }
  async function loadContext() {
    if (!live.current || inFlight.current || selected) return;
    inFlight.current = 'context'; const version = ++generation.current;
    setBusy(true); setError(null); setContext(null); callbacks.current.onReadiness(false);
    try {
      const result = await loadHumanContext({ ...scope, work_item_id: workId, command });
      if (!live.current || generation.current !== version) return;
      setContext(result.data);
      if (!result.data) setError('Current human evidence is unavailable. Private request recovery remains separate; no new record can be prepared.');
    } catch { if (live.current && generation.current === version) setError('Current human evidence could not be loaded.'); }
    finally { if (live.current && generation.current === version) { inFlight.current = null; setBusy(false); setEpoch((value) => value + 1); } }
  }
  async function operate(input: HumanInput, action: typeof prepareHuman) {
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
  const coherent = !!workflow && !!context && context.command === command && context.kind === workflow.kind
    && context.stage === workflow.stage && context.workflow_revision === workflow.revision && context.ownership_revision === workflow.ownership_revision
    && same(context.actor_id, scope.actor_id) && same(context.patient_id, scope.patient_id) && same(context.organization_id, scope.organization_id)
    && same(context.work_item_id, workId);
  const reviewEvidence = context?.kind === 'laboratory_order' ? context.stage === 'result_received' && context.basis.composition_event_id !== null
    : !!context?.basis.operational_event && (context.kind === 'referral' ? context.stage === 'report_received' : context.stage === 'obtained');
  const mayPrepare = coherent && ownReady && peersReady && canRecordCareStep(workflow!, scope.actor_id)
    && (command === 'record_contact' || reviewEvidence);
  function prepare(form: HTMLFormElement) {
    if (!live.current || inFlight.current || !context || !mayPrepare) return;
    const values = new FormData(form), text = (key: string) => String(values.get(key) ?? '');
    const utc = (key: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(text(key)) ? text(key) + (text(key).length === 16 ? ':00Z' : 'Z') : '';
    const placeholder = '00000000-0000-4000-8000-000000000000';
    const addressed = values.get('review_addressed') === 'on', referenced = text('review_reference') === 'latest';
    const details = command === 'record_review' ? { decision: text('decision'), limitations: text('limitations') } : {
      channel: text('channel'), recipient_type: text('recipient_type'), recipient_reference: text('recipient_reference'), outcome: text('outcome'),
      review_event_id: referenced ? context.latest_review?.event_id ?? null : null, review_addressed: addressed,
      exception_id: text('outcome') === 'human_reached' ? null : placeholder, reason: text('outcome') === 'human_reached' ? null : text('reason'),
    };
    const input = validateNewHumanInput({ ...scope, work_item_id: workId, request_id: placeholder, command,
      expected_revision: context.workflow_revision, expected_ownership_revision: context.ownership_revision,
      basis: context.basis, basis_signature: context.basis_signature, payload: { details, evidence: text('evidence'),
        occurred_at: utc('occurred_at'), next_action: text('next_action'), next_review_at: utc('next_review_at') } });
    const occurred = input && labCollectionMicros(input.payload.occurred_at);
    const reviewed = context.latest_review && labCollectionMicros(context.latest_review.occurred_at);
    if (!input || addressed && (!referenced || !context.latest_review?.is_current || occurred === null || reviewed === null || occurred! < reviewed!)) {
      setError('Verify evidence, required details and explicit nonfuture occurrence/future review time. Addressing a review requires the current displayed review, a reached human and occurrence not before that review.'); return;
    }
    const parsed = humanCommandSchema.parse({ command: input.command, payload: input.payload });
    if (parsed.command === 'record_contact' && parsed.payload.details.exception_id !== null) parsed.payload.details.exception_id = crypto.randomUUID();
    void operate({ ...input, ...parsed, request_id: crypto.randomUUID() }, prepareHuman);
  }
  if (sessionChanged) return <p role="alert">Your session changed. Reload human follow-up before continuing.</p>;
  return <section aria-label="Human review and contact" aria-busy={busy} className="space-y-4 rounded-xl border border-blue-200 p-4 text-sm">
    <h2 className="text-lg font-bold">Human review and documented contact</h2>
    <p>Synthetic information only. These controls record professional statements, not a message, call, delivery confirmation or completed care.</p>
    {!selected && <>
      <button className={button} disabled={busy} onClick={() => void loadRecovery()}>Check human pending records</button>
      <p>Recover every pending request before preparing a new record. Evidence access alone does not grant permission to record a clinical review or establish institutional approval.</p>
      {requests.length > 0 && <ul aria-label="Pending human requests" className="space-y-2">{requests.map((item) => <li key={item.request_id} className="break-all rounded-lg border p-3">
        <p>{item.command === 'record_review' ? 'Human review' : 'Documented contact'} · {item.state === 'applied' ? 'Recorded; receipt unacknowledged' : 'Prepared; not recorded'}</p>
        {same(item.work_item_id, workId) ? <button className={button} disabled={busy} onClick={() => void operate(humanInputFromState(item), recoverHuman)}>Recover human request {item.request_id}</button>
          : <a className={button} href={`/patients/${item.patient_id}/care/${item.work_item_id}?organization=${item.organization_id}`}>Open other follow-up</a>}
      </li>)}</ul>}
      <label className="block">Human record type<select className={control} value={command} onChange={(event) => {
        if (inFlight.current === 'write') return;
        invalidateContext(); setCommand(event.target.value as typeof command); setError(null);
      }}><option value="record_review">Professional review</option><option value="record_contact">Documented contact</option></select></label>
      <button className={button} disabled={busy} onClick={() => void loadContext()}>Load evidence for this human record</button>
      {context && <div className="space-y-3 rounded-lg bg-slate-50 p-3" aria-label="Evidence before human preparation">
        <p>Last loaded evidence — every preparation and confirmation rechecks the exact basis.</p>
        <CareHumanBasis basis={context.basis} signature={context.basis_signature} />
        {context.latest_review && <div className="space-y-1">
          <p>Latest recorded decision: {context.latest_review.decision}</p><p>Review occurred: {context.latest_review.occurred_at}</p>
          <p>{context.latest_review.is_current ? 'Review matched this evidence when loaded.' : 'Review is stale for this evidence.'}</p>
          <p className="break-all">Review event: {context.latest_review.event_id}</p>
        </div>}
        {!mayPrepare && <p>New preparation requires matching current workflow, accepted ownership, complete recovery in every relevant panel and suitable evidence. Refresh the workflow if revisions changed.</p>}
      </div>}
      {mayPrepare && <HumanForm key={`${command}:${epoch}:${context!.workflow_revision}:${context!.ownership_revision}:${context!.basis_signature}:${context!.latest_review?.event_id}`}
        context={context!} onPrepare={prepare} />}
    </>}
    {selected && <div aria-label="Frozen human request" className="space-y-3 rounded-xl border border-blue-300 bg-blue-50 p-4">
      <h3 className="font-bold">{selected.command === 'record_review' ? 'Frozen professional review' : 'Frozen documented contact'}</h3>
      <p className="break-all">Request: {selected.request_id}</p><p>Workflow revision: {selected.expected_revision} · Ownership revision: {selected.expected_ownership_revision}</p>
      <CareHumanEvidence input={selected} />
      {!saved && <p>Outcome unknown. Check this same request; do not create a replacement. Permission or revision changes require recovery and explicit cancellation of a still-prepared request, not changed frozen evidence.</p>}
      {saved?.state === 'prepared' && <p role="status">Human record prepared and recoverable; not yet recorded.</p>}
      {saved?.state === 'applied' && <div role="status"><p>Human record saved at revision {saved.receipt!.workflow_revision}. Historical receipt; current workflow has not been refreshed.</p>
        <p>Queue deadline at recording: {saved.receipt!.due_at}. No confirmed transmission or completed care.</p></div>}
      {saved?.state === 'cancelled' && <p role="status">Human preparation cancelled; this request recorded no human event.</p>}
      <div className="flex flex-wrap gap-2">
        <button className={button} disabled={busy} onClick={() => void operate(selected, recoverHuman)}>Check saved human request</button>
        {!saved && <button className={button} disabled={busy} onClick={() => void operate(selected, prepareHuman)}>Retry human preparation with same ID</button>}
        {saved?.state === 'prepared' && <><button className={button} disabled={busy} onClick={() => void operate(selected, applyHuman)}>Confirm human record</button>
          <button className={button} disabled={busy} onClick={() => void operate(selected, cancelHuman)}>Cancel human preparation</button></>}
        {saved?.state === 'applied' && !saved.acknowledged_at && <button className={button} disabled={busy} onClick={() => void operate(selected, acknowledgeHuman)}>Acknowledge human receipt</button>}
        {(saved?.state === 'cancelled' || saved?.acknowledged_at) && <button className={button} disabled={busy} onClick={() => {
          setSelected(null); setSaved(null); setContext(null); setComplete(false); callbacks.current.onChanged();
        }}>Return to human recovery</button>}
      </div>
    </div>}
    {busy && <p role="status">Verifying authorized human record…</p>}
    {error && <p role="alert" className="text-red-800">{error}</p>}
  </section>;
}

function HumanForm({ context, onPrepare }: { context: HumanContext; onPrepare: (form: HTMLFormElement) => void }) {
  const [outcome, setOutcome] = useState(''), [reference, setReference] = useState(''), [addressed, setAddressed] = useState(false);
  const field = (name: string, title: string, max = 1000) => <label className="block">{title}<textarea className={control} name={name} required minLength={3} maxLength={max} /></label>;
  const select = (name: string, title: string, options: string[]) => <label className="block">{title}<select name={name} className={control} required defaultValue="">
    <option value="" disabled>Choose documented value</option>{options.map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></label>;
  return <form aria-label="New human record" className="space-y-3" onSubmit={(event) => { event.preventDefault(); onPrepare(event.currentTarget); }}>
    {context.command === 'record_review' ? <>{field('decision', 'Professional decision')}{field('limitations', 'Evidence limitations')}</> : <>
      {select('channel', 'Contact channel', ['phone', 'in_person', 'video', 'secure_message', 'mail', 'other'])}
      {select('recipient_type', 'Recipient type', ['patient', 'caregiver', 'receiving_professional', 'other'])}
      {field('recipient_reference', 'Recipient reference (synthetic only)', 500)}
      <label className="block">Contact outcome<select className={control} name="outcome" required value={outcome} onChange={(event) => { setOutcome(event.target.value); setAddressed(false); }}>
        <option value="" disabled>Choose documented outcome</option>{['human_reached', 'no_answer', 'refused', 'unable_to_contact'].map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></label>
      {outcome && outcome !== 'human_reached' && field('reason', 'Contact barrier reason')}
      <label className="block">Review reference<select className={control} name="review_reference" value={reference} onChange={(event) => { setReference(event.target.value); setAddressed(false); }}>
        <option value="">No review reference</option>{context.latest_review && <option value="latest">Latest displayed review — {context.latest_review.event_id}</option>}</select></label>
      <label className="flex items-start gap-2"><input type="checkbox" name="review_addressed" checked={addressed}
        disabled={outcome !== 'human_reached' || reference !== 'latest' || !context.latest_review?.is_current} onChange={(event) => setAddressed(event.target.checked)} />
        This documented contact addressed the current displayed review</label>
    </>}
    {field('evidence', 'Human record evidence')}
    <label className="block">Human occurrence at (UTC)<input className={control} type="datetime-local" step="1" name="occurred_at" required /></label>
    {field('next_action', 'Human follow-up next action', 500)}
    <label className="block">Human next review at (UTC)<input className={control} type="datetime-local" step="1" name="next_review_at" required /></label>
    <p>Enter UTC explicitly. No clinical decision, review interval or successful outcome is preselected. Reloading evidence clears this unsaved form.</p>
    <button className={button} type="submit">Prepare human record for review</button>
  </form>;
}
