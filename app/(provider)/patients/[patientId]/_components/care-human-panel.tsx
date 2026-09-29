'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { labCollectionMicros } from '@/lib/labs/quality';
import type { CareScope } from '@/lib/care-workflow/types';
import { canRecordCareStep, type CareWorkflowDetail } from '@/lib/care-workflow/step-types';
import { acknowledgeHuman, applyHuman, cancelHuman, loadHumanContext, loadSourceResolutionContext, loadPendingHuman, prepareHuman, recoverHuman } from '@/lib/care-workflow/human-actions';
import { loadCompositionInvalidations } from '@/lib/care-workflow/composition-actions';
import { humanCommandSchema, humanInputFromState, sourceResolutionReady, validateNewHumanInput, type HumanContext, type HumanInput, type HumanState } from '@/lib/care-workflow/human-types';
import { CareExceptionSnapshot, CareSourceSnapshot, CareHumanBasis, CareHumanEvidence } from './care-human-evidence';

type Props = { scope: CareScope; workId: string; workflow: CareWorkflowDetail | null; peersReady: boolean; refreshToken: number;
  onReadiness: (ready: boolean) => void; onChanged: () => void };
const button = 'min-h-11 rounded-lg border bg-white px-3 py-2 font-medium disabled:opacity-50';
const control = 'mt-1 min-h-11 w-full rounded-md border bg-white px-3 py-2';
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const uncertain = 'Human record state is unconfirmed. Recover the exact request; do not replace its ID, evidence, payload or revisions.';
const label = (value: string) => value.replaceAll('_', ' ');
type SourceTarget = NonNullable<Awaited<ReturnType<typeof loadCompositionInvalidations>>['data']>['items'][number];

