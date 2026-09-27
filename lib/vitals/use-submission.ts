'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { acknowledgeVitalsSubmission, cancelVitalsSubmission, prepareVitalsSubmission, recoverVitalsSubmission,
  submitCapturedProviderVitals, submitCapturedVitals } from './submission-actions';
import type { VitalsActionState } from './types';
import { mergeRecoveredVitals } from './recovery-state';

/** No source values or identifiers are stored in browser persistence. Reload
 * resolves the active server-owned slot before another write is enabled. */
export function useVitalsSubmission(patientId?: string) {
  const [state, setState] = useState<VitalsActionState>({});
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const inFlight = useRef(false);
  const generation = useRef(0);

  useEffect(() => {
    let active = true;
    generation.current += 1;
    inFlight.current = false;
    setReady(false);
    setState({});
    setBusy(true);
    void recoverVitalsSubmission(patientId).then((result) => {
      if (!active) return;
      setState(result);
      setReady(!result.error || Boolean(result.saved));
    }).catch(() => {
      if (active) setState({ error: 'Could not check the saved record. Reconnect and retry.' });
    }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; generation.current += 1; };
  }, [patientId]);

  const recover = useCallback(async () => {
    if (inFlight.current) return;
    const epoch = generation.current;
    inFlight.current = true;
    setBusy(true);
    try {
      const result = await recoverVitalsSubmission(patientId, state.requestId);
      if (epoch !== generation.current) return;
      if (result.submissionStatus === 'cancelled') { setState({}); setReady(true); return; }
      const next = mergeRecoveredVitals(state, result, state.requestId);
      setState(next);
      setReady(!next.error || Boolean(next.saved));
    } catch {
      if (epoch === generation.current) setState((previous) => ({ ...previous,
        error: 'Could not check the saved record. Reconnect and retry.' }));
    } finally {
      if (epoch === generation.current) { inFlight.current = false; setBusy(false); }
    }
  }, [patientId, state]);

  const submit = useCallback(async (formData: FormData) => {
    if (!ready || inFlight.current || state.saved) return;
    const epoch = generation.current;
    inFlight.current = true;
    setBusy(true);
    let requestId = state.requestId;
    try {
      if (!requestId) {
        const prepared = await prepareVitalsSubmission(patientId);
        if (epoch !== generation.current) return;
        setState(prepared.saved ? { ...prepared,
          error: 'An existing saved entry was recovered. The values in your current form were not saved. Review the saved measurements below before starting another entry.' } : prepared);
        if (prepared.saved || !prepared.requestId || prepared.submissionStatus !== 'prepared') return;
        requestId = prepared.requestId;
      }
      formData.set('requestId', requestId);
      if (patientId) formData.set('patientId', patientId);
      const result = await (patientId ? submitCapturedProviderVitals : submitCapturedVitals)(null, formData);
      if (epoch === generation.current) setState(result);
    } catch {
      if (epoch === generation.current) setState((previous) => ({ ...previous, requestId,
        error: 'Save could not be confirmed. Check the saved record before entering it again.' }));
    } finally {
      if (epoch === generation.current) { inFlight.current = false; setBusy(false); }
    }
  }, [patientId, ready, state.requestId, state.saved]);

  const startNew = useCallback(async () => {
    if (inFlight.current || !state.requestId || !state.vitals || !state.symptomsId || !state.saved) return;
    const epoch = generation.current;
    inFlight.current = true;
    setBusy(true);
    try {
      const result = await acknowledgeVitalsSubmission(state.requestId, state.vitals.id, state.symptomsId, patientId);
      if (epoch !== generation.current) return;
      if (result.submissionStatus === 'acknowledged') { setState({}); setReady(true); }
      else setState((previous) => ({ ...previous, error: result.error ?? 'Receipt confirmation is pending.' }));
    } catch {
      if (epoch === generation.current) setState((previous) => ({ ...previous,
        error: 'Receipt confirmation is pending. Retry before starting another entry.' }));
    } finally {
      if (epoch === generation.current) { inFlight.current = false; setBusy(false); }
    }
  }, [patientId, state]);

  const cancel = useCallback(async () => {
    if (inFlight.current || state.saved || !state.requestId) return;
    const epoch = generation.current;
    inFlight.current = true; setBusy(true);
    try {
      const result = await cancelVitalsSubmission(state.requestId, patientId);
      if (epoch !== generation.current) return;
      if (result.submissionStatus === 'cancelled') { setState({}); setReady(true); }
      else {
        setState(result.requestId || result.errorKind === 'access' ? result : { ...state, error: result.error });
        setReady(Boolean(result.saved));
      }
    } catch {
      if (epoch === generation.current) setState({ ...state, error: 'Cancellation is not confirmed. Check the saved record before switching modes.' });
    } finally { if (epoch === generation.current) { inFlight.current = false; setBusy(false); } }
  }, [patientId, state]);

  return { state, busy, ready, submit, recover, startNew, cancel };
}
