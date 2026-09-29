'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { LAB_OBSERVATION_FIELDS } from '@/lib/labs/quality';
import { loadSourceContext } from '@/lib/labs/observation-actions';
import type { LabSourceContext, LabSourceItem } from '@/lib/labs/source-context';
import type { CareScope } from '@/lib/care-workflow/types';
import { canRecordCareStep, type CareWorkflowDetail } from '@/lib/care-workflow/step-types';
import { acknowledgeComposition, applyComposition, cancelComposition, loadCompositionDetail, loadCompositionIntentions,
  loadCompositionInvalidations, loadPendingCompositions, prepareComposition, recoverComposition } from '@/lib/care-workflow/composition-actions';
import { compositionInputFromState, validateNewComposition, type CompositionDetail, type CompositionInput, type CompositionState } from '@/lib/care-workflow/composition-types';
import { loadPendingSubmissionIntents } from '@/lib/care-workflow/submission-intent-actions';
import { submissionIntentInputFromState, type SubmissionIntentInput, type SubmissionIntentState } from '@/lib/care-workflow/submission-intent-types';
import { CareLabSave } from './care-lab-save';

type Props = { scope: CareScope; workId: string; workflow: CareWorkflowDetail | null; stepsReady: boolean; refreshToken: number;
  onReadiness: (ready: boolean) => void; onChanged: () => void };
type Route = NonNullable<Awaited<ReturnType<typeof loadCompositionIntentions>>['data']>['items'][number];
type Invalidation = NonNullable<Awaited<ReturnType<typeof loadCompositionInvalidations>>['data']>['items'][number];
const button = 'min-h-11 rounded-lg border bg-white px-3 py-2 font-medium disabled:opacity-50';
const control = 'min-h-11 w-full rounded-md border bg-white px-3 py-2';
const uncertain = 'Association state is unconfirmed. Recover the same request; do not replace its UUID, payload or revisions.';
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

