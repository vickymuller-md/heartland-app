'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { acknowledgeObservation, applyObservation, cancelObservation, loadPendingObservations,
  loadSourceContext, prepareObservation, recoverObservation } from '@/lib/labs/observation-actions';
import { observationInputFromState, type ObservationInput, type ObservationState } from '@/lib/labs/observation-types';
import { canChangeLabSource, canRegisterLabSource, validateSourceDraft, type LabSourceContext } from '@/lib/labs/source-context';
import { LAB_OBSERVATION_FIELDS } from '@/lib/labs/quality';

type Props = { actorId: string; patientId: string; organizationId: string; scopeKey: string };
const button = 'inline-flex min-h-11 items-center justify-center rounded-lg border bg-white px-3 py-2 disabled:opacity-50';
const control = 'mt-1 block min-h-11 w-full rounded-md border bg-white px-3 py-2';
const labels = { register_source: 'Register source authority', correct_source: 'Record a corrected value', cancel_source: 'Cancel a source value' };
const unconfirmed = 'The operation could not be confirmed. Keep the same request ID and payload; check the saved state before proceeding.';

export function LabSourcePanel(props: Props) {
  return <SourceState key={`${props.actorId}:${props.patientId}:${props.organizationId}:${props.scopeKey}`} {...props} />;
}
function SourceState({ actorId, patientId, organizationId }: Props) {
  const scope = { actor_id: actorId, patient_id: patientId, organization_id: organizationId };
  const [context, setContext] = useState<LabSourceContext | null>(null);
  const [items, setItems] = useState<ObservationState[]>([]);
  const [complete, setComplete] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [command, setCommand] = useState<ObservationInput['command']>('register_source');
  const [input, setInput] = useState<ObservationInput | null>(null);
  const [saved, setSaved] = useState<ObservationState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionChanged, setSessionChanged] = useState(false);
  const generation = useRef(0); const invalid = useRef(false); const inFlight = useRef(false);
  useEffect(() => {
    const { data: { subscription } } = createClient().auth.onAuthStateChange((_event, session) => {
      if (session?.user.id === actorId) return;
      invalid.current = true; generation.current += 1; setSessionChanged(true);
      setContext(null); setItems([]); setInput(null); setSaved(null);
    });
    return () => { generation.current += 1; subscription.unsubscribe(); };
  }, [actorId]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!input || saved?.state === 'cancelled' || saved?.acknowledged_at) return;
      event.preventDefault(); event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [input, saved]);
  async function load() {
    if (inFlight.current || invalid.current) return;
    inFlight.current = true; const version = ++generation.current;
    setBusy(true); setContext(null); setItems([]); setComplete(false); setSelectedId(''); setError(null);
    try {
      // Source-context failure cannot disable independently authorized recovery.
      const sources = await loadSourceContext(scope).catch(() => ({ data: null, error: 'Source context unavailable' }));
      if (version !== generation.current) return;
      setContext(sources.data);
      const pending: ObservationState[] = []; let after: string | null = null;
      for (;;) {
        const response = await loadPendingObservations({ ...scope, after });
        if (version !== generation.current) return;
        if (!response.data) throw new Error('Your complete pending requests could not be verified. Reload before starting any new command.');
        const page = response.data;
        if (page.items.some((item) => pending.some((old) => old.request_id === item.request_id))) throw new Error('Pending pagination did not advance.');
        pending.push(...page.items);
        if (page.next_cursor === null) break;
        if (page.next_cursor === after) throw new Error('Pending pagination did not advance.');
        after = page.next_cursor;
      }
      setItems(pending); setComplete(true);
      if (!sources.data) setError('Source context is unavailable. Recovery-only mode: check your own requests below; no new source change is enabled.');
    } catch { if (version === generation.current) { setItems([]); setComplete(false); setError('Your complete pending requests could not be verified. Reload before starting any new command.'); } }
    finally { if (version === generation.current) { inFlight.current = false; setBusy(false); } }
  }
  async function operate(frozen: ObservationInput, action: typeof prepareObservation) {
    if (inFlight.current || invalid.current) return;
    inFlight.current = true; const version = ++generation.current;
    setInput(frozen); setSaved(null); setContext(null); setComplete(false); setBusy(true); setError(null);
    try {
      const result = await action(frozen);
      if (version !== generation.current) return;
      if (result.data) setSaved(result.data); else setError(unconfirmed);
    } catch { if (version === generation.current) setError(unconfirmed); }
    finally { if (version === generation.current) { inFlight.current = false; setBusy(false); } }
  }
  const source = context?.items.find((item) => item.observation.id === selectedId);
  const mayPrepare = context && source && complete && items.length === 0 && !input && canChangeLabSource(context, source);
  function prepare(form: HTMLFormElement) {
    if (!mayPrepare || busy || invalid.current) return;
    const values = new FormData(form); const text = (name: string) => String(values.get(name) ?? '');
    const o = source.observation;
    if (o.root_id === null && !canRegisterLabSource(source)) {
      setError('The original source value or collection time is invalid for registration. No request was sent. Verify the source and reload.'); return;
    }
    const allowed = o.root_id === null ? ['register_source'] : o.status === 'cancelled' ? ['correct_source'] : ['correct_source', 'cancel_source'];
    if (!allowed.includes(command)) return;
    const common = { evidence: text('evidence'), occurred_at: text('occurred_at') };
    const payload = command === 'register_source' ? common : command === 'correct_source'
      ? { ...common, reason: text('reason'), value: text('value'), collected_at: text('collected_at') }
      : { ...common, reason: text('reason') };
    const placeholder = '00000000-0000-4000-8000-000000000000';
    const draft = validateSourceDraft({ ...scope, request_id: placeholder, root_id: o.root_id ?? placeholder,
      original_lab_result_id: o.original_lab_result_id, analyte: o.analyte, command,
      expected_revision: command === 'register_source' ? '0' : o.revision, payload });
    if (!draft) { setError('Verify evidence, reason, exact storage precision and explicit timezone offsets. Occurrence and collection cannot be future. No request was sent.'); return; }
    draft.request_id = crypto.randomUUID(); if (draft.command === 'register_source') draft.root_id = crypto.randomUUID();
    void operate(draft, prepareObservation);
  }
  if (sessionChanged) return <p role="alert">Your session changed. Reload this source page before continuing.</p>;
  return <section className="space-y-5 text-sm" aria-label="Laboratory source commands" aria-busy={busy}>
    <header className="space-y-2"><h1 className="text-2xl font-bold">Laboratory source history</h1>
      <p>Synthetic information only. Registering source authority is not claiming who ordered a test. Corrections preserve the original record and previous alerts.</p>
      <p>These commands do not link a result to follow-up, document clinical review or contact, or complete care.</p>
      <p className="break-all">Organization: {organizationId}</p>
      <a className={button} href={`/patients/${patientId}/lab-sources`}>Choose another organization</a>
    </header>
    {!input && <>
      <button type="button" className={button} disabled={busy} onClick={() => void load()}>Load sources and recover pending requests</button>
      {!complete && <p>Load the complete pending-request list before preparing a new command.</p>}
      {complete && items.length > 0 && <section aria-label="Pending source requests" className="space-y-3">
        <h2 className="font-semibold">Saved requests awaiting action or acknowledgment</h2>
        {items.map((item) => <div key={item.request_id} className="rounded-lg border p-3">
          <p>{labels[item.command]} · {LAB_OBSERVATION_FIELDS[item.analyte].label} · {item.state}</p>
          <button type="button" className={button} disabled={busy} onClick={() => void operate(observationInputFromState(item), recoverObservation)}>Recover {item.request_id}</button>
        </div>)}
      </section>}
      {context && <section aria-label="Current source context" className="space-y-3">
        <p>{context.items.length} analyte observations. This is the last loaded snapshot; every write rechecks current authority and revision.</p>
        {!context.can_mutate && <p>Read/recovery only: current clinical disposition authority is not present for this organization.</p>}
        <label className="block font-medium">Source to inspect<select className={control} value={selectedId} disabled={busy}
          onChange={(event) => { const next = context.items.find((item) => item.observation.id === event.target.value);
            setSelectedId(event.target.value); setCommand(next?.observation.root_id ? 'correct_source' : 'register_source'); setError(null); }}>
          <option value="">Choose an observation</option>
          {context.items.map(({ observation: o }) => <option key={o.id} value={o.id}>{LAB_OBSERVATION_FIELDS[o.analyte].label} · {o.value ?? 'cancelled'} · {o.collected_at} · {o.id}</option>)}
        </select></label>
        {source && <div className="rounded-lg border p-3 space-y-1" aria-label="Selected source">
          <p>{LAB_OBSERVATION_FIELDS[source.observation.analyte].label}: {source.observation.value ?? 'No current value'} {LAB_OBSERVATION_FIELDS[source.observation.analyte].unit}</p>
          <p>Collection: {source.observation.collected_at}</p><p>State: {source.observation.status}; revision {source.observation.revision ?? 'unregistered'}</p>
          <p>Current alert processing: {source.observation.evaluation_status ?? 'No evaluation status recorded'}. Not clinical review.</p>
          <p className="break-all">Source authority: {source.source_authority_organization_id ?? 'Not yet registered'}</p>
          {!canChangeLabSource(context, source) && <p>This organization cannot change this source. Viewing it does not transfer source authority.</p>}
        </div>}
        {mayPrepare && <form key={`${selectedId}:${command}`} aria-label="New source command" className="space-y-3" onSubmit={(event) => { event.preventDefault(); prepare(event.currentTarget); }}>
          <label className="block font-medium">Command<select className={control} value={command} disabled={busy} onChange={(event) => setCommand(event.target.value as typeof command)}>
            {(source.observation.root_id === null ? ['register_source'] : source.observation.status === 'cancelled' ? ['correct_source'] : ['correct_source', 'cancel_source']).map((key) =>
              <option key={key} value={key}>{labels[key as keyof typeof labels]}</option>)}
          </select></label>
          {source.observation.status === 'cancelled' && <p>Restoration requires an explicit new corrected value and collection. No old value is restored automatically.</p>}
          {command === 'correct_source' && <>
            <label className="block font-medium">Corrected value (exact decimal)<input className={control} name="value" inputMode="decimal" maxLength={256} required disabled={busy} /></label>
            <label className="block font-medium">Collection time (explicit offset)<input className={control} name="collected_at" placeholder="2026-09-01T09:30:00.123456-04:00" required disabled={busy} /></label>
          </>}
          {command !== 'register_source' && <label className="block font-medium">Reason<textarea className={control} name="reason" minLength={3} maxLength={1000} required disabled={busy} /></label>}
          <label className="block font-medium">Evidence or source reference<textarea className={control} name="evidence" minLength={3} maxLength={1000} required disabled={busy} /></label>
          <label className="block font-medium">Source event time (explicit offset)<input className={control} name="occurred_at" placeholder="2026-09-01T10:00:00-04:00" required disabled={busy} /></label>
          <p>Use the documented times, not an assumed current time. Decimal precision is preserved; no rounding is performed.</p>
          <button type="submit" className={button} disabled={busy}>Prepare source command for review</button>
        </form>}
      </section>}
    </>}
    {input && <section aria-label="Frozen source request" className="space-y-3 rounded-xl border border-blue-300 bg-blue-50 p-4">
      <h2 className="font-semibold">{labels[input.command]}</h2>
      <p className="break-all">Request: {input.request_id}; source: {input.root_id}; original result: {input.original_lab_result_id}</p>
      <p>{LAB_OBSERVATION_FIELDS[input.analyte].label} · expected revision {input.expected_revision}</p>
      {saved && <div aria-label="Frozen source snapshot" className="space-y-1 rounded-lg border bg-white p-3">
        <h3 className="font-semibold">Source recorded at preparation</h3>
        <p>Value: {saved.source_snapshot.value ?? 'No current value'} {LAB_OBSERVATION_FIELDS[input.analyte].unit}</p>
        <p>Collection: {saved.source_snapshot.collected_at}</p>
        {'version_id' in saved.source_snapshot && <>
          <p>State: {saved.source_snapshot.status}; revision {saved.source_snapshot.revision}</p>
          <p className="break-all">Version: {saved.source_snapshot.version_id}; result: {saved.source_snapshot.effective_lab_result_id ?? 'No current result'}</p>
        </>}
        <p>This frozen source is the basis of the saved command, not a refreshed current reading. Check it against the proposed change below.</p>
      </div>}
      {Object.entries(input.payload).map(([key, value]) => <p key={key} className="break-words">{key.replaceAll('_', ' ')}: {value}</p>)}
      {!saved && <p role="status">State unconfirmed. Do not create a replacement request. Check the saved state, or retry preparation with exactly this identity and payload.</p>}
      {saved?.state === 'prepared' && <p role="status">Prepared and recoverable. No source change has been applied.</p>}
      {saved?.state === 'applied' && <div role="status"><p>Source command applied. Historical receipt; not clinical review or completed care.</p>
        <p>Version: {saved.receipt!.version_id}; revision: {saved.receipt!.revision}</p>
        {'evaluation_status' in saved.receipt! && <p>Evaluation status in the frozen creation receipt: {saved.receipt!.evaluation_status ?? 'No new evaluation'}. Reload sources for current processing status; this receipt is not updated later.</p>}
      </div>}
      {saved?.state === 'cancelled' && <p role="status">Preparation cancelled. This request did not change the source.</p>}
      {saved?.acknowledged_at && <p role="status">Receipt acknowledged. This does not confirm clinical review.</p>}
      <div className="flex flex-wrap gap-2">
        <button className={button} type="button" disabled={busy} onClick={() => void operate(input, recoverObservation)}>Check saved source request</button>
        {!saved && <button className={button} type="button" disabled={busy} onClick={() => void operate(input, prepareObservation)}>Retry preparation with same ID</button>}
        {saved?.state === 'prepared' && <>
          <button className={button} type="button" disabled={busy} onClick={() => void operate(input, applyObservation)}>Apply reviewed source command</button>
          <button className={button} type="button" disabled={busy} onClick={() => void operate(input, cancelObservation)}>Cancel preparation</button>
        </>}
        {saved?.state === 'applied' && !saved.acknowledged_at && <button className={button} type="button" disabled={busy}
          onClick={() => void operate(input, acknowledgeObservation)}>Acknowledge source receipt</button>}
        {(saved?.state === 'cancelled' || saved?.acknowledged_at) && <button className={button} type="button" disabled={busy}
          onClick={() => { setInput(null); setSaved(null); void load(); }}>Reload source context</button>}
      </div>
    </section>}
    {error && <p role="alert" className="text-amber-800">{error}</p>}
  </section>;
}
