'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { LAB_OBSERVATION_FIELDS } from '@/lib/labs/quality';
import { acknowledgeCareLabSubmission, cancelCareLabSubmission, getCareLabSubmission, prepareCareLabSubmission, saveCareLabResult,
  type LabActionState, type LabSubmission, type LabSubmissionState } from '@/lib/dashboard/actions';
import { prepareSubmissionIntent, recoverSubmissionIntent, cancelSubmissionIntent } from '@/lib/care-workflow/submission-intent-actions';
import { submissionIntentAnalyteSchema, validateNewSubmissionIntent, type SubmissionIntentInput, type SubmissionIntentState } from '@/lib/care-workflow/submission-intent-types';
import type { CareScope } from '@/lib/care-workflow/types';
import type { CareWorkflowDetail } from '@/lib/care-workflow/step-types';
import { AddLabForm } from './lab-results-tab';

type Props = { scope: CareScope; workId: string; detail: CareWorkflowDetail | null; initial: SubmissionIntentInput | null;
  mayStart: boolean; onBlock: () => void; onClose: () => void };
const control = 'min-h-11 w-full rounded-md border bg-white px-3 py-2';
const button = 'min-h-11 rounded-lg border bg-white px-3 py-2 font-medium disabled:opacity-50';
const uncertain = 'The operation is unconfirmed. Recover the same intention or submission; do not resend values or create a replacement.';
export function CareLabSave(props: Props) {
  return <SaveState key={`${props.scope.actor_id}:${props.scope.organization_id}:${props.scope.patient_id}:${props.workId}:${props.initial?.intent_id ?? 'new'}`} {...props} />;
}
function SaveState({ scope, workId, detail, initial, mayStart, onBlock, onClose }: Props) {
  const [input, setInput] = useState(initial);
  const [intent, setIntent] = useState<SubmissionIntentState | null>(null);
  const [submission, setSubmission] = useState<LabSubmission | null>(null);
  const [fresh, setFresh] = useState(false);
  const [editable, setEditable] = useState(false);
  const [attemptUncertain, setAttemptUncertain] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionChanged, setSessionChanged] = useState(false);
  const generation = useRef(0), inFlight = useRef(false), live = useRef(true);
  const callbacks = useRef({ onBlock, onClose }); callbacks.current = { onBlock, onClose };
  useEffect(() => {
    live.current = true;
    const { data: { subscription } } = createClient().auth.onAuthStateChange((_event, session) => {
      if (session?.user.id === scope.actor_id) return;
      live.current = false; generation.current += 1; setSessionChanged(true); setInput(null); setIntent(null); setSubmission(null); setEditable(false);
      callbacks.current.onBlock();
    });
    return () => { live.current = false; generation.current += 1; subscription.unsubscribe(); };
  }, [scope.actor_id]);
  const current = () => live.current;
  function accept(result: LabSubmissionState, exact?: string) {
    if (!result.success || result.actorId.toLowerCase() !== scope.actor_id.toLowerCase()
      || exact && result.submission?.requestId !== exact) throw new Error(uncertain);
    setSubmission(result.submission); setAttemptUncertain(false); return result.submission;
  }
  async function run(task: (valid: () => boolean) => Promise<void>) {
    if (inFlight.current || !live.current) return;
    inFlight.current = true; const version = ++generation.current;
    const valid = () => live.current && version === generation.current;
    setBusy(true); setError(null); callbacks.current.onBlock();
    try { await task(valid); } catch { if (valid()) { setError(uncertain); setEditable(false); } }
    finally { if (valid()) { inFlight.current = false; setBusy(false); } }
  }
  function start(form: HTMLFormElement) {
    if (!mayStart || !detail || input || submission || attemptUncertain || !live.current) return;
    const values = new FormData(form);
    const occurred = String(values.get('intent_occurred_at') ?? '');
    const occurredAt = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(occurred) ? occurred + (occurred.length === 16 ? ':00Z' : 'Z') : '';
    const zero = '00000000-0000-4000-8000-000000000000';
    const validated = validateNewSubmissionIntent({ ...scope, work_item_id: workId, intent_id: zero, submission_request_id: zero,
      expected_revision: detail.revision, expected_ownership_revision: detail.ownership_revision,
      payload: { analytes: values.getAll('intended_analyte'), occurred_at: occurredAt, evidence: String(values.get('intent_evidence') ?? '') } });
    if (!validated || validated.payload.analytes.some((key) => !detail.requested_analytes.includes(key))) {
      setError('Select supported requested analytes and meaningful evidence with a nonfuture occurrence. No values have been saved.'); return;
    }
    void run(async (valid) => {
      setAttemptUncertain(true); setFresh(false); setEditable(false);
      const response = await prepareCareLabSubmission({ actorId: scope.actor_id, patientId: scope.patient_id });
      if (!valid()) return;
      const attempt = accept(response);
      if (!attempt || attempt.status !== 'prepared' || !attempt.isNew) {
        setError('An existing attempt must be recovered or explicitly cancelled. It cannot be bound as a new follow-up entry.'); return;
      }
      const frozen = { ...validated, intent_id: crypto.randomUUID(), submission_request_id: attempt.requestId };
      setInput(frozen); setFresh(true);
      const responseIntent = await prepareSubmissionIntent(frozen);
      if (!valid()) return;
      if (!responseIntent.data) throw new Error(uncertain);
      setIntent(responseIntent.data);
      setEditable(responseIntent.data.state === 'prepared' && responseIntent.data.submission.status === 'awaiting_save');
    });
  }
  async function recoverIntention(action = recoverSubmissionIntent) {
    if (!input) return;
    await run(async (valid) => {
      setIntent(null); setEditable(false);
      const response = await action(input);
      if (!valid()) return;
      if (!response.data) throw new Error(uncertain);
      setIntent(response.data);
      // A recovered page never recreates unsaved values. Only this fresh, never-sent form can reopen.
      if (fresh && response.data.state === 'prepared' && response.data.submission.status === 'awaiting_save') setEditable(true);
    });
  }
  async function readAttempt(action: 'read' | 'cancel' | 'ack' = 'read') {
    await run(async (valid) => {
      setEditable(false);
      const exact = input?.submission_request_id ?? submission?.requestId;
      const base = { actorId: scope.actor_id, patientId: scope.patient_id };
      const response = action === 'cancel' && exact ? await cancelCareLabSubmission({ ...base, requestId: exact })
        : action === 'ack' && exact && submission?.labResultId ? await acknowledgeCareLabSubmission({ ...base, requestId: exact, labResultId: submission.labResultId })
          : await getCareLabSubmission({ ...base, ...(exact ? { requestId: exact } : {}) });
      if (!valid()) return;
      accept(response, exact);
      if (input) {
        const recovered = await recoverSubmissionIntent(input);
        if (!valid()) return;
        if (!recovered.data) throw new Error(uncertain);
        setIntent(recovered.data);
      }
    });
  }
  async function afterSave(result: LabActionState) {
    if (!input || !live.current) return;
    const version = ++generation.current;
    const valid = () => live.current && version === generation.current;
    setEditable(false);
    try {
      const response = await getCareLabSubmission({ actorId: scope.actor_id, patientId: scope.patient_id, requestId: input.submission_request_id });
      if (!valid()) return;
      const attempt = accept(response, input.submission_request_id);
      const recovered = await recoverSubmissionIntent(input);
      if (!valid()) return;
      if (!recovered.data) throw new Error(uncertain);
      setIntent(recovered.data);
      // Known SQL rejection is the only path that permits deliberate editing of this form.
      if (result.status === 'not_saved' && attempt?.status === 'prepared'
        && recovered.data.state === 'prepared' && recovered.data.submission.status === 'awaiting_save') { setFresh(true); setEditable(true); }
      else setFresh(false);
    } catch { if (valid()) { setFresh(false); setIntent(null); setError(uncertain); } }
    finally { if (valid()) { inFlight.current = false; setBusy(false); } }
  }
  const supported = detail?.requested_analytes.filter((key) => submissionIntentAnalyteSchema.safeParse(key).success) ?? [];
  const mayClose = !busy && !error && (intent?.state === 'cancelled' || intent?.state === 'reconciled'
    || intent?.submission.status === 'saved_not_linked' || !input && !attemptUncertain
      && (!submission || submission.status === 'cancelled' || submission.status === 'acknowledged'));
  if (sessionChanged) return <p role="alert">Your session changed. Reload before recovering this laboratory entry.</p>;
  return <section aria-label="Save an exam for this follow-up" className="space-y-3 rounded-xl border p-4 text-sm" aria-busy={busy}>
    <h3 className="font-semibold">Save first, associate separately</h3>
    <p>Synthetic data only. Intended analytes are recorded before values are saved. Saving may run the existing immediate alert rules; it is not association, clinical review, delivery or contact.</p>
    {!input && !submission && !attemptUncertain && mayStart && <form aria-label="New follow-up lab intention" className="space-y-3" onSubmit={(event) => { event.preventDefault(); start(event.currentTarget); }}>
      <fieldset disabled={busy}><legend>Intended requested analytes (supported by the value form)</legend>
        {supported.map((key) => <label key={key} className="flex min-h-11 items-center gap-2"><input type="checkbox" name="intended_analyte" value={key} />{LAB_OBSERVATION_FIELDS[key].label}</label>)}
      </fieldset>
      {!supported.length && <p>No requested analyte is supported by this entry form. Use documented existing sources instead.</p>}
      <label className="block">Intention evidence<textarea name="intent_evidence" required minLength={3} maxLength={1000} className={control} disabled={busy} /></label>
      <label className="block">Intention occurred at (UTC)<input type="datetime-local" step="1" name="intent_occurred_at" required className={control} disabled={busy} /></label>
      <button className={button} disabled={busy || !supported.length}>Prepare new attempt and intention</button>
    </form>}
    {input && <div className="space-y-2 break-words">
      <p className="break-all">Intention: {input.intent_id} · Submission: {input.submission_request_id}</p>
      <p>Intended: {input.payload.analytes.map((key) => LAB_OBSERVATION_FIELDS[key].label).join(', ')}</p>
      <p>Evidence: {input.payload.evidence}</p><p>Occurred: {input.payload.occurred_at}</p>
      <p>Frozen workflow revision: {input.expected_revision} · Ownership revision: {input.expected_ownership_revision}</p>
      {!intent && <p>Intention state unconfirmed. Read the same identity before proceeding.</p>}
      {intent && <p role="status">Intention: {intent.state}. Submission: {intent.submission.status.replaceAll('_', ' ')}.</p>}
      {intent?.submission.lab_result_id && <div className="rounded-lg bg-amber-50 p-3">
        <p>{intent.result_linked ? 'Exact saved sources were associated historically.' : intent.state === 'reconciled'
          ? 'Saved sources explicitly not used; no association recorded.' : 'Saved, not linked to this follow-up.'}</p>
        <p className="break-all">Saved result: {intent.submission.lab_result_id}</p>
        <p>Alert processing: {intent.submission.evaluation_status}. This does not confirm care.</p>
        <p>Missing intended analytes: {intent.submission.missing_analytes.length ? intent.submission.missing_analytes.map((key) => LAB_OBSERVATION_FIELDS[key].label).join(', ') : 'None in this saved record'}</p>
        {intent.reconciliation && <p>Reconciliation: {intent.reconciliation.disposition.replaceAll('_', ' ')}. Later source changes may invalidate the historical association.</p>}
        <p>Receipt acknowledgment does not associate the result. {intent.state !== 'reconciled' && 'Return to source composition to explicitly reconcile it.'}</p>
      </div>}
      <div className="flex flex-wrap gap-2">
        <button className={button} disabled={busy} onClick={() => void recoverIntention()}>Recover exact intention</button>
        {!intent && <button className={button} disabled={busy} onClick={() => void recoverIntention(prepareSubmissionIntent)}>Retry same intention preparation</button>}
        {intent?.state === 'prepared' && ['awaiting_save', 'submission_cancelled'].includes(intent.submission.status) && <button className={button} disabled={busy} onClick={() => { setFresh(false); void recoverIntention(cancelSubmissionIntent); }}>Cancel unsaved intention and attempt</button>}
        {!intent && <button className={button} disabled={busy} onClick={() => { setFresh(false); void readAttempt('cancel'); }}>Cancel exact attempt and check intention</button>}
      </div>
    </div>}
    {fresh && input && intent?.state === 'prepared' && intent.submission.status === 'awaiting_save' && !error
      && <AddLabForm patientId={scope.patient_id} requestId={input.submission_request_id} editable={editable && !busy} isCurrent={current}
        saveAction={(previous, form) => saveCareLabResult(scope.actor_id, previous, form)} onResult={afterSave}
        onStart={() => { inFlight.current = true; setBusy(true); setEditable(false); callbacks.current.onBlock(); }} />}
    {(attemptUncertain || submission || input) && <div className="space-y-2">
      {submission && <p>Exact lab attempt: {submission.status}. {submission.isNew ? 'Newly prepared in this session.' : 'Recovered; values are not recreated.'}</p>}
      <button className={button} disabled={busy} onClick={() => void readAttempt()}>Check exact lab submission</button>
      {!input && submission?.status === 'prepared' && <button className={button} disabled={busy} onClick={() => void readAttempt('cancel')}>Cancel recovered unbound attempt</button>}
      {submission?.status === 'committed' && <button className={button} disabled={busy} onClick={() => void readAttempt('ack')}>Acknowledge exact saved receipt</button>}
    </div>}
    {!fresh && intent?.submission.status === 'awaiting_save' && <p>An earlier save may still be in flight. Recovery never reconstructs or resends values. Recheck or cancel this exact unsaved intention.</p>}
    {mayClose && <button className={button} onClick={onClose}>Return to source association</button>}
    {!busy && input && !intent && submission?.status === 'cancelled' && <div className="space-y-2">
      <p>The exact value attempt is cancelled. Intention status remains unconfirmed; this is not proof that no intention exists. Return to fully reload the private recovery lists before any new operation.</p>
      <button className={button} onClick={onClose}>Return to recovery lists</button>
    </div>}
    {busy && <p role="status">Checking the exact laboratory operation…</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