export function CareHumanPanel(props: Props) {
  return <HumanStatePanel key={`${props.scope.actor_id}:${props.scope.organization_id}:${props.scope.patient_id}:${props.workId}`} {...props} />;
}
function HumanStatePanel({ scope, workId, workflow, peersReady, refreshToken, onReadiness, onChanged }: Props) {
  const [context, setContext] = useState<HumanContext | null>(null);
  const [command, setCommand] = useState<HumanInput['command']>('record_review');
  const [sourceTargets, setSourceTargets] = useState<SourceTarget[]>([]), [sourceTarget, setSourceTarget] = useState('');
  const [targetsLoaded, setTargetsLoaded] = useState(false);
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
      setContext(null); setSourceTargets([]); setSourceTarget(''); setTargetsLoaded(false);
      setSelected(null); setSaved(null); setRequests([]); callbacks.current.onReadiness(false);
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
  async function loadSourceTargets() {
    if (!live.current || inFlight.current || selected) return;
    inFlight.current = 'context'; const version = ++generation.current;
    const valid = () => live.current && generation.current === version;
    setBusy(true); setError(null); setContext(null); setSourceTargets([]); setSourceTarget(''); setTargetsLoaded(false); callbacks.current.onReadiness(false);
    const all: SourceTarget[] = []; let after: string | null = null;
    try {
      for (;;) {
        const result = await loadCompositionInvalidations({ ...scope, work_item_id: workId, after });
        if (!valid()) return;
        if (!result.data) throw new Error('Incomplete source-change list');
        all.push(...result.data.items);
        const next: string | null = result.data.next_cursor;
        if (next === null) { setSourceTargets(all); setTargetsLoaded(true); break; }
        if (after !== null && next.toLowerCase() <= after.toLowerCase()) throw new Error('Nonforward source page');
        after = next;
      }
    } catch { if (valid()) setError('Source-change history could not be loaded completely. Private human recovery remains available.'); }
    finally { if (valid()) { inFlight.current = null; setBusy(false); setEpoch((value) => value + 1); } }
  }
  async function loadContext() {
    if (!live.current || inFlight.current || selected) return;
    if (command === 'resolve_source_invalidation' && (!targetsLoaded || !sourceTargets.some((row) => row.id === sourceTarget && row.resolution === null))) return;
    inFlight.current = 'context'; const version = ++generation.current;
    setBusy(true); setError(null); setContext(null); callbacks.current.onReadiness(false);
    try {
      const result = command === 'resolve_source_invalidation'
        ? await loadSourceResolutionContext({ ...scope, work_item_id: workId, invalidation_id: sourceTarget })
        : await loadHumanContext({ ...scope, work_item_id: workId, command });
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
    && same(context.work_item_id, workId) && (context.command !== 'resolve_source_invalidation' || same(context.invalidation.invalidation_id, sourceTarget));
  const reviewEvidence = context?.kind === 'laboratory_order' ? context.stage === 'result_received' && context.basis.composition_event_id !== null
    : !!context?.basis.operational_event && (context.kind === 'referral' ? context.stage === 'report_received' : context.stage === 'obtained');
  const mayPrepare = coherent && ownReady && peersReady && canRecordCareStep(workflow!, scope.actor_id)
    && (command === 'record_review' ? reviewEvidence : command === 'record_contact' || context?.command === 'resolve_exception' && context.exceptions.length > 0
      || context?.command === 'resolve_source_invalidation' && sourceResolutionReady(context));
  function prepare(form: HTMLFormElement) {
    if (!live.current || inFlight.current || !context || !mayPrepare) return;
    const values = new FormData(form), text = (key: string) => String(values.get(key) ?? '');
    const utc = (key: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(text(key)) ? text(key) + (text(key).length === 16 ? ':00Z' : 'Z') : '';
    const placeholder = '00000000-0000-4000-8000-000000000000';
    const addressed = values.get('review_addressed') === 'on', referenced = text('review_reference') === 'latest';
    const details = command === 'resolve_source_invalidation' && context.command === 'resolve_source_invalidation' ? {
      invalidation: context.invalidation, review_event_id: context.latest_review?.event_id, contact_event_id: context.contact?.event_id,
      disposition: text('disposition'), resolution_reason: text('resolution_reason'), source_reviewed: values.get('source_reviewed') === 'on',
      change_addressed_in_contact: values.get('change_addressed_in_contact') === 'on',
      source_review_evidence: text('source_review_evidence'), source_communication_evidence: text('source_communication_evidence'),
    } : command === 'resolve_exception' ? {
      exception: context.command === 'resolve_exception' ? context.exceptions.find((item) => item.exception_id === text('exception_id')) : undefined,
      disposition: text('disposition'), resolution_reason: text('resolution_reason'),
    } : command === 'record_review' ? { decision: text('decision'), limitations: text('limitations') } : {
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
    const contacted = context.command === 'resolve_source_invalidation' && context.contact ? labCollectionMicros(context.contact.occurred_at) : null;
    if (!input || addressed && (!referenced || !context.latest_review?.is_current || occurred === null || reviewed === null || occurred! < reviewed!)
      || command === 'resolve_source_invalidation' && (contacted === null || occurred === null || occurred! < contacted)) {
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
        <p>{item.command === 'record_review' ? 'Human review' : item.command === 'record_contact' ? 'Documented contact' : item.command === 'resolve_exception' ? 'Barrier resolution' : 'Source-change resolution'} · {item.state === 'applied' ? 'Recorded; receipt unacknowledged' : 'Prepared; not recorded'}</p>
        {same(item.work_item_id, workId) ? <button className={button} disabled={busy} onClick={() => void operate(humanInputFromState(item), recoverHuman)}>Recover human request {item.request_id}</button>
          : <a className={button} href={`/patients/${item.patient_id}/care/${item.work_item_id}?organization=${item.organization_id}`}>Open other follow-up</a>}
      </li>)}</ul>}
      <label className="block">Human record type<select className={control} value={command} onChange={(event) => {
        if (inFlight.current === 'write') return;
        invalidateContext(); setCommand(event.target.value as typeof command); setSourceTarget(''); setSourceTargets([]); setTargetsLoaded(false); setError(null);
      }}><option value="record_review">Professional review</option><option value="record_contact">Documented contact</option><option value="resolve_exception">Resolve a documented barrier</option>
        {workflow?.kind === 'laboratory_order' && <option value="resolve_source_invalidation">Reconcile a changed laboratory source</option>}</select></label>
      {command === 'resolve_source_invalidation' && <div className="space-y-3">
        <button className={button} disabled={busy} onClick={() => void loadSourceTargets()}>Load source-change history</button>
        <p>This live paginated list is not an atomic closure check. A dedicated read rechecks the selected obligation.</p>
        {targetsLoaded && <label className="block">Source change to reconcile<select className={control} value={sourceTarget} onChange={(event) => {
          invalidateContext(); setSourceTarget(event.target.value); setError(null);
        }}><option value="" disabled>Choose an exact unresolved change</option>{sourceTargets.filter((row) => row.resolution === null).map((row) =>
          <option key={row.id} value={row.id}>{label(row.analyte)} — {row.recorded_at} — {row.id}</option>)}</select></label>}
        {targetsLoaded && !sourceTargets.some((row) => row.resolution === null) && <p>No unresolved change appeared in this loaded list. This does not mean care is complete.</p>}
        {sourceTargets.some((row) => row.resolution !== null) && <details><summary>Recorded source resolutions — original changes retained</summary><ul>
          {sourceTargets.filter((row) => row.resolution !== null).map((row) => <li key={row.id} className="break-all">{row.id} · Resolution event: {row.resolution!.event_id} · {row.resolution!.recorded_at}</li>)}</ul></details>}
      </div>}
      <button className={button} disabled={busy || command === 'resolve_source_invalidation' && (!targetsLoaded || !sourceTarget)} onClick={() => void loadContext()}>Load evidence for this human record</button>
      {context && <div className="space-y-3 rounded-lg bg-slate-50 p-3" aria-label="Evidence before human preparation">
        <p>Last loaded evidence — every preparation and confirmation rechecks the exact basis.</p>
        <CareHumanBasis basis={context.basis} signature={context.basis_signature} />
        {context.latest_review && <div className="space-y-1">
          <p>Latest recorded decision: {context.latest_review.decision}</p><p>Review occurred: {context.latest_review.occurred_at}</p>
          <p>{context.latest_review.is_current ? 'Review matched this evidence when loaded.' : 'Review is stale for this evidence.'}</p>
          <p className="break-all">Review event: {context.latest_review.event_id}</p>
        </div>}
        {context.command === 'resolve_exception' && !context.exceptions.length && <p>No open barrier was returned for this workflow. This does not mean care is complete.</p>}
        {context.command === 'resolve_source_invalidation' && <div className="space-y-2">
          <CareSourceSnapshot target={context.invalidation} />
          <p>{context.basis.sources.some((row) => row.root_id && same(row.root_id, context.invalidation.root_id)) ? 'The source remains in the current composition.' : 'The source was removed from the current composition; its original obligation remains.'}</p>
          {context.contact ? <div><p>Qualified documented contact: {label(context.contact.channel)} · {label(context.contact.recipient_type)} · {context.contact.recipient_reference}</p>
            <p>Contact occurred: {context.contact.occurred_at}</p><p className="break-all">Contact event: {context.contact.event_id} · Review: {context.contact.review_event_id}</p></div>
            : <p>No qualified contact was returned for this review.</p>}
          {!sourceResolutionReady(context) && <p>A current professional review after the source change and a documented contact addressing that review are required. Record those first, then reload; neither alone attests to this specific source change.</p>}
        </div>}
        {!mayPrepare && <p>New preparation requires matching current workflow, accepted ownership, complete recovery in every relevant panel and suitable evidence. Refresh the workflow if revisions changed.</p>}
      </div>}
      {mayPrepare && <HumanForm key={`${command}:${epoch}:${context!.workflow_revision}:${context!.ownership_revision}:${context!.basis_signature}:${context!.latest_review?.event_id}`}
        context={context!} onPrepare={prepare} />}
    </>}
    {selected && <div aria-label="Frozen human request" className="space-y-3 rounded-xl border border-blue-300 bg-blue-50 p-4">
      <h3 className="font-bold">{selected.command === 'record_review' ? 'Frozen professional review' : selected.command === 'record_contact' ? 'Frozen documented contact' : selected.command === 'resolve_exception' ? 'Frozen barrier resolution' : 'Frozen source-change resolution'}</h3>
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
  const [target, setTarget] = useState(''), [disposition, setDisposition] = useState('');
  const exception = context.command === 'resolve_exception' ? context.exceptions.find((item) => item.exception_id === target) : null;
  const field = (name: string, title: string, max = 1000) => <label className="block">{title}<textarea className={control} name={name} required minLength={3} maxLength={max} /></label>;
  const select = (name: string, title: string, options: string[]) => <label className="block">{title}<select name={name} className={control} required defaultValue="">
    <option value="" disabled>Choose documented value</option>{options.map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></label>;
  return <form aria-label="New human record" className="space-y-3" onSubmit={(event) => { event.preventDefault(); onPrepare(event.currentTarget); }}>
    {context.command === 'resolve_exception' && <>
      <label className="block">Barrier to resolve<select name="exception_id" className={control} required value={target}
        onChange={(event) => { setTarget(event.target.value); setDisposition(''); }}>
        <option value="" disabled>Choose the exact open barrier</option>{context.exceptions.map((item) => <option key={item.exception_id} value={item.exception_id}>
          {label(item.code)} — {item.reason} — {item.exception_id}</option>)}</select></label>
      {exception && <><CareExceptionSnapshot exception={exception} />
        <label className="block">Resolution disposition<select name="disposition" className={control} required value={disposition} onChange={(event) => setDisposition(event.target.value)}>
          <option value="" disabled>Choose documented disposition</option><option value="barrier_addressed">Barrier addressed (operational attestation)</option>
          <option value="clinical_non_delivery">Clinical non-delivery (requires clinical permission)</option></select></label>
        <p>Clinical permission is rechecked by the server. Neither disposition confirms delivery or completed care.</p></>}
    </>}
    {context.command === 'resolve_source_invalidation' && <label className="block">Source resolution disposition<select className={control} name="disposition" required value={disposition} onChange={(event) => setDisposition(event.target.value)}>
      <option value="" disabled>Choose documented disposition</option><option value="retained_in_current_composition">Retained in the current composition</option>
      <option value="no_longer_used">No longer used in the current composition</option></select></label>}
    {(context.command === 'resolve_exception' ? exception && disposition : context.command !== 'resolve_source_invalidation' || disposition) && <fieldset key={`${target}:${disposition}`} className="space-y-3">
    {context.command === 'resolve_source_invalidation' ? <>
      {field('resolution_reason', 'Source resolution reason')}
      <label className="flex items-start gap-2"><input type="checkbox" name="source_reviewed" required />I explicitly attest that this exact source change was reviewed</label>
      {field('source_review_evidence', 'Evidence of this source-specific review')}
      <label className="flex items-start gap-2"><input type="checkbox" name="change_addressed_in_contact" required />I explicitly attest that this exact source change was addressed in the referenced contact</label>
      {field('source_communication_evidence', 'Evidence of this source-specific contact')}
      <p>These are new declarations about this exact change. Earlier review and contact records are not rewritten. The server rechecks clinical permission; no delivery or comprehension is certified.</p>
    </> : context.command === 'resolve_exception' ? field('resolution_reason', 'Resolution reason')
      : context.command === 'record_review' ? <>{field('decision', 'Professional decision')}{field('limitations', 'Evidence limitations')}</> : <>
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
    </fieldset>}
  </form>;
}
