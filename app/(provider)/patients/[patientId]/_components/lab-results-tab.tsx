'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { FlaskConical, Loader2, TrendingUp, TrendingDown, Minus, Plus } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { acknowledgeLabSubmission, cancelLabSubmission, getLabSubmission, prepareLabSubmission, retryLabAlerts, saveLabResult } from '@/lib/dashboard/actions';
import type { LabActionState, LabSubmission, LabSubmissionState } from '@/lib/dashboard/actions';

interface LabResult {
  id: string;
  collected_at: string;
  potassium: number | null;
  creatinine: number | null;
  egfr: number | null;
  bun: number | null;
  bnp: number | null;
  nt_probnp: number | null;
  hba1c: number | null;
  glucose: number | null;
  sodium: number | null;
  hemoglobin: number | null;
  ferritin: number | null;
  tsat: number | null;
  ldl: number | null;
  lab_facility: string | null;
  notes: string | null;
}

interface LabField {
  key: keyof LabResult;
  label: string;
  unit: string;
  normalLow: number;
  normalHigh: number;
  category: string;
}

const LAB_FIELDS: LabField[] = [
  { key: 'potassium', label: 'Potassium', unit: 'mEq/L', normalLow: 3.5, normalHigh: 5.0, category: 'Renal Panel' },
  { key: 'creatinine', label: 'Creatinine', unit: 'mg/dL', normalLow: 0.7, normalHigh: 1.3, category: 'Renal Panel' },
  { key: 'egfr', label: 'eGFR', unit: 'mL/min', normalLow: 60, normalHigh: 120, category: 'Renal Panel' },
  { key: 'bun', label: 'BUN', unit: 'mg/dL', normalLow: 7, normalHigh: 20, category: 'Renal Panel' },
  { key: 'bnp', label: 'BNP', unit: 'pg/mL', normalLow: 0, normalHigh: 100, category: 'Cardiac Biomarkers' },
  { key: 'nt_probnp', label: 'NT-proBNP', unit: 'pg/mL', normalLow: 0, normalHigh: 300, category: 'Cardiac Biomarkers' },
  { key: 'sodium', label: 'Sodium', unit: 'mEq/L', normalLow: 136, normalHigh: 145, category: 'Metabolic' },
  { key: 'glucose', label: 'Glucose', unit: 'mg/dL', normalLow: 70, normalHigh: 100, category: 'Metabolic' },
  { key: 'hba1c', label: 'HbA1c', unit: '%', normalLow: 4.0, normalHigh: 5.7, category: 'Metabolic' },
  { key: 'hemoglobin', label: 'Hemoglobin', unit: 'g/dL', normalLow: 12.0, normalHigh: 17.5, category: 'Hematology' },
  { key: 'ferritin', label: 'Ferritin', unit: 'ng/mL', normalLow: 30, normalHigh: 400, category: 'Hematology' },
  { key: 'tsat', label: 'TSAT', unit: '%', normalLow: 20, normalHigh: 50, category: 'Hematology' },
  { key: 'ldl', label: 'LDL', unit: 'mg/dL', normalLow: 0, normalHigh: 100, category: 'Lipids' },
];

function getStatus(value: number | null, low: number, high: number): 'normal' | 'low' | 'high' | null {
  if (value === null) return null;
  if (value < low) return 'low';
  if (value > high) return 'high';
  return 'normal';
}

function StatusIcon({ status }: { status: 'normal' | 'low' | 'high' | null }) {
  if (!status) return null;
  if (status === 'high') return <TrendingUp className="h-3.5 w-3.5 text-red-500" />;
  if (status === 'low') return <TrendingDown className="h-3.5 w-3.5 text-amber-500" />;
  return <Minus className="h-3.5 w-3.5 text-green-500" />;
}

function ValueCell({ value, unit, low, high }: { value: number | null; unit: string; low: number; high: number }) {
  if (value === null) return <span className="text-gray-300">—</span>;
  const status = getStatus(value, low, high);
  const color = status === 'high' ? 'text-red-700 font-semibold' : status === 'low' ? 'text-amber-700 font-semibold' : 'text-gray-900';
  return (
    <span className={`flex items-center gap-1 ${color}`}>
      {value} <span className="text-xs text-gray-400">{unit}</span>
      <StatusIcon status={status} />
    </span>
  );
}

