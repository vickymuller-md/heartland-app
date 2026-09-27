'use client';

import type { VitalsActionState } from './types';

export function VitalsSubmissionStatus({ state, busy, onRetry, onNew, children }: {
  state: VitalsActionState; busy: boolean; onRetry: () => void; onNew: () => void; children?: React.ReactNode;
}) {
  const evaluated = state.success === true && state.evaluationStatus === 'complete';
  return <section className="space-y-4" aria-label="Saved entry status">
    {children}
    <div className={`rounded-lg border-2 p-6 ${evaluated ? 'border-green-300 bg-green-50' : 'border-amber-300 bg-amber-50'}`}>
      <h2 className="text-xl font-bold">{evaluated ? 'Vitals and Symptoms Saved' : 'Saved — Evaluation Pending'}</h2>
      <p className="mt-2 text-base" role="status">
        {evaluated ? 'The saved measurements have been evaluated.' : 'Your measurements are saved. Do not enter them again. Evaluation has not been confirmed.'}
        {' '}This does not confirm that your care team has received, read or acted on this record.
      </p>
      {state.vitals && <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-base" aria-label="Saved measurements">
        <dt>Recorded</dt><dd><time dateTime={state.vitals.recorded_at}>{state.vitals.recorded_at}</time></dd>
        <dt>Weight</dt><dd>{state.vitals.weight_lbs} lbs</dd>
        <dt>Blood pressure</dt><dd>{state.vitals.sbp}/{state.vitals.dbp} mmHg</dd>
        <dt>Heart rate</dt><dd>{state.vitals.heart_rate} bpm</dd>
        <dt>SpO2</dt><dd>{state.vitals.spo2 === null ? 'Not recorded' : `${state.vitals.spo2}%`}</dd>
      </dl>}
      {state.error && <p role="alert" className="mt-3 text-base">{state.error}</p>}
      {!evaluated && <button type="button" disabled={busy} onClick={onRetry}
        className="mt-4 min-h-[48px] rounded-lg bg-amber-800 px-6 py-3 text-base font-semibold text-white disabled:opacity-50">
        {busy ? 'Checking...' : 'Retry Evaluation'}
      </button>}
      {!evaluated && <p className="mt-3 text-base">You may acknowledge this saved record to enter another reading. This does not complete its evaluation; it remains in Pending Evaluations.</p>}
      <button type="button" disabled={busy} onClick={onNew}
        className="mt-4 min-h-[48px] rounded-lg bg-blue-600 px-6 py-3 text-base font-semibold text-white disabled:opacity-50">
        {busy ? 'Confirming...' : evaluated ? 'Log Another Entry' : 'Acknowledge Saved Record and Start Another Entry'}
      </button>
    </div>
  </section>;
}
