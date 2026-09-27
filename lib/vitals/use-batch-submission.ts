'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { acknowledgeVitalsBatch, cancelVitalsBatch, prepareVitalsBatch, recoverVitalsBatch, submitCapturedVitalsBatch } from './batch-actions';
import { mergeRecoveredVitals } from './recovery-state';
import type { BatchVitalsActionState } from './types';

export function mergeRecoveredBatch(previous: BatchVitalsActionState, result: BatchVitalsActionState): BatchVitalsActionState {
  if (result.errorKind === 'access' || result.activeIndividual) return result;
  if (previous.batchId && !result.batchId && result.error) return { ...previous, error: result.error, errorKind: result.errorKind };
  if (previous.saved && !result.saved && result.error && (!result.batchId || result.batchId === previous.batchId)) return { ...previous, error: result.error };
  if (result.batchId !== previous.batchId || !result.results) return result;
  return { ...result, results: result.results.map((row) => {
    const old = previous.results?.find((entry) => entry.receipt?.requestId && entry.receipt.requestId === row.receipt?.requestId);
    if (!old?.receipt || !row.receipt) return row;
    const receipt = mergeRecoveredVitals(old.receipt, row.receipt, row.receipt.requestId);
    return { ...row, receipt, redFlags: receipt.redFlags ?? [], error: receipt.error };
  }) };
}

export function useVitalsBatch(patientId: string) {
  const [state, setState] = useState<BatchVitalsActionState>({});
  const [busy, setBusy] = useState(true);
  const [ready, setReady] = useState(false);
  const [entryDate, setEntryDate] = useState(() => new Date());
  const [entryGeneration, setEntryGeneration] = useState(0);
  const generation = useRef(0);
  const inFlight = useRef(false);
  useEffect(() => {
    const epoch = ++generation.current;
    setState({}); setReady(false); setBusy(true); setEntryDate(new Date()); inFlight.current = true;
    void recoverVitalsBatch(patientId).then((result) => {
      if (generation.current !== epoch) return;
      setState(result); setReady(!result.error || Boolean(result.saved));
    }).catch(() => {
      if (generation.current === epoch) setState({ error: 'Could not check the saved batch. Reconnect and retry.' });
    }).finally(() => {
      if (generation.current === epoch) { setBusy(false); inFlight.current = false; }
    });
    return () => { generation.current += 1; };
  }, [patientId]);

  const run = useCallback(async (operation: 'recover' | 'submit' | 'ack' | 'cancel', formData?: FormData) => {
    if (inFlight.current || (operation === 'submit' && (!ready || state.saved))) return;
    const epoch = generation.current;
    inFlight.current = true; setBusy(true);
    let batchId = state.batchId;
    let current = state;
    try {
      let result: BatchVitalsActionState;
      if (operation === 'submit') {
        if (!batchId) {
          const prepared = await prepareVitalsBatch(patientId);
          if (epoch !== generation.current) return;
          batchId = prepared.batchId;
          if (prepared.saved || !batchId || prepared.submissionStatus !== 'prepared') {
            setState(prepared.saved ? { ...prepared, error: 'An existing saved batch was recovered. The current form values were not saved.' } : prepared);
            setReady(!prepared.error || Boolean(prepared.saved)); return;
          }
          current = prepared;
          setState(prepared);
        }
        if (!formData) return;
        formData.set('patientId', patientId); formData.set('batchId', batchId);
        result = await submitCapturedVitalsBatch(null, formData);
      } else if (operation === 'ack') {
        if (!batchId || !state.saved) return;
        const ids = state.results?.flatMap((row) => row.receipt?.requestId ? [row.receipt.requestId] : []) ?? [];
        result = await acknowledgeVitalsBatch(patientId, batchId, ids);
      } else if (operation === 'cancel') {
        if (!batchId || state.saved) return;
        result = await cancelVitalsBatch(patientId, batchId);
      } else result = await recoverVitalsBatch(patientId, batchId);
      if (epoch !== generation.current) return;
      if ((operation === 'ack' && result.submissionStatus === 'acknowledged')
        || result.submissionStatus === 'cancelled') {
        setState({}); setReady(true); setEntryDate(new Date()); setEntryGeneration((value) => value + 1);
      }
      else {
        const next = mergeRecoveredBatch(current, result);
        setState(next);
        setReady(!next.error || Boolean(next.saved) || (operation === 'submit' && !next.errorKind && Boolean(next.batchId)));
      }
    } catch {
      if (epoch === generation.current) setState((previous) => ({ ...previous, batchId,
        error: 'The result could not be confirmed. Check the saved batch before entering another copy.' }));
    } finally { if (epoch === generation.current) { setBusy(false); inFlight.current = false; } }
  }, [patientId, ready, state]);
  return { state, busy, ready, entryDate, entryGeneration, submit: (data: FormData) => run('submit', data),
    recover: () => run('recover'), startNew: () => run('ack'), cancel: () => run('cancel') };
}
