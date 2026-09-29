'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { acknowledgeCareRequest, applyCareRequest, cancelCareRequest, loadPendingCareRequests,
  prepareCareRequest, recoverCareRequest } from '@/lib/care-workflow/actions';
import { CARE_KIND_LABELS, CARE_READ_UNAVAILABLE, CARE_UNCONFIRMED, careAnalyteSchema, validateNewCareRequest,
  type CareRequestInput, type CareRequestResult, type CareRequestState, type CareScope } from '@/lib/care-workflow/types';

type Props = { actorId: string; patientId: string; scopeKey: string; organizations: { id: string; name: string }[] };
const control = 'mt-1 min-h-11 w-full rounded-md border bg-white px-3';
const button = 'min-h-11 rounded-lg border bg-white px-3 py-2 font-medium disabled:opacity-50';

export function CareRequestPanel(props: Props) {
  return <OrganizationPanel key={`${props.scopeKey}:${props.actorId}:${props.patientId}`} {...props} />;
}
function OrganizationPanel(props: Props) {
  const [organizationId, setOrganizationId] = useState('');
  if (!props.organizations.length) return null;
  return <section className="space-y-3 rounded-2xl border bg-white p-5" aria-labelledby="care-requests-heading">
    <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Care follow-up</p>
    <h2 id="care-requests-heading" className="text-lg font-bold">Requests, evidence and follow-up</h2>
    <p className="text-sm text-slate-600">Record a laboratory request, referral or medication access follow-up. Recording does not send an order, confirm delivery or completion, or accept responsibility. Use synthetic information only.</p>
    <label className="block text-sm font-medium">Request organization
      <select className={control} value={organizationId} onChange={(event) => setOrganizationId(event.target.value)}>
        <option value="">Choose an organization</option>
        {props.organizations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
      </select>
    </label>
    {organizationId && <RequestState key={organizationId} scope={{ actor_id: props.actorId,
      organization_id: organizationId, patient_id: props.patientId }} />}
  </section>;
}

function RequestState({ scope }: { scope: CareScope }) {
  const [items, setItems] = useState<CareRequestState[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);
  const [selected, setSelected] = useState<CareRequestInput | null>(null);
  const [saved, setSaved] = useState<CareRequestState | null>(null);
  const [kind, setKind] = useState<keyof typeof CARE_KIND_LABELS>('laboratory_order');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sessionChanged, setSessionChanged] = useState(false);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const invalidSession = useRef(false);
  useEffect(() => {
    const client = createClient();
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      if (session?.user.id === scope.actor_id) return;
      invalidSession.current = true;
      generation.current += 1;
      setSessionChanged(true); setSelected(null); setSaved(null); setItems([]);
    });
    return () => { generation.current += 1; subscription.unsubscribe(); };
  }, [scope.actor_id]);

  async function load(after: string | null = null) {
    if (inFlight.current || invalidSession.current) return;
    inFlight.current = true; const version = ++generation.current;
    setBusy(true); setError(null); setComplete(false);
    if (!after) { setItems([]); setCursor(null); }
    try {
      const response = await loadPendingCareRequests({ ...scope, after });
      if (version !== generation.current) return;
      if (!response.data) { setError(response.error ?? CARE_READ_UNAVAILABLE); return; }
      setItems((previous) => after ? [...previous, ...response.data!.items] : response.data!.items);
      setCursor(response.data.next_cursor); setComplete(response.data.next_cursor === null);
    } catch { if (version === generation.current) setError(CARE_READ_UNAVAILABLE); }
    finally { if (version === generation.current) { inFlight.current = false; setBusy(false); } }
  }

  async function operate(input: CareRequestInput, action: (input: CareRequestInput) => Promise<CareRequestResult>) {
    if (inFlight.current || invalidSession.current) return;
    inFlight.current = true; const version = ++generation.current;
    setSelected(input); setSaved(null); setBusy(true); setError(null);
    try {
      const response = await action(input);
      if (version !== generation.current) return;
      if (!response.data) setError(response.error ?? CARE_UNCONFIRMED);
      else setSaved(response.data);
    } catch { if (version === generation.current) setError(CARE_UNCONFIRMED); }
    finally { if (version === generation.current) { inFlight.current = false; setBusy(false); } }
  }

  function prepare(form: HTMLFormElement) {
    if (inFlight.current || invalidSession.current || selected || !complete || items.length) return;
    const values = new FormData(form);
    // These fields are explicitly UTC, never local browser time or an appointment date.
    const utc = (name: string) => {
      const value = String(values.get(name) ?? '');
      return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)
        ? `${value}${value.length === 16 ? ':00' : ''}Z` : '';
    };
    const payload = validateNewCareRequest({ kind, source: values.get('source'),
      purpose: values.get('purpose'), evidence: values.get('evidence'),
      occurred_at: utc('occurred_at'), next_review_at: utc('next_review_at'), analytes: values.getAll('analyte') });
    if (!payload) { setError('Enter meaningful request and evidence text, select the analytes, and verify both UTC timestamps: occurrence cannot be future and next review must be future.'); return; }
    const input = { ...scope, request_id: crypto.randomUUID(), work_item_id: crypto.randomUUID(), payload };
    void operate(input, prepareCareRequest);
  }

  if (sessionChanged) return <p role="alert">Your session changed. Reload this patient page before continuing.</p>;
  return <div className="space-y-3 text-sm" aria-busy={busy}>
    {!selected && <>
      <button type="button" className={button} disabled={busy} onClick={() => void load()}>Check pending requests</button>
      {items.length > 0 && <ul className="space-y-2" aria-label="Pending request receipts">
        {items.map((item) => <li key={item.request_id} className="rounded-lg border p-3">
          <p className="break-words">{CARE_KIND_LABELS[item.payload.kind]}: {item.payload.purpose}</p>
          <p>{item.state === 'applied' ? 'Recorded; receipt not yet acknowledged.' : 'Prepared; not yet recorded in the work queue.'}</p>
          <button type="button" className={`${button} mt-2`} disabled={busy} onClick={() => {
            const { actor_id, organization_id, patient_id, request_id, work_item_id, payload } = item;
            void operate({ actor_id, organization_id, patient_id, request_id, work_item_id, payload }, recoverCareRequest);
          }}>Review request {item.request_id}</button>
        </li>)}
      </ul>}
      {cursor && <button type="button" className={button} disabled={busy} onClick={() => void load(cursor)}>Load more pending requests</button>}
      {complete && items.length === 0 && <form aria-label="New care request" className="space-y-3" onSubmit={(event) => { event.preventDefault(); prepare(event.currentTarget); }}>
        <p>No unacknowledged request was found in this organization for your current account.</p>
        <label className="block font-medium">Follow-up type<select className={control} value={kind} disabled={busy}
          onChange={(event) => setKind(event.target.value as typeof kind)}>
          {Object.entries(CARE_KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label className="block font-medium">Request source<select className={control} name="source" required disabled={busy} defaultValue="">
          <option value="" disabled>Choose the documented source</option>
          <option value="external_documented">Existing documented external request</option>
          <option value="professional_decision">New professional decision (requires current authorization)</option>
        </select></label>
        <label className="block font-medium">Purpose<textarea className={control} name="purpose" required minLength={3} maxLength={1000} disabled={busy} /></label>
        <label className="block font-medium">Source evidence or reference<textarea className={control} name="evidence" required minLength={3} maxLength={1000} disabled={busy} /></label>
        {kind === 'laboratory_order' && <fieldset className="rounded-lg border p-3"><legend>Requested analytes</legend>
          <div className="grid gap-2 sm:grid-cols-3">{careAnalyteSchema.options.map((analyte) =>
            <label key={analyte} className="flex min-h-11 items-center gap-2"><input type="checkbox" name="analyte" value={analyte} disabled={busy} />{analyte.replaceAll('_', ' ')}</label>)}</div>
        </fieldset>}
        <label className="block font-medium">Request occurred at (UTC)<input className={control} type="datetime-local" step="1" name="occurred_at" required disabled={busy} /></label>
        <label className="block font-medium">Next review at (UTC)<input className={control} type="datetime-local" step="1" name="next_review_at" required disabled={busy} /></label>
        <p>Enter UTC clock time explicitly. This is an operational review deadline, not an appointment date or a recommended clinical interval.</p>
        <button type="submit" className={button} disabled={busy}>Prepare request for review</button>
      </form>}
    </>}
    {selected && <div className="space-y-3 rounded-xl border bg-slate-50 p-4" aria-label="Frozen request">
      <p className="break-all text-xs">Request ID: {selected.request_id}</p>
      <h3 className="font-semibold">{CARE_KIND_LABELS[selected.payload.kind]}</h3>
      <p className="break-words">Purpose: {selected.payload.purpose}</p>
      <p className="break-words">Evidence: {selected.payload.evidence}</p>
      <p>Source: {selected.payload.source === 'professional_decision' ? 'Professional decision' : 'Existing documented external request'}</p>
      {selected.payload.analytes.length > 0 && <p>Requested analytes: {selected.payload.analytes.join(', ')}</p>}
      <p>Request occurred: {selected.payload.occurred_at}</p><p>Next review: {selected.payload.next_review_at}</p>
      {!saved && <>
        <p>Saved state has not been confirmed. Keep this request identity while checking.</p>
        <p>If access is unavailable or recovery keeps failing, stop retrying and ask an authorized team member to verify your current organization and monitoring permissions. A new professional decision also needs current clinical-disposition authorization. Do not change the documented source to bypass that requirement or create a replacement request.</p>
        <p>After access is restored, reload this patient page and check pending requests. A durable preparation remains recoverable; a missing or inaccessible response is not proof that nothing was recorded.</p>
      </>}
      {saved?.state === 'prepared' && <p role="status">Prepared and recoverable. Not yet recorded in the work queue.</p>}
      {saved?.state === 'applied' && <p role="status">Request recorded in Daily Loop. Responsibility still requires separate acceptance; this receipt does not confirm external transmission or care completion.</p>}
      {saved?.state === 'cancelled' && <p role="status">Preparation cancelled. No care completion has been recorded.</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} disabled={busy} onClick={() => void operate(selected, recoverCareRequest)}>Check saved request</button>
        {!saved && <button type="button" className={button} disabled={busy} onClick={() => void operate(selected, prepareCareRequest)}>Retry preparation with same ID</button>}
        {saved?.state === 'prepared' && <>
          <button type="button" className={button} disabled={busy} onClick={() => void operate(selected, applyCareRequest)}>Confirm request in Daily Loop</button>
          <button type="button" className={button} disabled={busy} onClick={() => void operate(selected, cancelCareRequest)}>Cancel prepared request</button>
        </>}
        {saved?.state === 'applied' && !saved.acknowledged_at && <button type="button" className={button} disabled={busy}
          onClick={() => void operate(selected, acknowledgeCareRequest)}>Acknowledge receipt (not care completion)</button>}
        {saved?.state === 'applied' && <a className={button} href="/dashboard">Open Daily Loop to review responsibility</a>}
        {(saved?.state === 'cancelled' || saved?.acknowledged_at) && <button type="button" className={button} disabled={busy}
          onClick={() => { setSelected(null); setSaved(null); void load(); }}>Return to pending requests</button>}
      </div>
    </div>}
    {busy && <p role="status">Checking the current authorized request state…</p>}
    {error && <p role="alert" className="text-red-800">{error}</p>}
  </div>;
}
