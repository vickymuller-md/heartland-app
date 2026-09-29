'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { CARE_KIND_LABELS } from '@/lib/care-workflow/types';
import { HUMAN_COMMAND_LABELS } from '@/lib/care-workflow/human-types';
import { LAB_OBSERVATION_FIELDS } from '@/lib/labs/quality';
import { CareLabPanel } from './care-lab-panel';
import { CareHumanEvidence } from './care-human-evidence';
import { CareHumanPanel } from './care-human-panel';
import { CareUnsavedIntentPanel } from './care-unsaved-intent-panel';
import { CarePostclosurePanel } from './care-postclosure-panel';
import { acknowledgeCareStep, applyCareStep, cancelCareStep, loadCareWorkflow, loadPendingCareSteps,
  prepareCareStep, recoverCareStep } from '@/lib/care-workflow/step-actions';
import { CARE_STAGE_LABELS, CARE_STEP_LABELS, CARE_STEP_READ_UNAVAILABLE, CARE_STEP_UNCONFIRMED,
  availableCareCommands, canRecordCareStep, careExceptionCodeSchema, careStepCommandSchema, careStepInputFromState, careWorkflowTimeline, careExceptionHistory,
  validateNewCareStep, type CareStepCommand, type CareStepInput, type CareStepResult, type CareStepState,
  type CareWorkflowDetail } from '@/lib/care-workflow/step-types';

type Props = { actorId: string; patientId: string; organizationId: string; workId: string;
  initial: CareWorkflowDetail | null; scopeKey: string };
const control = 'mt-1 min-h-11 w-full rounded-md border bg-white px-3 py-2';
const button = 'inline-flex min-h-11 items-center justify-center rounded-lg border bg-white px-3 py-2 font-medium disabled:opacity-50';
const human = (value: string) => value.replaceAll('_', ' ');
const fieldLabels: Record<string, string> = { appointment_date: 'Appointment date (civil date)', appointment_at: 'Appointment instant (explicit offset)',
  appointment_timezone: 'Appointment time zone (IANA)', destination: 'Destination', report_reference: 'Report reference',
  assistance_program: 'Assistance program', request_reference: 'Request reference', outcome: 'Response outcome',
  response_reference: 'Response reference', source: 'Acquisition evidence source', exception_id: 'Barrier ID', code: 'Barrier type', reason: 'Barrier reason' };