/** Resolve browser-local wall time without silently normalizing a DST gap or overlap. */
function collectionTimeOptions(value: string): Array<{ value: string; label: string }> {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return [];
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const local = new Date(value);
  if (!Number.isFinite(local.getTime())) return [];

  // Include offsets on both sides of a nearby transition, including half-hour DST.
  const offsets = new Set([-1, 0, 1].map((days) =>
    new Date(local.getTime() + days * 86_400_000).getTimezoneOffset(),
  ));
  return [...offsets].map((offset) => new Date(Date.UTC(year, month - 1, day, hour, minute) + offset * 60_000))
    .filter((date) => date.getFullYear() === year && date.getMonth() === month - 1
      && date.getDate() === day && date.getHours() === hour && date.getMinutes() === minute)
    .sort((a, b) => a.getTime() - b.getTime())
    .map((date) => {
      const offset = -date.getTimezoneOffset();
      const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0');
      const minutes = String(Math.abs(offset) % 60).padStart(2, '0');
      return { value: date.toISOString(), label: `UTC${offset >= 0 ? '+' : '-'}${hours}:${minutes}` };
    });
}

function isTerminalSave(state: LabActionState) {
  return state.status === 'saved' || (state.success === true && !state.status);
}

/** Date normalizes offsets but only retains milliseconds; preserve the source fraction. */
function collectionUTC(value: string): string {
  const fraction = /\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/.exec(value)?.[1];
  return new Date(value).toISOString().replace(/\.\d{3}Z$/, `.${fraction ?? '000'}Z`);
}

function PendingLabEvaluation({ patientId, labResultId, collectedAt, onResolved, isCurrent }: {
  patientId: string; labResultId: string; collectedAt: string | null; onResolved: () => void; isCurrent: () => boolean;
}) {
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState(false);
  const busy = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const retry = async () => {
    if (busy.current || !isCurrent()) return;
    busy.current = true;
    setRetrying(true);
    setRetryError(false);
    try {
      const result = await retryLabAlerts({ patientId, labResultId });
      if (!alive.current || !isCurrent()) return;
      if (isTerminalSave(result)) onResolved();
      else setRetryError(true);
    } catch {
      if (alive.current && isCurrent()) setRetryError(true);
    } finally {
      busy.current = false;
      if (alive.current && isCurrent()) setRetrying(false);
    }
  };

  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-3 space-y-2">
      <p role="status" className="text-sm font-medium text-amber-900">Lab result saved. Alert evaluation pending.</p>
      <p className="text-sm text-amber-900">The saved exam will not be inserted again. This status does not confirm notification delivery or clinical review.</p>
      <p className="text-xs text-amber-900">Collection (UTC): {collectedAt
        ? <time dateTime={collectedAt}>{collectionUTC(collectedAt)}</time> : 'Unavailable; verify the saved lab record.'}</p>
      {retryError && <p role="alert" className="text-sm text-red-700">Unable to complete alert evaluation. The saved lab result is unchanged.</p>}
      <button type="button" onClick={retry} disabled={retrying} className="rounded-md border border-amber-600 px-3 py-2 text-sm disabled:opacity-50">
        {retrying ? 'Retrying alert evaluation…' : 'Retry alert evaluation'}
      </button>
    </div>
  );
}