async function pages<T>(load: (after: string | null) => Promise<{ data: { items: T[]; next_cursor: string | null } | null }>, valid: () => boolean) {
  const all: T[] = []; const seen = new Set<string>(); let cursor: string | null = null;
  for (;;) {
    if (!valid()) throw new Error('Stale read');
    const result = await load(cursor);
    if (!valid() || !result.data) throw new Error('Incomplete recovery');
    all.push(...result.data.items);
    if (result.data.next_cursor === null) return all;
    if (seen.has(result.data.next_cursor)) throw new Error('Repeated cursor');
    seen.add(result.data.next_cursor); cursor = result.data.next_cursor;
  }
}
export function CareLabPanel(props: Props) {
  return <LabState key={`${props.scope.actor_id}:${props.scope.organization_id}:${props.scope.patient_id}:${props.workId}`} {...props} />;
}
function LabState({ scope, workId, workflow, stepsReady, refreshToken, onReadiness, onChanged }: Props) {
  const [detail, setDetail] = useState<CompositionDetail | null>(null);
  const [sources, setSources] = useState<LabSourceContext | null>(null);
  const [requests, setRequests] = useState<CompositionState[]>([]);
  const [intents, setIntents] = useState<SubmissionIntentState[]>([]);
  const [routing, setRouting] = useState<Route[]>([]);
  const [invalidations, setInvalidations] = useState<Invalidation[]>([]);
  const [recoveryComplete, setRecoveryComplete] = useState(false);
  const [completionEpoch, setCompletionEpoch] = useState(0);
  const [routingComplete, setRoutingComplete] = useState(false);
  const [selected, setSelected] = useState<CompositionInput | null>(null);
  const [saved, setSaved] = useState<CompositionState | null>(null);
  const [presentation, setPresentation] = useState<LabSourceItem['observation'][]>([]);
  const [saveOpen, setSaveOpen] = useState<{ input: SubmissionIntentInput | null; mayStart: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionChanged, setSessionChanged] = useState(false);
  const generation = useRef(0), inFlight = useRef(false), live = useRef(true);
  const callbacks = useRef({ onReadiness, onChanged }); callbacks.current = { onReadiness, onChanged };
  const latest = useRef({ scope, workId, saveOpen }); latest.current = { scope, workId, saveOpen };
  useEffect(() => {
    live.current = true;
    const { data: { subscription } } = createClient().auth.onAuthStateChange((_event, session) => {
      if (session?.user.id === scope.actor_id) return;
      live.current = false; generation.current += 1; setSessionChanged(true); setSelected(null); setSaved(null); setSaveOpen(null);
      setDetail(null); setSources(null); setPresentation([]); setRequests([]); setIntents([]); setRouting([]); setInvalidations([]);
      callbacks.current.onReadiness(false);
    });
    return () => { live.current = false; generation.current += 1; subscription.unsubscribe(); callbacks.current.onReadiness(false); };
  }, [scope.actor_id]);
  const ownRequests = requests.filter((item) => same(item.work_item_id, workId));
  const ownIntents = intents.filter((item) => same(item.work_item_id, workId));
  const noOwnPending = recoveryComplete && ownRequests.length === 0 && ownIntents.length === 0 && !selected && !saveOpen && !busy;
  // Even a fully batched refresh must pair its imperative false with a completed result.
  useEffect(() => { callbacks.current.onReadiness(live.current && noOwnPending); }, [noOwnPending, completionEpoch]);
  const loadRef = useRef<() => void>(() => {});
  loadRef.current = () => { void load(); };
  useEffect(() => { if (refreshToken > 0) loadRef.current(); }, [refreshToken]);
  async function load() {
    if (inFlight.current || !live.current || latest.current.saveOpen) return;
    inFlight.current = true; const version = ++generation.current;
    const valid = () => live.current && generation.current === version;
    const read = { ...scope, work_item_id: workId };
    setBusy(true); setError(null); setRecoveryComplete(false); setRoutingComplete(false);
    setDetail(null); setSources(null); setRequests([]); setIntents([]); setRouting([]); setInvalidations([]);
    callbacks.current.onReadiness(false);
    const results = await Promise.allSettled([
      pages((after) => loadPendingCompositions({ ...scope, after }), valid),
      pages((after) => loadPendingSubmissionIntents({ ...scope, after }), valid),
      loadCompositionDetail(read), loadSourceContext(scope),
      pages((after) => loadCompositionIntentions({ ...read, after }), valid),
      pages((after) => loadCompositionInvalidations({ ...read, after }), valid),
    ] as const);
    if (!valid()) return;
    const [comp, intent, current, context, route, changes] = results;
    if (comp.status === 'fulfilled') setRequests(comp.value);
    if (intent.status === 'fulfilled') setIntents(intent.value);
    setRecoveryComplete(comp.status === 'fulfilled' && intent.status === 'fulfilled');
    if (current.status === 'fulfilled') setDetail(current.value.data);
    if (context.status === 'fulfilled') setSources(context.value.data);
    if (route.status === 'fulfilled') setRouting(route.value);
    if (changes.status === 'fulfilled') setInvalidations(changes.value);
    setRoutingComplete(route.status === 'fulfilled' && changes.status === 'fulfilled');
    if (results.some((result) => result.status === 'rejected') || current.status !== 'fulfilled' || !current.value.data
      || context.status !== 'fulfilled' || !context.value.data) setError('Some current context or recovery lists could not be verified. No new association can be prepared. Successfully recovered private requests remain available below.');
    inFlight.current = false; setBusy(false); setCompletionEpoch((value) => value + 1);
  }
  async function operate(input: CompositionInput, action: typeof prepareComposition) {
    if (inFlight.current || !live.current || saveOpen) return;
    inFlight.current = true; const version = ++generation.current;
    setPresentation((old) => input.payload.sources.flatMap((mapping) => {
      if (!mapping.root_id) return [];
      const exact = (row: LabSourceItem['observation']) => row.analyte === mapping.analyte
        && row.root_id === mapping.root_id && row.revision === mapping.expected_root_revision;
      const local = selected?.request_id === input.request_id ? old.find(exact) : undefined;
      const observed = local ?? sources?.items.find((item) => exact(item.observation))?.observation;
      return observed ? [observed] : [];
    }));
    setBusy(true); setError(null); setSelected(input); setSaved(null); setRecoveryComplete(false); callbacks.current.onReadiness(false);
    try {
      const response = await action(input);
      if (!live.current || generation.current !== version) return;
      if (!response.data) setError(uncertain);
      else { setSaved(response.data); if (response.data.state === 'applied') { setDetail(null); setSources(null); callbacks.current.onChanged(); } }
    } catch { if (live.current && generation.current === version) setError(uncertain); }
    finally { if (live.current && generation.current === version) { inFlight.current = false; setBusy(false); } }
  }
  const coherent = !!workflow && !!detail && detail.workflow_revision === workflow.revision
    && detail.ownership_revision === workflow.ownership_revision && detail.stage === workflow.stage;
  const mayCompose = coherent && !!sources && recoveryComplete && routingComplete && stepsReady && !busy && !selected && !saveOpen
    && ownRequests.length === 0 && ownIntents.every((item) => item.submission.status === 'saved_not_linked')
    && canRecordCareStep(workflow!, scope.actor_id);
  const maySave = mayCompose && ownIntents.length === 0;
  const presentationComplete = !!selected && selected.payload.sources.every((row) => row.root_id === null
    || presentation.some((item) => item.root_id === row.root_id && item.revision === row.expected_root_revision && item.analyte === row.analyte));
  function prepare(form: HTMLFormElement) {
    if (!mayCompose || !workflow || !sources) return;
    const values = new FormData(form);
    const text = (key: string) => String(values.get(key) ?? '');
    const utc = (key: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(text(key)) ? text(key) + (text(key).length === 16 ? ':00Z' : 'Z') : '';
    const mappings = [...workflow.requested_analytes].sort().map((analyte) => {
      const root = text('source_' + analyte);
      const source = sources.items.find((item) => item.observation.root_id === root && item.observation.analyte === analyte);
      return { analyte, root_id: root || null, expected_root_revision: root ? source?.observation.revision ?? null : null };
    });
    const resolutions = routing.filter((item) => text('resolution_' + item.intent_id) !== '').map((item) => ({ intent_id: item.intent_id,
      disposition: text('resolution_' + item.intent_id), reason: text('reason_' + item.intent_id) })).sort((a, b) => a.intent_id.localeCompare(b.intent_id));
    if (ownIntents.some((item) => !resolutions.some((resolution) => same(item.intent_id, resolution.intent_id)))) {
      setError('Explicitly reconcile every one of your saved intentions for this work before preparing. Missing intended values remain missing.'); return;
    }
    const input = validateNewComposition({ ...scope, work_item_id: workId, request_id: '00000000-0000-4000-8000-000000000000',
      expected_revision: workflow.revision, expected_ownership_revision: workflow.ownership_revision,
      payload: { sources: mappings, intent_resolutions: resolutions, occurred_at: utc('composition_occurred_at'), next_review_at: utc('composition_next_review_at'),
        next_action: text('composition_next_action'), evidence: text('composition_evidence'), reason: text('composition_reason') } });
    if (!input) { setError('Verify exact source selections, reconciliation reasons, evidence and explicit nonfuture occurrence/future next-review time. No clinical interval is suggested.'); return; }
    if (detail?.composition_event_id === null && mappings.every((source) => source.root_id === null) && !resolutions.some((row) => row.disposition === 'not_used')) {
      setError('An initial all-missing composition needs an explicit not-used reconciliation of a saved intention. Otherwise select at least one source.'); return;
    }
    void operate({ ...input, request_id: crypto.randomUUID() }, prepareComposition);
  }
  function closeSave() {
    setSaveOpen(null); latest.current.saveOpen = null; setRecoveryComplete(false);
    setDetail(null); setSources(null); callbacks.current.onChanged(); void load();
  }
  if (sessionChanged) return <p role="alert">Your session changed. Reload laboratory follow-up before continuing.</p>;
  return <section className="space-y-4 rounded-xl border border-blue-200 p-4 text-sm" aria-label="Laboratory source association" aria-busy={busy}>
    <h2 className="text-lg font-semibold">Exams, intended follow-up and source association</h2>
    <p>Save an exam, associate its exact source and document human review separately. None of these controls confirms communication or completes care.</p>
    <button className={button} disabled={busy || !!saveOpen} onClick={() => void load()}>Refresh laboratory context and recovery</button>
    <p>Refresh workflow and pending steps above as well before a new preparation. Private receipt recovery remains separate from current work visibility.</p>
    {detail && <div className="space-y-2 rounded-lg bg-slate-50 p-3">
      <h3 className="font-semibold">Last loaded source composition</h3>
      <p>Workflow revision {detail.workflow_revision}; {detail.pending_intent_count} pending intentions; {detail.invalidation_count} unresolved source-change records. These counts are not successful care.</p>
      <ul>{detail.sources.map((row) => <li key={row.analyte} className="break-words py-2">
        <p>{LAB_OBSERVATION_FIELDS[row.analyte].label}: {row.quality === 'missing' ? 'Missing' : row.quality === 'cancelled' ? 'Cancelled; no current value'
          : `${row.head?.value} ${LAB_OBSERVATION_FIELDS[row.analyte].unit} — ${row.quality}`}</p>
        {row.head && <p>Collected: {row.head.collected_at}; source revision {row.head.revision}; evaluation {row.evaluation_status ?? 'not applicable'}.</p>}
      </li>)}</ul>
    </div>}
    {invalidations.length > 0 && <details className="rounded-lg border border-amber-300 p-3"><summary>Source-change history ({invalidations.length} loaded)</summary>
      <p>Live paginated history, not an atomic current-state or closure check. Use the human record controls to reconcile an exact open change; original changes remain in history.</p>
      <ul>{invalidations.map((row) => <li key={row.id} className="break-all py-2">
        <p>{LAB_OBSERVATION_FIELDS[row.analyte].label} · {row.recorded_at} · Obligation: {row.id} · Change: {row.change_version_id} · Composition: {row.event_id}</p>
        {row.resolution ? <p>Resolution recorded: {row.resolution.recorded_at} · Revision: {row.resolution.revision} · {row.resolution.disposition.replaceAll('_', ' ')} · Event: {row.resolution.event_id}. Not completed care.</p>
          : <p>Unresolved when loaded — requires explicit review and contact evidence.</p>}
      </li>)}</ul>
    </details>}
    {!saveOpen && !selected && <div className="space-y-3">
      <button className={button} disabled={!maySave} onClick={() => { setSaveOpen({ input: null, mayStart: maySave }); callbacks.current.onReadiness(false); }}>Save a new exam for this follow-up</button>
      <a className={`${button} inline-flex items-center`} href={`/patients/${scope.patient_id}/lab-sources?organization=${scope.organization_id}`}>Register or inspect laboratory sources</a>
    </div>}
    {!saveOpen && !selected && requests.length > 0 && <ul aria-label="Pending composition requests" className="space-y-2">{requests.map((item) => <li key={item.request_id} className="break-all rounded-lg border p-3">
      <p>{item.state === 'applied' ? 'Association recorded; receipt not acknowledged' : 'Prepared association; not applied'}</p>
      {same(item.work_item_id, workId) ? <button className={button} disabled={busy} onClick={() => void operate(compositionInputFromState(item), recoverComposition)}>Recover composition {item.request_id}</button>
        : <a className={button} href={`/patients/${item.patient_id}/care/${item.work_item_id}?organization=${item.organization_id}`}>Open other follow-up</a>}
    </li>)}</ul>}
    {!saveOpen && !selected && intents.length > 0 && <ul aria-label="Your pending laboratory intentions" className="space-y-2">{intents.map((item) => <li key={item.intent_id} className="break-all rounded-lg border p-3">
      <p>{item.submission.status.replaceAll('_', ' ')} · {item.intent_id}</p>
      {same(item.work_item_id, workId) ? <button className={button} disabled={busy} onClick={() => { setSaveOpen({ input: submissionIntentInputFromState(item), mayStart: false }); callbacks.current.onReadiness(false); }}>Recover intention {item.intent_id}</button>
        : <a className={button} href={`/patients/${item.patient_id}/care/${item.work_item_id}?organization=${item.organization_id}`}>Open other follow-up</a>}
    </li>)}</ul>}
    {saveOpen && <CareLabSave scope={scope} workId={workId} detail={workflow} initial={saveOpen.input} mayStart={saveOpen.mayStart}
      onBlock={() => callbacks.current.onReadiness(false)} onClose={closeSave} />}
    {mayCompose && <form aria-label="New laboratory source composition" className="space-y-3" onSubmit={(event) => { event.preventDefault(); prepare(event.currentTarget); }}>
      <h3 className="font-semibold">Choose exact sources for every requested analyte</h3>
      <p>Missing is an explicit choice. Only registered roots are selectable; values shown below are from the last loaded source context, not clinical classification.</p>
      {[...workflow!.requested_analytes].sort().map((analyte) => <label key={analyte} className="block">Source for {LAB_OBSERVATION_FIELDS[analyte].label}
        <select name={'source_' + analyte} className={control} defaultValue=""><option value="">Missing — no source associated</option>
          {sources!.items.filter(({ observation: row }) => row.analyte === analyte && row.root_id !== null).map(({ observation: row }) =>
            <option key={row.id} value={row.root_id!}>{row.status === 'cancelled' ? 'Cancelled; no value' : `${row.value} ${LAB_OBSERVATION_FIELDS[analyte].unit}`} · {row.collected_at} · {row.root_id} · revision {row.revision}</option>)}
        </select></label>)}
      {routing.length > 0 && <fieldset className="space-y-3"><legend>Saved intention reconciliation (live list, including prior owners)</legend>
        {routing.map((item) => <div key={item.intent_id} className="space-y-2 rounded-lg border p-3 break-words">
          <p className="break-all">Intention: {item.intent_id} · Exact saved lab: {item.submission.lab_result_id ?? 'Not saved'}</p>
          <p>Intended: {item.intended_analytes.join(', ')}. Missing: {item.submission.missing_analytes.join(', ') || 'None in this save'}.</p>
          <label className="block">Disposition for {item.intent_id}<select name={'resolution_' + item.intent_id} className={control} defaultValue="" disabled={item.submission.status !== 'saved_not_linked'}>
            <option value="">Not included in this command</option><option value="linked">Link exact saved sources</option><option value="not_used">Saved sources not used — reason required</option>
          </select></label>
          <label className="block">Reconciliation reason for {item.intent_id}<textarea name={'reason_' + item.intent_id} maxLength={1000} className={control} disabled={item.submission.status !== 'saved_not_linked'} /></label>
        </div>)}
      </fieldset>}
      {[['composition_evidence', 'Association evidence'], ['composition_reason', 'Source selection or replacement reason'], ['composition_next_action', 'Association next action']].map(([name, label]) =>
        <label key={name} className="block">{label}<textarea name={name} required minLength={3} maxLength={name === 'composition_next_action' ? 500 : 1000} className={control} /></label>)}
      <label className="block">Association occurred at (UTC)<input type="datetime-local" step="1" name="composition_occurred_at" required className={control} /></label>
      <label className="block">Association next review at (UTC)<input type="datetime-local" step="1" name="composition_next_review_at" required className={control} /></label>
      <button className={button}>Prepare exact source association</button>
    </form>}
    {selected && <div className="space-y-3 rounded-lg border border-blue-300 bg-blue-50 p-4" aria-label="Frozen source association">
      <h3 className="font-semibold">Frozen association request</h3><p className="break-all">{selected.request_id}</p>
      <p>Workflow revision {selected.expected_revision}; ownership revision {selected.expected_ownership_revision}.</p>
      <p>Evidence: {selected.payload.evidence}</p><p>Reason: {selected.payload.reason}</p><p>Occurred: {selected.payload.occurred_at}</p>
      <p>Next action: {selected.payload.next_action}</p><p>Next review: {selected.payload.next_review_at}</p>
      <ul>{selected.payload.sources.map((row) => <li key={row.analyte} className="break-all">{LAB_OBSERVATION_FIELDS[row.analyte].label}: {row.root_id ? `${row.root_id} · revision ${row.expected_root_revision}` : 'Missing'}</li>)}</ul>
      <div aria-label="Frozen source presentation" className="space-y-2 rounded-lg border bg-white p-3">
        <p>Selection snapshot for confirmation, not current source verification or clinical classification. Application rechecks the exact frozen revisions.</p>
        {presentation.map((row) => <p key={row.id}>{LAB_OBSERVATION_FIELDS[row.analyte].label}: {row.status === 'cancelled'
          ? 'Cancelled; no value' : `${row.value} ${LAB_OBSERVATION_FIELDS[row.analyte].unit}`} · Collected: {row.collected_at} · Status: {row.status} · Revision: {row.revision}</p>)}
        {!presentationComplete && <p>The exact frozen source presentation is unavailable. Refresh laboratory context to recover it only if the same revisions remain available; otherwise cancel this preparation. New heads are never substituted.</p>}
      </div>
      {selected.payload.intent_resolutions.map((row) => <p key={row.intent_id} className="break-all">{row.intent_id}: {row.disposition.replaceAll('_', ' ')} · {row.reason}</p>)}
      {saved ? <p role="status">{saved.state === 'prepared' ? 'Prepared and recoverable; no association applied.' : saved.state === 'cancelled' ? 'Preparation cancelled; no source association applied.'
        : `Association recorded at revision ${saved.receipt!.workflow_revision}. Historical receipt only; no clinical review, confirmed communication or care completion.`}</p> : <p>{uncertain}</p>}
      {saved?.receipt && <ul aria-label="Historical associated source values">{saved.receipt.sources.map((row) => <li key={row.analyte} className="break-words">
        {LAB_OBSERVATION_FIELDS[row.analyte].label}: {row.observed_head === null ? 'Missing' : row.observed_head.status === 'cancelled' ? 'Cancelled; no value' : `${row.observed_head.value} ${LAB_OBSERVATION_FIELDS[row.analyte].unit}`}
      </li>)}</ul>}
      <div className="flex flex-wrap gap-2">
        <button className={button} disabled={busy} onClick={() => void operate(selected, recoverComposition)}>Check saved association</button>
        {!saved && <button className={button} disabled={busy} onClick={() => void operate(selected, prepareComposition)}>Retry association preparation with same ID</button>}
        {saved?.state === 'prepared' && <><button className={button} disabled={busy || !presentationComplete} onClick={() => void operate(selected, applyComposition)}>Confirm exact source association</button>
          <button className={button} disabled={busy} onClick={() => void operate(selected, cancelComposition)}>Cancel prepared association</button></>}
        {saved?.state === 'applied' && saved.acknowledged_at === null && <button className={button} disabled={busy} onClick={() => void operate(selected, acknowledgeComposition)}>Acknowledge association receipt</button>}
        {(saved?.state === 'cancelled' || saved?.acknowledged_at) && <button className={button} disabled={busy} onClick={() => { setSelected(null); setSaved(null); callbacks.current.onChanged(); void load(); }}>Reload after association receipt</button>}
      </div>
    </div>}
    {busy && <p role="status">Checking laboratory sources and recovery lists…</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