function StepEvidence({ command }: { command: CareStepCommand }) {
  return <div className="space-y-1 break-words">
    <p>Evidence: {command.payload.evidence}</p>
    <p>Occurred: {command.payload.occurred_at}</p>
    <p>Next action: {command.payload.next_action}</p>
    <p>Next review: {command.payload.next_review_at}</p>
    {Object.entries(command.payload.details).map(([key, value]) => <p key={key}>{fieldLabels[key] ?? human(key)}: {value === null ? 'Not supplied' : ['code', 'outcome', 'source'].includes(key) ? human(value) : value}</p>)}
  </div>;
}
export function CareWorkflowPanel(props: Props) {
  return <WorkflowState key={`${props.scopeKey}:${props.actorId}:${props.patientId}:${props.organizationId}:${props.workId}`} {...props} />;
}
function WorkflowState({ actorId, patientId, organizationId, workId, initial }: Props) {
  const scope = { actor_id: actorId, patient_id: patientId, organization_id: organizationId };
  const read = { actor_id: actorId, patient_id: patientId, work_item_id: workId };
  const [detail, setDetail] = useState(initial);
  const [kind, setKind] = useState(initial?.kind ?? null);
  const [labReady, setLabReady] = useState(false);
  const [humanReady, setHumanReady] = useState(false);
  const [adminReady, setAdminReady] = useState(false);
  const [routingReady, setRoutingReady] = useState(false);
  const [labRefreshToken, setLabRefreshToken] = useState(0);
  const [items, setItems] = useState<CareStepState[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);
  const [selected, setSelected] = useState<CareStepInput | null>(null);
  const [saved, setSaved] = useState<CareStepState | null>(null);
  const [command, setCommand] = useState<CareStepCommand['command']>('record_exception');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sessionChanged, setSessionChanged] = useState(false);
  const inFlight = useRef(false);
  const readInFlight = useRef(false);
  const generation = useRef(0);
  const invalidSession = useRef(false);
  useEffect(() => {
    const { data: { subscription } } = createClient().auth.onAuthStateChange((_event, session) => {
      if (session?.user.id === actorId) return;
      invalidSession.current = true; generation.current += 1;
      setSessionChanged(true); setSelected(null); setSaved(null); setItems([]);
    });
    return () => { generation.current += 1; subscription.unsubscribe(); };
  }, [actorId]);

  async function load(after: string | null = null) {
    if (inFlight.current || invalidSession.current) return;
    inFlight.current = true; const version = ++generation.current;
    readInFlight.current = true;
    setBusy(true); setError(null); setComplete(false);
    setLabReady(false); setHumanReady(false); setAdminReady(false); setRoutingReady(false); setLabRefreshToken((value) => value + 1);
    if (!after) { setItems([]); setCursor(null); }
    try {
      // Never use an old applied receipt as the next command's stage or ownership context.
      const current = await loadCareWorkflow(read);
      if (version !== generation.current) return;
      const currentDetail = current.data?.organization_id === scope.organization_id ? current.data : null;
      setDetail(currentDetail);
      if (currentDetail) setKind(currentDetail.kind);
      if (currentDetail) setCommand((old) => availableCareCommands(currentDetail.kind, currentDetail.stage).includes(old) ? old : 'record_exception');
      const response = await loadPendingCareSteps({ ...scope, after });
      if (version !== generation.current) return;
      if (!response.data) { setError(CARE_STEP_READ_UNAVAILABLE); return; }
      setItems((old) => after ? [...old, ...response.data!.items] : response.data!.items);
      setCursor(response.data.next_cursor); setComplete(response.data.next_cursor === null);
      if (!currentDetail) setError('Current workflow detail is unavailable. Your own authorized pending receipts may still be recovered below; new steps remain unavailable.');
    } catch { if (version === generation.current) setError(CARE_STEP_READ_UNAVAILABLE); }
    finally { if (version === generation.current) { inFlight.current = false; readInFlight.current = false; setBusy(false); } }
  }
  async function operate(input: CareStepInput, action: (input: CareStepInput) => Promise<CareStepResult>) {
    if (inFlight.current || invalidSession.current) return;
    inFlight.current = true; const version = ++generation.current;
    setSelected(input); setSaved(null); setComplete(false); setBusy(true); setError(null);
    setLabReady(false); setHumanReady(false); setAdminReady(false); setRoutingReady(false);
    try {
      const response = await action(input);
      if (version !== generation.current) return;
      if (!response.data) setError(CARE_STEP_UNCONFIRMED); else setSaved(response.data);
    } catch { if (version === generation.current) setError(CARE_STEP_UNCONFIRMED); }
    finally { if (version === generation.current) { inFlight.current = false; setBusy(false); } }
  }
  const pendingHere = items.filter((item) => item.work_item_id === workId);
  const allowed = detail ? availableCareCommands(detail.kind, detail.stage) : [];
  const stepsReady = complete && !pendingHere.length && !selected && !busy;
  const mayPrepare = !!detail && stepsReady && humanReady && (detail.kind !== 'laboratory_order' || labReady && adminReady && routingReady) && canRecordCareStep(detail, actorId);
  function siblingChanged() {
    // Invalidate current reads, never the outcome of an exact private write.
    if (readInFlight.current) { generation.current += 1; readInFlight.current = false; inFlight.current = false; setBusy(false); }
    setDetail(null); setComplete(false); setLabReady(false); setHumanReady(false); setAdminReady(false); setRoutingReady(false);
  }
  function prepare(form: HTMLFormElement) {
    if (inFlight.current || invalidSession.current || !detail || !mayPrepare || !allowed.includes(command)) return;
    const values = new FormData(form);
    const value = (key: string) => String(values.get(key) ?? '');
    const utc = (key: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value(key))
      ? `${value(key)}${value(key).length === 16 ? ':00' : ''}Z` : '';
    let details: Record<string, string | null> = {};
    if (command === 'record_schedule') details = { appointment_date: value('appointment_date'),
      appointment_at: value('appointment_at') || null, appointment_timezone: value('appointment_timezone') || null };
    if (command === 'record_destination_acceptance') details = { destination: value('destination') };
    if (command === 'record_report') details = { report_reference: value('report_reference') };
    if (command === 'record_assistance_request') details = { assistance_program: value('assistance_program'), request_reference: value('request_reference') };
    if (command === 'record_assistance_response') details = { outcome: value('outcome'), response_reference: value('response_reference') };
    if (command === 'record_obtained') details = { source: value('source') };
    // Validate before generating any durable identity; replace this validation-only UUID after success.
    if (command === 'record_exception') details = { exception_id: '00000000-0000-4000-8000-000000000000', code: value('code'), reason: value('reason') };
    const parsed = validateNewCareStep({ command, payload: { occurred_at: utc('occurred_at'), evidence: value('evidence'),
      next_action: value('next_action'), next_review_at: utc('next_review_at'), details } });
    if (!parsed) { setError('Verify meaningful evidence, details and next action; occurrence cannot be future and next review must be future. An optional appointment instant needs an explicit offset matching its civil date and IANA time zone.'); return; }
    if (parsed.command === 'record_exception') parsed.payload.details.exception_id = crypto.randomUUID();
    void operate({ ...scope, work_item_id: detail.work_item_id, request_id: crypto.randomUUID(),
      expected_revision: detail.revision, expected_ownership_revision: detail.ownership_revision, ...parsed }, prepareCareStep);
  }
  const textField = (name: string, max = 1000) => <label key={name} className="block font-medium">{fieldLabels[name]}
    <textarea className={control} name={name} required minLength={3} maxLength={max} disabled={busy} /></label>;
  if (sessionChanged) return <p role="alert">Your session changed. Reload this follow-up page before continuing.</p>;
  const barriers = detail ? careExceptionHistory(detail) : [];
  const openBarriers = barriers.filter((row) => !row.resolution), resolvedBarriers = barriers.filter((row) => row.resolution);
  const closure = detail?.humans.find((row) => row.request.command === 'close_success' || row.request.command === 'close_without_completion');
  const closureReceipt = closure && 'closed_at' in closure.receipt ? closure.receipt : null;
  return <section className="space-y-5 text-sm" aria-labelledby="care-workflow-heading" aria-busy={busy}>
    <header className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Documented care follow-up</p>
      <h1 id="care-workflow-heading" className="text-2xl font-bold">{detail ? CARE_KIND_LABELS[detail.kind] : 'Recover your step receipts'}</h1>
      <p>Use synthetic information only. Recording a step does not send an order, confirm communication, record clinical review or complete care.</p>
      <p className="break-all text-xs text-slate-600">Work: {workId} · Organization: {organizationId}</p>
    </header>
    {detail ? <>
    <div className="grid gap-3 sm:grid-cols-3" aria-label="Last loaded workflow snapshot">
      <div className="rounded-xl border bg-blue-50 p-4"><p>Documented stage</p><p className="font-semibold">{CARE_STAGE_LABELS[detail.stage]}</p></div>
      <div className="rounded-xl border bg-white p-4"><p>Queue status</p><p className="font-semibold">{human(detail.work_status)}</p><p>Revision {detail.revision}</p></div>
      <div className="rounded-xl border bg-amber-50 p-4"><p>{closureReceipt ? 'Historical queue deadline' : 'Earliest queue review'}</p><p className="break-all font-semibold">{detail.due_at}</p>
        <p>{closureReceipt ? 'Retained from before closure; not a new active obligation.' : 'Includes every unresolved barrier.'}</p></div>
    </div>
    <div className="rounded-xl border bg-white p-4">
      <p>{closureReceipt ? 'Historical workflow action' : 'Workflow next action'}: {detail.next_action}</p>
      <p>{closureReceipt ? 'Historical workflow review' : 'Workflow review'}: {detail.next_review_at}</p>
      {closureReceipt && <div role="status" className="mt-3 space-y-2 rounded-lg border border-blue-200 p-3">
        <p className="font-semibold">{closureReceipt.care_completed ? 'Closed — documented workflow completion' : 'Closed — care not completed'}</p>
        <p>Recorded closure: {closureReceipt.closed_at} · {human(closureReceipt.completion_outcome)}</p>
        <p>The factual stage and original evidence remain unchanged. No new review, deadline, transmission, treatment efficacy or patient outcome is inferred.</p>
        {closureReceipt.completion_outcome === 'transferred' && <p>Transfer disposition is not accepted ownership or a confirmed handoff.</p>}
        <p>Later source changes are not covered by this closure. They require separate follow-up; this work does not automatically reopen.</p>
      </div>}
      <p className="mt-2">{canRecordCareStep(detail, actorId) ? 'You are the accepted owner in this snapshot. Every write rechecks current access and revisions.'
        : 'Recording is unavailable: it requires the current accepted owner, open work and no pending transfer. Use Daily Loop to review responsibility.'}</p>
      <a href="/dashboard" className={`${button} mt-2`}>Open Daily Loop for responsibility</a>
    </div>
    <section className="space-y-3" aria-labelledby="care-history-heading">
      <h2 id="care-history-heading" className="text-lg font-bold">Recorded history</h2>
      <p>Ordered by recorded revision, not by occurrence. The timestamps and source evidence remain distinct.</p>
      <ol className="space-y-3 border-l-2 border-blue-200 pl-4">
        <li className="space-y-1 rounded-xl border bg-white p-4">
          <h3 className="font-semibold">1 · Request recorded</h3>
          <p>Purpose: {detail.request.purpose}</p><p>Source: {human(detail.request.source)}</p><p>Evidence: {detail.request.evidence}</p>
          <p>Occurred: {detail.request.occurred_at}</p><p>Recorded: {detail.events[0].recorded_at}</p>
          {detail.requested_analytes.length > 0 && <p>Requested analytes: {detail.requested_analytes.join(', ')}</p>}
        </li>
        {careWorkflowTimeline(detail).map((item) => <li key={item.id} className="min-w-0 space-y-2 break-words rounded-xl border bg-white p-4">
          <h3 className="font-semibold">{item.revision} · {item.kind === 'step' ? CARE_STEP_LABELS[item.event.command as CareStepCommand['command']]
            : item.kind === 'human' ? item.event.request.command === 'record_review' ? 'Human review recorded' : item.event.request.command === 'record_contact' ? 'Human contact documented'
              : item.event.request.command === 'resolve_exception' ? 'Barrier resolution recorded' : item.event.request.command === 'resolve_source_invalidation'
                ? 'Source-change resolution recorded' : `${HUMAN_COMMAND_LABELS[item.event.request.command]} recorded` : 'Laboratory source composition recorded'}</h3>
          <p>{CARE_STAGE_LABELS[item.event.from_stage]} → {CARE_STAGE_LABELS[item.event.to_stage]}</p>
          {item.kind === 'step' ? <StepEvidence command={careStepCommandSchema.parse({ command: item.event.command, payload: item.event.payload })} />
            : item.kind === 'human' ? <>
              <p>Historical human record — its evidence may have changed. This does not establish current review validity or endorsement by a new responsible professional.</p>
              <CareHumanEvidence input={item.event.request} />
              <p>Request recorded: {item.event.request.recorded_at}</p>
            </> : <>
            <p>Historical source snapshot — values and associations may have changed since this record. This is not current source verification, clinical review, confirmed communication or care completion.</p>
            <p>Evidence: {item.event.payload.evidence}</p><p>Selection reason: {item.event.payload.reason}</p>
            <p>Occurred: {item.event.payload.occurred_at}</p><p>Next action: {item.event.payload.next_action}</p><p>Next review: {item.event.payload.next_review_at}</p>
            <ul aria-label={`Historical sources at revision ${item.revision}`} className="space-y-2">
              {item.event.receipt.sources.map((source) => <li key={source.analyte} className="rounded-lg bg-slate-50 p-3 break-words">
                <p className="font-medium">{LAB_OBSERVATION_FIELDS[source.analyte].label}: {source.observed_head === null ? 'Missing from this composition'
                  : source.observed_head.status === 'cancelled' ? 'Cancelled source; no value' : `${source.observed_head.value} ${LAB_OBSERVATION_FIELDS[source.analyte].unit}`}</p>
                {source.observed_head && <><p>Collected: {source.observed_head.collected_at}</p>
                  <p className="break-all text-xs">Root: {source.root_id} · Observed version: {source.observed_head.version_id} · Revision: {source.observed_head.revision}</p></>}
              </li>)}
            </ul>
            {item.event.receipt.intent_resolutions.map((resolution) => <div key={resolution.intent_id} className="rounded-lg border p-3 break-words">
              <p>Saved attempt reconciliation: {resolution.disposition === 'linked' ? 'Exact saved sources associated' : 'Saved sources not used'}</p>
              <p>Reason: {resolution.reason}</p>
              <p>Matched: {resolution.matched_analytes.length ? resolution.matched_analytes.map((key) => LAB_OBSERVATION_FIELDS[key].label).join(', ') : 'None'}</p>
              <p>Missing from the intended save: {resolution.missing_analytes.length ? resolution.missing_analytes.map((key) => LAB_OBSERVATION_FIELDS[key].label).join(', ') : 'None recorded'}</p>
              <p className="break-all text-xs">Intention: {resolution.intent_id} · Saved result: {resolution.lab_result_id}</p>
            </div>)}
          </>}
          <p>Recorded: {item.event.recorded_at}</p><p className="break-all text-xs">Recorded by: {item.event.actor_id}</p>
        </li>)}
      </ol>
    </section>
    <section className="space-y-3" aria-labelledby="care-barriers-heading">
      <h2 id="care-barriers-heading" className="text-lg font-bold">{closureReceipt ? 'Unresolved barriers retained at closure' : 'Unresolved barriers'} ({openBarriers.length})</h2>
      {openBarriers.length === 0 ? <p>No unresolved barrier remains in this snapshot. This does not confirm completion.</p>
        : <ul className="space-y-3">{openBarriers.map(({ exception: item }) => <li key={item.id} className="space-y-1 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <h3 className="font-semibold">{human(item.code)}</h3><p>{item.reason}</p><p>{closureReceipt ? 'Original action' : 'Next action'}: {item.next_action}</p>
          <p>{closureReceipt ? 'Original review deadline (historical)' : 'Review by'}: {item.next_review_at}</p><p className="break-all text-xs">Barrier: {item.id} · {item.human_origin_event_id ? 'Human contact origin' : 'Operational origin'}: {item.human_origin_event_id ?? item.origin_event_id}</p>
        </li>)}</ul>}
      {resolvedBarriers.length > 0 && <details><summary>Resolved barriers — original history retained</summary>
        <ul className="space-y-3">{resolvedBarriers.map(({ exception: item, resolution }) =>
          <li key={item.id} className="rounded-xl border bg-slate-50 p-4"><p>{human(item.code)}: {item.reason}</p>
            <p>Resolution recorded at revision {resolution!.revision}, {resolution!.recorded_at}.</p>
            <p className="break-all text-xs">Barrier: {item.id} · Resolution event: {resolution!.id}</p>
            <p>Original evidence and resolution justification remain in the timeline.</p></li>)}</ul></details>}
      <p>{closureReceipt ? 'Unresolved-at-closure barriers remain preserved, not resolved or assigned a new deadline. The closure declaration and original reasons are in the timeline.'
        : 'A later step does not resolve an earlier barrier. Use the exact barrier resolution control below. Resolution does not resolve source invalidations or confirm completed care; closure requires its own explicit record.'}</p>
    </section>
    </> : <p>Workflow detail is unavailable. Checking your own pending receipts does not restore ownership or permit a new step.</p>}
    {!selected && <div className="space-y-3 rounded-xl border bg-slate-50 p-4">
      <button className={button} type="button" disabled={busy} onClick={() => void load()}>Refresh workflow and check pending steps</button>
      <p>Load complete step and human recovery lists before preparing a step. Laboratory follow-up also requires verified laboratory, administrative and post-closure routing recovery lists with no own unresolved intention, composition, administrative or routing request. Nothing is applied automatically.</p>
      {items.length > 0 && <ul className="space-y-2" aria-label="Pending step receipts">{items.map((item) => <li key={item.request_id} className="rounded-lg border bg-white p-3">
        <p>{CARE_STEP_LABELS[item.command as CareStepCommand['command']]} · {item.state === 'applied' ? 'Recorded; receipt unacknowledged' : 'Prepared; not recorded'}</p>
        {item.work_item_id === workId ? <button className={button} type="button" disabled={busy}
          onClick={() => void operate(careStepInputFromState(item), recoverCareStep)}>Review step {item.request_id}</button>
          : <a className={button} href={`/patients/${item.patient_id}/care/${item.work_item_id}?organization=${item.organization_id}`}>Open other follow-up</a>}
      </li>)}</ul>}
      {cursor && <button className={button} type="button" disabled={busy} onClick={() => void load(cursor)}>Load more pending steps</button>}
      {mayPrepare && <form aria-label="New documented step" className="space-y-3" onSubmit={(event) => { event.preventDefault(); prepare(event.currentTarget); }}>
        <label className="block font-medium">Step to document<select className={control} value={command} disabled={busy} onChange={(event) => setCommand(event.target.value as typeof command)}>
          {allowed.map((option) => <option key={option} value={option}>{CARE_STEP_LABELS[option]}</option>)}
        </select></label>
        <div key={command} className="space-y-3">
          {command === 'record_schedule' && <>
            <label className="block font-medium">{fieldLabels.appointment_date}<input className={control} type="date" name="appointment_date" required disabled={busy} /></label>
            <label className="block font-medium">{fieldLabels.appointment_at}<input className={control} name="appointment_at" placeholder="2026-11-01T01:30:00-04:00" disabled={busy} /></label>
            <label className="block font-medium">{fieldLabels.appointment_timezone}<input className={control} name="appointment_timezone" placeholder="America/New_York" disabled={busy} /></label>
            <p>Date alone is allowed. Supply the instant and zone together only when known. The appointment date is not the queue review deadline.</p>
          </>}
          {command === 'record_destination_acceptance' && textField('destination', 500)}
          {command === 'record_report' && textField('report_reference')}
          {command === 'record_assistance_request' && <>{textField('assistance_program', 500)}{textField('request_reference')}</>}
          {command === 'record_assistance_response' && <>
            <label className="block font-medium">{fieldLabels.outcome}<select className={control} name="outcome" required disabled={busy} defaultValue=""><option value="" disabled>Choose documented response</option>
              {['approved', 'denied', 'pending', 'other'].map((item) => <option key={item} value={item}>{human(item)}</option>)}</select></label>
            {textField('response_reference')}<p>Approval does not mean the medication was obtained. Denial creates a separate unresolved barrier.</p>
          </>}
          {command === 'record_obtained' && <label className="block font-medium">{fieldLabels.source}<select className={control} name="source" required disabled={busy} defaultValue=""><option value="" disabled>Choose evidence source</option>
            <option value="patient_report">Patient report</option><option value="professional_verification">Professional verification</option></select></label>}
          {command === 'record_exception' && <>
            <label className="block font-medium">{fieldLabels.code}<select className={control} name="code" required disabled={busy} defaultValue=""><option value="" disabled>Choose barrier</option>
              {careExceptionCodeSchema.options.map((item) => <option key={item} value={item}>{human(item)}</option>)}</select></label>{textField('reason')}
            <p>A cancellation or refusal records a barrier; it does not close this follow-up.</p>
          </>}
        </div>
        <label className="block font-medium">Evidence or source reference<textarea className={control} name="evidence" required minLength={3} maxLength={1000} disabled={busy} /></label>
        <label className="block font-medium">Occurred at (UTC)<input className={control} name="occurred_at" type="datetime-local" step="1" required disabled={busy} /></label>
        <label className="block font-medium">Next action<textarea className={control} name="next_action" required minLength={3} maxLength={500} disabled={busy} /></label>
        <label className="block font-medium">Next review at (UTC)<input className={control} name="next_review_at" type="datetime-local" step="1" required disabled={busy} /></label>
        <p>Enter UTC clock time explicitly. No clinical interval is suggested. Collection and attendance use the actual occurrence, not the recording time.</p>
        <button className={button} type="submit" disabled={busy}>Prepare step for review</button>
      </form>}
    </div>}
    {selected && <div className="space-y-3 rounded-xl border border-blue-300 bg-blue-50 p-4" aria-label="Frozen step">
      <h2 className="text-lg font-bold">{CARE_STEP_LABELS[selected.command]}</h2>
      <p className="break-all">Request: {selected.request_id}</p><p>Expected workflow revision: {selected.expected_revision} · Ownership revision: {selected.expected_ownership_revision}</p>
      <StepEvidence command={selected} />
      {!saved && <p>State unconfirmed. Keep this identity. If access fails, stop and verify permissions with an authorized team member. If revisions changed, recover and cancel the still-prepared request, then reload current state; never alter its frozen revisions or create a replacement while the outcome is unknown.</p>}
      {saved?.state === 'prepared' && <p role="status">Prepared and recoverable. This step has not been recorded.</p>}
      {saved?.state === 'applied' && <div role="status"><p>Step recorded at revision {saved.receipt!.workflow_revision}. This receipt is historical; the snapshot above has not been refreshed.</p>
        <p>Queue deadline at application: {saved.receipt!.due_at}. No clinical review, confirmed communication or care completion was recorded.</p></div>}
      {saved?.state === 'cancelled' && <p role="status">Preparation cancelled. No step or care completion was recorded by this request.</p>}
      <div className="flex flex-wrap gap-2">
        <button className={button} type="button" disabled={busy} onClick={() => void operate(selected, recoverCareStep)}>Check saved step</button>
        {!saved && <button className={button} type="button" disabled={busy} onClick={() => void operate(selected, prepareCareStep)}>Retry preparation with same ID</button>}
        {saved?.state === 'prepared' && <>
          <button className={button} type="button" disabled={busy} onClick={() => void operate(selected, applyCareStep)}>Confirm documented step</button>
          <button className={button} type="button" disabled={busy} onClick={() => void operate(selected, cancelCareStep)}>Cancel prepared step</button>
        </>}
        {saved?.state === 'applied' && !saved.acknowledged_at && <button className={button} type="button" disabled={busy} onClick={() => void operate(selected, acknowledgeCareStep)}>Acknowledge step receipt</button>}
        {(saved?.state === 'cancelled' || saved?.acknowledged_at) && <button className={button} type="button" disabled={busy}
          onClick={() => { setSelected(null); setSaved(null); void load(); }}>Reload current workflow</button>}
      </div>
    </div>}
    {(kind === null || kind === 'laboratory_order') && <CareLabPanel scope={scope} workId={workId} workflow={detail}
      stepsReady={stepsReady && humanReady && adminReady && routingReady} refreshToken={labRefreshToken} onReadiness={setLabReady} onChanged={siblingChanged} />}
    {(kind === null || kind === 'laboratory_order') && <CareUnsavedIntentPanel scope={scope} workId={workId} workflow={detail}
      peersReady={stepsReady && humanReady && labReady && routingReady} refreshToken={labRefreshToken} onReadiness={setAdminReady} onChanged={siblingChanged} />}
    {(kind === null || kind === 'laboratory_order') && <CarePostclosurePanel scope={scope} workId={workId} workflow={detail}
      peersReady={stepsReady && humanReady && labReady && adminReady} refreshToken={labRefreshToken} onReadiness={setRoutingReady} onChanged={siblingChanged} />}
    <CareHumanPanel scope={scope} workId={workId} workflow={detail}
      peersReady={stepsReady && (kind !== null && kind !== 'laboratory_order' || labReady && adminReady && routingReady)}
      refreshToken={labRefreshToken} onReadiness={setHumanReady} onChanged={siblingChanged} />
    {busy && <p role="status">Checking current authorized follow-up state…</p>}
    {error && <p role="alert" className="text-red-800">{error}</p>}
  </section>;
}