function AddLabForm({ patientId, requestId, editable, onResult, onStart, isCurrent }: {
  patientId: string; requestId: string; editable: boolean;
  onResult: (result: LabActionState) => Promise<void>; onStart: () => void; isCurrent: () => boolean;
}) {
  const [collectedLocal, setCollectedLocal] = useState('');
  const [selectedInstant, setSelectedInstant] = useState('');
  const [timeZone, setTimeZone] = useState('');
  const [values, setValues] = useState({ potassium: '', egfr: '', creatinine: '', sodium: '' });
  const [state, setState] = useState<LabActionState | null>(null);
  const [isPending, setIsPending] = useState(false);
  const busy = useRef(false);
  const alive = useRef(true);
  const timeOptions = collectionTimeOptions(collectedLocal);
  const collectedAt = timeOptions.length === 1 ? timeOptions[0].value
    : timeOptions.find((option) => option.value === selectedInstant)?.value ?? '';

  useEffect(() => {
    alive.current = true;
    setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    if (!isPending) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeLeaving);
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
  }, [isPending]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy.current || !editable || !isCurrent() || !requestId || !collectedAt) return;
    busy.current = true;
    setIsPending(true);
    onStart();
    const payload = new FormData(event.currentTarget);
    let result: LabActionState;
    try {
      result = await saveLabResult(state, payload);
    } catch {
      result = { status: 'save_unconfirmed' };
    }
    if (!alive.current || !isCurrent()) return;
    setState(result);
    await onResult(result);
    busy.current = false;
    if (alive.current && isCurrent()) setIsPending(false);
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <input type="hidden" name="patientId" value={patientId} />
      <input type="hidden" name="collectedAt" value={collectedAt} />
      <input type="hidden" name="requestId" value={requestId} />

      <fieldset disabled={isPending || !editable} className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="collectedLocal" className="block text-sm font-medium text-gray-700">
          Collection date and time
        </label>
        <input
          id="collectedLocal"
          type="datetime-local"
          required
          value={collectedLocal}
          onChange={(event) => {
            setCollectedLocal(event.target.value);
            setSelectedInstant('');
          }}
          aria-describedby="collection-time-help"
          className="w-full rounded-md border border-gray-300 px-3 py-2.5 text-base min-h-[44px] focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        />
        <p id="collection-time-help" className="text-sm text-gray-500">
          Enter the sample collection time in your browser timezone{timeZone ? ` (${timeZone})` : ''}.
          {' '}Convert a source time from another timezone before entering it. Entry time is recorded separately.
        </p>
        {collectedLocal && timeOptions.length === 0 && (
          <p role="alert" className="text-sm text-red-600">
            This collection time does not exist in your browser timezone. Check the source date and time.
          </p>
        )}
        {timeOptions.length > 1 && (
          <div className="space-y-2">
            <p className="text-sm text-amber-700">
              This time occurs twice during the clock change. Select the offset documented by the source.
            </p>
            <label htmlFor="collectionOffset" className="block text-sm font-medium text-gray-700">
              Collection time offset
            </label>
            <select
              id="collectionOffset"
              required
              value={selectedInstant}
              onChange={(event) => setSelectedInstant(event.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2.5 text-base min-h-[44px]"
            >
              <option value="">Select source offset</option>
              {timeOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <label htmlFor="potassium" className="block text-sm font-medium text-gray-700 mb-1">
            K+ (mEq/L)
          </label>
          <input
            id="potassium"
            type="number"
            name="potassium"
            value={values.potassium}
            onChange={(event) => setValues({ ...values, potassium: event.target.value })}
            step="0.1"
            min="1"
            max="10"
            placeholder="e.g. 4.5"
            className="w-full rounded-md border border-gray-300 px-3 py-2.5 text-base min-h-[44px] focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label htmlFor="egfr" className="block text-sm font-medium text-gray-700 mb-1">
            eGFR (mL/min)
          </label>
          <input
            id="egfr"
            type="number"
            name="egfr"
            value={values.egfr}
            onChange={(event) => setValues({ ...values, egfr: event.target.value })}
            step="1"
            min="1"
            max="200"
            placeholder="e.g. 60"
            className="w-full rounded-md border border-gray-300 px-3 py-2.5 text-base min-h-[44px] focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label htmlFor="creatinine" className="block text-sm font-medium text-gray-700 mb-1">
            Cr (mg/dL)
          </label>
          <input
            id="creatinine"
            type="number"
            name="creatinine"
            value={values.creatinine}
            onChange={(event) => setValues({ ...values, creatinine: event.target.value })}
            step="0.01"
            min="0.1"
            max="20"
            placeholder="e.g. 1.2"
            className="w-full rounded-md border border-gray-300 px-3 py-2.5 text-base min-h-[44px] focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label htmlFor="sodium" className="block text-sm font-medium text-gray-700 mb-1">
            Na (mEq/L)
          </label>
          <input
            id="sodium"
            type="number"
            name="sodium"
            value={values.sodium}
            onChange={(event) => setValues({ ...values, sodium: event.target.value })}
            step="0.1"
            min="100"
            max="170"
            placeholder="e.g. 140"
            className="w-full rounded-md border border-gray-300 px-3 py-2.5 text-base min-h-[44px] focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>
      </fieldset>

      {state?.error && editable && !isPending && (
        <p role="alert" className="text-sm text-red-600">{state.error}</p>
      )}

      {isPending && <p role="status" className="text-sm text-gray-600">Saving and checking the recorded outcome. Submission status can be recovered from the server after returning; unsaved form values are not stored in this browser.</p>}

      <button
        type="submit"
        disabled={isPending || !editable || !requestId || (!!collectedLocal && !collectedAt)}
        className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 min-h-[44px]"
      >
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        Save Lab Result
      </button>
    </form>
  );
}

interface PendingEvaluation {
  id: string;
  lab_result_id: string;
  patient_id: string;
  status: string;
  attempt_count: number;
  lab_results: { collected_at: string } | Array<{ collected_at: string }> | null;
}

/** Recovery reads server records only; it never reconstructs or resends an exam. */
function LabSubmissionFlow({ patientId, actorId, isCurrent, onSaved, onPendingChange }: {
  patientId: string; actorId: string; isCurrent: () => boolean;
  onSaved: () => void; onPendingChange: (labId: string | null) => void;
}) {
  const [submission, setSubmission] = useState<LabSubmission | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [freshDraft, setFreshDraft] = useState(false);
  const [editable, setEditable] = useState(false);
  const alive = useRef(true);
  const busy = useRef(false);
  const version = useRef(0);

  const validRow = useCallback((result: LabSubmissionState, exactId?: string) => {
    if (!result.success || result.actorId !== actorId
      || (exactId && result.submission?.requestId !== exactId)) throw new Error('Submission unavailable');
    return result.submission;
  }, [actorId]);

  const accept = useCallback((row: LabSubmission | null) => {
    setSubmission(row);
    setError(false);
    if (row?.status !== 'prepared') { setFreshDraft(false); setEditable(false); }
    onPendingChange(row?.alertStatus === 'pending' ? row.labResultId : null);
    if (row?.labResultId) onSaved();
  }, [onPendingChange, onSaved]);

  useEffect(() => {
    alive.current = true;
    const read = ++version.current;
    const current = () => alive.current && isCurrent() && read === version.current;
    void (async () => {
      try {
        const row = validRow(await getLabSubmission({ patientId }));
        if (current()) accept(row);
      } catch {
        if (current()) setError(true);
      } finally {
        if (current()) setLoading(false);
      }
    })();
    return () => { alive.current = false; version.current += 1; };
  }, [patientId, isCurrent, validRow, accept]);

  const run = async (operation: 'get' | 'prepare' | 'acknowledge' | 'cancel') => {
    if (busy.current || !isCurrent()) return;
    const exactId = operation === 'prepare' ? undefined : submission?.requestId;
    if ((operation === 'acknowledge' || operation === 'cancel') && !exactId) return;
    busy.current = true;
    setLoading(true);
    setError(false);
    const read = ++version.current;
    const current = () => alive.current && isCurrent() && read === version.current;
    try {
      let result: LabSubmissionState;
      if (operation === 'prepare') result = await prepareLabSubmission({ patientId });
      else if (operation === 'acknowledge') result = await acknowledgeLabSubmission({ patientId, requestId: exactId!, labResultId: submission!.labResultId! });
      else if (operation === 'cancel') result = await cancelLabSubmission({ patientId, requestId: exactId! });
      else result = await getLabSubmission({ patientId, ...(exactId ? { requestId: exactId } : {}) });
      const row = validRow(result, exactId);
      if (!current()) return;
      accept(row);
      if (operation === 'prepare') {
        const fresh = row?.status === 'prepared' && row.isNew;
        setFreshDraft(!!fresh);
        setEditable(!!fresh);
      }
    } catch {
      if (!current()) return;
      // An uncertain mutation response gets one read, never an automatic retry.
      if (operation !== 'get') {
        try {
          const row = validRow(await getLabSubmission({ patientId, ...(exactId ? { requestId: exactId } : {}) }), exactId);
          if (!current()) return;
          accept(row);
          if (operation === 'prepare') { setFreshDraft(false); setEditable(false); }
        } catch { if (current()) setError(true); }
      } else setError(true);
    } finally {
      if (current()) { busy.current = false; setLoading(false); }
    }
  };

  const afterSave = async (result: LabActionState) => {
    if (!submission || !isCurrent()) return;
    busy.current = true;
    setLoading(true);
    setEditable(false);
    const read = ++version.current;
    const current = () => alive.current && isCurrent() && read === version.current;
    try {
      const row = validRow(await getLabSubmission({ patientId, requestId: submission.requestId }), submission.requestId);
      if (!current()) return;
      accept(row);
      // Only a known rejected payload and the same still-prepared identity allow editing.
      if (row?.status === 'prepared' && result.status === 'not_saved') setEditable(true);
    } catch { if (current()) setError(true); }
    finally { if (current()) { busy.current = false; setLoading(false); } }
  };

  const active = submission?.status === 'prepared' || submission?.status === 'committed';
  const saved = submission?.status === 'committed' || submission?.status === 'acknowledged';
  const needsRecovery = submission?.status === 'prepared' && (!freshDraft || !editable);
  return (
    <section className="space-y-3" aria-label="Laboratory submission confirmation">
      <button type="button" onClick={() => void run('prepare')} disabled={loading || error || active}
        className="inline-flex items-center gap-2 rounded-md border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 disabled:opacity-50 min-h-[44px]">
        <Plus className="h-4 w-4" /> Add Lab Result
      </button>
      {loading && <p role="status" className="text-sm text-gray-500">Checking submission status…</p>}
      {error && <p role="alert" className="text-sm text-amber-800">Unable to check submission status. An earlier operation may have completed. Recheck before starting another entry.</p>}
      {freshDraft && submission?.status === 'prepared' && <div className="rounded-lg border bg-white p-4">
        <AddLabForm key={submission.requestId} patientId={patientId} requestId={submission.requestId}
          editable={editable && !error} onResult={afterSave} onStart={() => { busy.current = true; setLoading(true); }} isCurrent={isCurrent} />
      </div>}
      {needsRecovery && <div className="rounded-md border border-amber-300 bg-amber-50 p-3 space-y-2">
        <p role="status" className="text-sm font-medium">{freshDraft ? 'Save confirmation is unavailable.' : 'An earlier submission needs confirmation.'}</p>
        <p className="text-sm">The server has a prepared submission, but a saved exam is not yet confirmed. An earlier request may still be in flight. Recheck, or cancel this identity before deliberately starting a new entry. Recovery never resends exam values.</p>
      </div>}
      {saved && submission && <div className="rounded-lg border border-green-300 bg-green-50 p-4 space-y-3">
        <h3 className="text-sm font-semibold">Saved lab receipt</h3>
        <p className="text-sm">Collection (UTC): <time dateTime={submission.collectedAt!}>{collectionUTC(submission.collectedAt!)}</time></p>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          {(['potassium', 'egfr', 'creatinine', 'sodium'] as const).map((key) => {
            const field = LAB_FIELDS.find((item) => item.key === key)!;
            return <div key={key}><dt className="font-medium">{field.label}</dt><dd>{submission[key] === null ? 'Not recorded' : `${submission[key]} ${field.unit}`}</dd></div>;
          })}
        </dl>
        {submission.notes && <p className="text-sm">{submission.notes}</p>}
        <p className="text-sm">Acknowledgment only confirms receipt of this saved record. It does not document clinical review, alert resolution, or notification delivery.</p>
        {submission.status === 'committed' && <button type="button" disabled={loading}
          onClick={() => void run('acknowledge')} className="rounded-md border border-green-700 px-3 py-2 text-sm disabled:opacity-50">Acknowledge saved receipt</button>}
        {submission.status === 'acknowledged' && <p role="status" className="text-sm font-medium">Receipt acknowledged. Start another entry only for a different exam.</p>}
        {submission.alertStatus === 'pending' && submission.labResultId && <PendingLabEvaluation patientId={patientId}
          labResultId={submission.labResultId} collectedAt={submission.collectedAt} isCurrent={isCurrent}
          onResolved={() => { onSaved(); void run('get'); }} />}
      </div>}
      {submission?.status === 'cancelled' && <p role="status" className="text-sm">Submission cancelled. This identity cannot save a late request. No saved lab record was deleted.</p>}
      {(error || needsRecovery || (active && !freshDraft)) && <button type="button" disabled={loading}
        onClick={() => void run('get')} className="rounded-md border border-gray-400 px-3 py-2 text-sm disabled:opacity-50">Recheck submission status</button>}
      {submission?.status === 'prepared' && <button type="button" disabled={loading}
        onClick={() => void run('cancel')} className="rounded-md border border-gray-400 px-3 py-2 text-sm disabled:opacity-50">Cancel this submission</button>}
    </section>
  );
}

function pendingCollection(event: PendingEvaluation): string | null {
  const lab = Array.isArray(event.lab_results) ? event.lab_results[0] : event.lab_results;
  return lab && Number.isFinite(Date.parse(lab.collected_at)) ? lab.collected_at : null;
}

// Auth callbacks invalidate in-flight reads synchronously, before React unmounts the old account.
export function LabResultsTab({ patientId }: { patientId: string }) {
  const [identity, setIdentity] = useState<{ actorId: string; version: number } | null>(null);
  const [authError, setAuthError] = useState(false);
  const authScope = useRef({ actorId: null as string | null, version: 0 });
  useEffect(() => {
    let alive = true;
    const scope = authScope.current;
    const supabase = createClient();
    const verify = async (version: number, expectedActor?: string) => {
      try {
        const { data, error } = await supabase.auth.getUser();
        if (!alive || scope.version !== version) return;
        if (error || !data.user || (expectedActor && data.user.id !== expectedActor)) throw new Error('Session unavailable');
        scope.actorId = data.user.id;
        setIdentity({ actorId: data.user.id, version });
        setAuthError(false);
      } catch {
        if (alive && scope.version === version) {
          scope.actorId = null;
          setIdentity(null);
          setAuthError(true);
        }
      }
    };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const nextActor = session?.user.id ?? null;
      if (event !== 'SIGNED_OUT' && nextActor === scope.actorId) return;
      const version = ++scope.version;
      scope.actorId = null;
      setIdentity(null);
      setAuthError(!nextActor);
      // Avoid awaiting another auth operation inside Supabase's auth callback.
      if (nextActor) void Promise.resolve().then(() => verify(version, nextActor));
    });
    void verify(scope.version);
    return () => { alive = false; scope.version += 1; scope.actorId = null; subscription.unsubscribe(); };
  }, []);
  const isCurrent = useCallback(() => !!identity && authScope.current.actorId === identity.actorId
    && authScope.current.version === identity.version, [identity]);
  if (!identity) return <p role={authError ? 'alert' : 'status'} className="text-sm text-gray-600">
    {authError ? 'Unable to verify your session. Sign in again before viewing lab records.' : 'Verifying your session…'}
  </p>;
  return <PatientLabResults key={`${patientId}:${identity.actorId}:${identity.version}`} patientId={patientId}
    actorId={identity.actorId} isCurrent={isCurrent} />;
}

function PatientLabResults({ patientId, actorId, isCurrent: sessionIsCurrent }: {
  patientId: string; actorId: string; isCurrent: () => boolean;
}) {
  const [labs, setLabs] = useState<LabResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [labsError, setLabsError] = useState(false);
  const [evaluations, setEvaluations] = useState<PendingEvaluation[]>([]);
  const [evaluationsLoading, setEvaluationsLoading] = useState(true);
  const [evaluationsError, setEvaluationsError] = useState(false);
  const [activePendingLabId, setActivePendingLabId] = useState<string | null>(null);
  const alive = useRef(true);
  const readVersion = useRef(0);

  const fetchLabs = useCallback(() => {
    const version = ++readVersion.current;
    const isCurrent = () => alive.current && sessionIsCurrent() && version === readVersion.current;
    const supabase = createClient();
    setEvaluationsLoading(true);
    // A status read failure must not hide successfully loaded laboratory values.
    void (async () => {
      try {
        const { data, error } = await supabase.from('lab_results').select('*')
          .eq('patient_id', patientId).order('collected_at', { ascending: false }).limit(10);
        if (!isCurrent()) return;
        if (error) throw error;
        setLabs(data ?? []);
        setLabsError(false);
      } catch {
        if (isCurrent()) setLabsError(true);
      } finally {
        if (isCurrent()) setLoading(false);
      }
    })();
    void (async () => {
      try {
        const pending: PendingEvaluation[] = [];
        let cursor: string | undefined;
        for (;;) {
          if (!isCurrent()) return;
          let query = supabase.from('lab_alert_evaluations')
            .select('id,lab_result_id,patient_id,status,attempt_count,lab_results(collected_at)')
            .eq('patient_id', patientId).eq('status', 'pending').order('id', { ascending: true });
          if (cursor) query = query.gt('id', cursor);
          const { data, error } = await query.limit(500);
          if (!isCurrent()) return;
          if (error) throw error;
          const page = (data ?? []) as unknown as PendingEvaluation[];
          if (!page.length) break;
          if (page.some((event) => event.patient_id !== patientId || event.status !== 'pending')) throw new Error('Unexpected evaluation scope');
          const next = page[page.length - 1].id;
          if (!next || (cursor && next <= cursor)) throw new Error('Evaluation pagination did not advance');
          pending.push(...page);
          cursor = next;
        }
        setEvaluations(pending);
        setEvaluationsError(false);
      } catch {
        if (isCurrent()) setEvaluationsError(true);
      } finally {
        if (isCurrent()) setEvaluationsLoading(false);
      }
    })();
  }, [patientId, sessionIsCurrent]);

  useEffect(() => {
    alive.current = true;
    fetchLabs();
    return () => { alive.current = false; readVersion.current += 1; };
  }, [fetchLabs]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  // Group fields by category
  const categories = [...new Set(LAB_FIELDS.map(f => f.category))];

  return (
    <div className="space-y-6">
      <LabSubmissionFlow patientId={patientId} actorId={actorId} isCurrent={sessionIsCurrent}
        onSaved={fetchLabs} onPendingChange={setActivePendingLabId} />

      {evaluationsLoading && <p role="status" className="text-sm text-gray-500">Checking saved alert evaluation status…</p>}
      {evaluationsError && <p role="alert" className="text-sm text-amber-800">Unable to load alert evaluation status. Pending evaluations may exist; refresh to check again.</p>}
      {evaluations.filter((event) => event.lab_result_id !== activePendingLabId).map((event) => (
        <PendingLabEvaluation key={event.id} patientId={patientId} labResultId={event.lab_result_id} collectedAt={pendingCollection(event)} isCurrent={sessionIsCurrent} onResolved={() => {
          setEvaluations((current) => current.filter((item) => item.id !== event.id));
          fetchLabs();
        }} />
      ))}
      {labsError && <p role="alert" className="text-sm text-red-700">Unable to load lab results. Previously displayed values may be outdated; refresh to check again.</p>}
      {!labsError && labs.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <FlaskConical className="h-10 w-10 text-gray-300 mb-3" />
          <p className="text-gray-600">No recent lab results recorded</p>
        </div>
      )}

      <p className="text-sm text-gray-500">
        {labs.length} lab result{labs.length !== 1 ? 's' : ''} — most recent first
      </p>

      {categories.map(cat => {
        const fields = LAB_FIELDS.filter(f => f.category === cat);
        // Only show category if at least one lab has data for it
        const hasData = fields.some(f => labs.some(l => l[f.key] !== null));
        if (!hasData) return null;

        return (
          <div key={cat} className="rounded-lg border bg-white overflow-hidden">
            <div className="bg-gray-50 px-4 py-2 border-b">
              <h3 className="text-sm font-semibold text-gray-700">{cat}</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50/50">
                    <th className="text-left px-4 py-2 font-medium text-gray-600 sticky left-0 bg-gray-50/50">Test</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-400 text-xs">Normal</th>
                    {labs.map(l => (
                      <th key={l.id} className="text-left px-3 py-2 font-medium text-gray-600 whitespace-nowrap min-w-[100px]">
                        <time dateTime={l.collected_at}>
                          <span className="block">
                            {new Date(l.collected_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                          </span>
                          <span className="block text-xs font-normal">
                            {new Date(l.collected_at).toLocaleTimeString('en-US', {
                              hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'longOffset',
                            })}
                          </span>
                        </time>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {fields.map(field => (
                    <tr key={field.key} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="px-4 py-2 font-medium text-gray-900 sticky left-0 bg-white whitespace-nowrap">
                        {field.label}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-400 whitespace-nowrap">
                        {field.normalLow}–{field.normalHigh}
                      </td>
                      {labs.map(l => (
                        <td key={l.id} className="px-3 py-2">
                          <ValueCell
                            value={l[field.key] as number | null}
                            unit={field.unit}
                            low={field.normalLow}
                            high={field.normalHigh}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {/* Lab notes */}
      {labs.some(l => l.notes || l.lab_facility) && (
        <div className="rounded-lg border bg-white p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-700">Lab Details</h3>
          {labs.filter(l => l.notes || l.lab_facility).map(l => (
            <div key={l.id} className="text-sm border-b last:border-0 pb-2">
              <p className="font-medium text-gray-900">
                {new Date(l.collected_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                {l.lab_facility && <span className="text-gray-500 font-normal"> — {l.lab_facility}</span>}
              </p>
              {l.notes && <p className="text-gray-600 mt-0.5">{l.notes}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
