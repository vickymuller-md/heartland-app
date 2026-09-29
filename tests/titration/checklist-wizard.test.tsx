import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { selectChecklistLabs } from '@/lib/integration/patient-selection';
import type { SelectedPatientData } from '@/lib/integration/patient-selection';
import type { EffectiveLabObservation } from '@/lib/labs/effective';

const mocks = vi.hoisted(() => ({
  actor: '72000000-0000-4000-8000-000000000001', getUser: vi.fn(), saved: vi.fn(), success: vi.fn(), error: vi.fn(),
  selected: null as unknown, second: null as unknown, selectorProps: null as unknown,
  printed: vi.fn(), cloneStarted: vi.fn(), resourceGate: null as Promise<void> | null,
  listeners: new Set<(event: string, session: { user: { id: string } } | null) => void>(),
}));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: {
  getUser: mocks.getUser, onAuthStateChange: (listener: (event: string, session: { user: { id: string } } | null) => void) => {
    mocks.listeners.add(listener); return { data: { subscription: { unsubscribe: () => mocks.listeners.delete(listener) } } };
  },
} }) }));
vi.mock('@/components/shared/patient-selector', () => ({ PatientSelector: (props: {
  selectedPatient: { full_name: string } | null; onSelect: (value: unknown) => void; onClear: () => void;
}) => {
  mocks.selectorProps = props;
  return <div>{props.selectedPatient && <p>{props.selectedPatient.full_name}</p>}
    <button type="button" onClick={() => props.onSelect(mocks.selected)}>Import synthetic one</button>
    <button type="button" onClick={() => props.onSelect(mocks.second)}>Import synthetic two</button>
    <button type="button" onClick={props.onClear}>Clear linked patient</button>
  </div>;
} }));
vi.mock('@/lib/integration/actions', () => ({ saveTitrationNote: mocks.saved }));
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error } }));
vi.mock('@/components/ai/explain-result-button', () => ({ ExplainResultButton: () => null }));
vi.mock('react-to-print', () => ({ useReactToPrint: (options: {
  contentRef?: { current: HTMLElement | null }; onBeforePrint?: () => Promise<void>; print?: (frame: HTMLIFrameElement) => Promise<void>;
}) => (getContent?: () => HTMLElement | null) => {
  void (async () => {
    let frame: HTMLIFrameElement | null = null;
    try {
      await options.onBeforePrint?.();
      const source = getContent?.() ?? options.contentRef?.current;
      if (!source) return;
      frame = document.createElement('iframe'); frame.id = 'printWindow'; document.body.append(frame);
      frame.contentDocument!.body.append(source.cloneNode(true));
      Object.defineProperty(frame.contentWindow, 'focus', { value: vi.fn() });
      Object.defineProperty(frame.contentWindow, 'print', { value: () => mocks.printed(frame?.contentDocument?.body.textContent) });
      mocks.cloneStarted(); frame.dispatchEvent(new Event('load'));
      if (mocks.resourceGate) await mocks.resourceGate;
      if (options.print) await options.print(frame); else mocks.printed(source.textContent);
    } catch { /* An invalidated print must not escape as an unhandled rejection. */ }
    finally { frame?.remove(); }
  })();
} }));
import { ChecklistWizard } from '@/app/(public)/titration-checklist/checklist-wizard';
const actor = '72000000-0000-4000-8000-000000000001';
const id = (n: number) => '72000000-0000-4000-8000-' + n.toString(16).padStart(12, '0');
function selected(patientId = id(2)): SelectedPatientData {
  const labs = (['potassium', 'creatinine', 'egfr'] as const).map((analyte, i): EffectiveLabObservation => ({
    id: id(i + 10) + ':' + analyte, patient_id: patientId, original_lab_result_id: id(i + 10), analyte,
    root_id: null, version_id: null, revision: null, status: 'original', effective_lab_result_id: id(i + 10),
    value: ['4.200', '1.100', '65'][i], collected_at: ['2025-01-01T12:00:00.000001Z', '2025-01-10T12:00:00Z', '2025-01-20T12:00:00Z'][i],
    notes: null, lab_facility: null, evaluation_status: 'pending',
  }));
  return {
    patient: { id: patientId, full_name: patientId === id(2) ? 'Synthetic One' : 'Synthetic Two', email: null, phone: null, patient_code: 'SYN001', risk_tier: 'low' },
    actorId: actor, latestVitals: { id: id(4), patient_id: patientId, weight_lbs: null, sbp: 120, dbp: 70, heart_rate: 70, spo2: null, recorded_at: '2025-01-21T12:00:00Z' },
    laboratorySnapshots: selectChecklistLabs(labs, patientId, new Date('2026-09-29T12:00:00Z')),
    sourceReadAt: '2026-09-29T12:00:00Z',
    medications: [{ id: id(30), patient_id: patientId, name: 'Lisinopril', dosage: '10mg', frequency: 'daily' },
      { id: id(31), patient_id: patientId, name: 'Sacubitril/valsartan', dosage: '24/26mg', frequency: 'twice daily' }],
  };
}
function deferred<T = void>() { let resolve!: (value: T) => void; return { promise: new Promise<T>((done) => { resolve = done; }), resolve: (value: T) => resolve(value) }; }
function authResult(value = mocks.actor) { return { data: { user: { id: value } }, error: null }; }
function switchActor(value: string | null) {
  mocks.actor = value ?? '';
  mocks.listeners.forEach((listener) => listener(value ? 'SIGNED_IN' : 'SIGNED_OUT', value ? { user: { id: value } } : null));
}
const props = { clinicalIntegrationEnabled: true, expectedProviderId: actor, contextId: 'source-context-1' };
async function importOne() { fireEvent.click(await screen.findByRole('button', { name: 'Import synthetic one' })); }
async function next(heading: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByRole('heading', { name: heading, exact: true });
}
async function finalStep() {
  await next('Medication Review'); await next('Safety Gate Check'); await next('Titration Decision');
  fireEvent.click(screen.getByRole('button', { name: 'UPTITRATE', exact: true }));
  fireEvent.change(screen.getByLabelText('Provider Decision Notes'), { target: { value: 'Synthetic decision context' } });
  await next('Plan & Follow-Up');
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.actor = actor; mocks.selected = selected(); mocks.second = selected(id(3));
  mocks.getUser.mockReset().mockImplementation(async () => authResult());
  mocks.saved.mockReset().mockResolvedValue({ success: true, outcome: 'saved' }); mocks.resourceGate = null;
});
afterEach(cleanup);
describe('checklist effective imports and complete form lifetime', () => {
  it('keeps the manual public tool usable with no patient reads or saves', async () => {
    render(<ChecklistWizard />);
    expect(screen.queryByRole('button', { name: /Import/ })).toBeNull(); expect(mocks.getUser).not.toHaveBeenCalled();
    for (const [label, value] of [['Systolic BP (mmHg)', '120'], ['Heart Rate (bpm)', '70'], ['Potassium (mEq/L)', '4.2'], ['Creatinine (mg/dL)', '1.1'], ['eGFR (mL/min/1.73m²)', '65']]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    await finalStep();
    expect(screen.queryByRole('button', { name: /Save Draft/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Export Checklist as PDF' }));
    await waitFor(() => expect(mocks.printed).toHaveBeenCalledOnce()); expect(mocks.saved).not.toHaveBeenCalled();
  });
  it('connects existing validation instead of evaluating blank inputs as zeros', async () => {
    render(<ChecklistWizard />);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('SBP is required');
    expect(screen.getByRole('heading', { name: 'Pre-Call Vitals' })).toBeInTheDocument();
    expect(screen.queryByTestId('print-layout')).toBeNull(); expect(screen.queryByText('PASS')).toBeNull();
  });
  it('imports each source separately and shows independent collection dates/advisories', async () => {
    render(<ChecklistWizard {...props} />); await importOne();
    expect(screen.getByLabelText('Potassium (mEq/L)')).toHaveValue(4.2);
    expect(screen.getByLabelText('Creatinine (mg/dL)')).toHaveValue(1.1);
    expect(screen.getByRole('region', { name: 'Imported laboratory sources' })).toHaveTextContent('2025-01-01T12:00:00.000001Z');
    expect(screen.getByRole('region', { name: 'Imported laboratory sources' })).toHaveTextContent('2025-01-10T12:00:00.000Z');
    expect(screen.getAllByText(/Outside the legacy checklist advisory/)).toHaveLength(3);
    expect(mocks.selectorProps).toMatchObject({ expectedActorId: actor, includeLaboratories: true });
  });
  it('clears all numeric inputs and other patient data on selection of an empty-source patient', async () => {
    const empty = selected(id(3)); empty.latestVitals = null; empty.medications = []; empty.laboratorySnapshots = selectChecklistLabs([], id(3));
    mocks.second = empty;
    render(<ChecklistWizard {...props} />); await importOne();
    fireEvent.change(screen.getByLabelText('Baseline Creatinine (mg/dL)'), { target: { value: '0.9' } });
    fireEvent.change(screen.getByLabelText('Symptoms Reported by Patient (optional)'), { target: { value: 'OLD SYMPTOM' } });
    await finalStep();
    fireEvent.change(screen.getByLabelText('Follow-Up Notes'), { target: { value: 'OLD FOLLOWUP' } });
    fireEvent.change(screen.getByLabelText('Next Call Date'), { target: { value: '2026-10-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import synthetic two' }));
    expect(screen.getByRole('heading', { name: 'Pre-Call Vitals' })).toBeInTheDocument();
    for (const label of ['Systolic BP (mmHg)', 'Heart Rate (bpm)', 'Potassium (mEq/L)', 'Creatinine (mg/dL)', 'Baseline Creatinine (mg/dL)', 'eGFR (mL/min/1.73m²)']) {
      expect(screen.getByLabelText(label)).toHaveValue(null);
    }
    expect(screen.getByLabelText('Symptoms Reported by Patient (optional)')).toHaveValue('');
    expect(document.body).not.toHaveTextContent('Synthetic One'); expect(screen.queryByTestId('print-layout')).toBeNull();
    expect(document.body).not.toHaveTextContent('OLD FOLLOWUP'); expect(document.body).not.toHaveTextContent('Synthetic decision context');
  });
  it.each([id(2), id(3)])('clears withheld prefill for refreshed/replaced patient %s rather than retaining the old DOM value', async (target) => {
    const second = selected(target); const observation = second.laboratorySnapshots!.potassium.observation!;
    second.laboratorySnapshots = selectChecklistLabs([{ ...observation, value: '4.20000000000000001' }], target);
    mocks.second = second;
    render(<ChecklistWizard {...props} />); await importOne(); fireEvent.click(screen.getByRole('button', { name: 'Import synthetic two' }));
    expect(screen.getByLabelText('Potassium (mEq/L)')).toHaveValue(null); expect(screen.getByLabelText('Creatinine (mg/dL)')).toHaveValue(null);
    expect(screen.getByRole('region', { name: 'Imported laboratory sources' })).toHaveTextContent('4.20000000000000001');
    expect(screen.getByText(/Automatic prefill withheld/)).toBeInTheDocument();
  });
  it('clearing selection removes the imported medication warning and the whole draft', async () => {
    render(<ChecklistWizard {...props} />); await importOne(); await next('Medication Review');
    expect(screen.getByText('ACEi-to-ARNI Washout Required')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear linked patient' }));
    expect(screen.queryByText('ACEi-to-ARNI Washout Required')).toBeNull(); expect(screen.getByLabelText('Potassium (mEq/L)')).toHaveValue(null);
  });
  it.each(['logout', 'A-B-A', 'context'])('removes linked values and print content after %s', async (kind) => {
    const view = render(<ChecklistWizard {...props} />); await importOne(); await finalStep();
    expect(screen.getByTestId('print-layout')).toHaveTextContent('Synthetic One');
    if (kind === 'context') view.rerender(<ChecklistWizard {...props} contextId="source-context-2" />);
    else act(() => { switchActor(kind === 'logout' ? null : id(99)); if (kind === 'A-B-A') switchActor(actor); });
    expect(screen.queryByTestId('print-layout')).toBeNull(); expect(document.body).not.toHaveTextContent('Synthetic One');
    if (kind !== 'context') expect(screen.getByRole('alert')).toHaveTextContent('session changed');
  });
  it('exports source snapshots separately from the manually edited value', async () => {
    render(<ChecklistWizard {...props} />); await importOne();
    fireEvent.change(screen.getByLabelText('Potassium (mEq/L)'), { target: { value: '4.3' } });
    await finalStep(); fireEvent.click(screen.getByRole('button', { name: 'Export Checklist as PDF' }));
    await waitFor(() => expect(mocks.printed).toHaveBeenCalledOnce());
    const text = mocks.printed.mock.calls[0][0]; expect(text).toContain('form value 4.3'); expect(text).toContain('4.200 mEq/L');
    expect(text).toContain('client-declared snapshots'); expect(text).toContain('not server-verified current revisions');
  });
  it.each(['edit', 'account', 'clear'])('invalidates an owned print clone during resource loading after %s', async (kind) => {
    const gate = deferred(); mocks.resourceGate = gate.promise;
    render(<ChecklistWizard {...props} />); await importOne(); await finalStep();
    fireEvent.click(screen.getByRole('button', { name: 'Export Checklist as PDF' }));
    await waitFor(() => expect(mocks.cloneStarted).toHaveBeenCalledOnce());
    if (kind === 'edit') fireEvent.change(screen.getByLabelText('Follow-Up Notes'), { target: { value: 'Edited during print' } });
    if (kind === 'clear') fireEvent.click(screen.getByRole('button', { name: 'Clear linked patient' }));
    if (kind === 'account') act(() => switchActor(id(99)));
    await waitFor(() => expect(document.getElementById('printWindow')).toBeNull());
    expect(mocks.printed).not.toHaveBeenCalled();
    await act(async () => gate.resolve());
    expect(mocks.printed).not.toHaveBeenCalled(); expect(document.getElementById('printWindow')).toBeNull();
  });
  it('requires explicit draft decision before enabling final export or save', async () => {
    render(<ChecklistWizard {...props} />); await importOne();
    await next('Medication Review'); await next('Safety Gate Check'); await next('Titration Decision');
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled(); expect(screen.queryByTestId('print-layout')).toBeNull();
  });
  it('submits expected actor and declared snapshots, and blocks a duplicate unchanged save', async () => {
    render(<ChecklistWizard {...props} />); await importOne(); await finalStep();
    fireEvent.click(screen.getByRole('button', { name: /Save Draft Note/ }));
    await waitFor(() => expect(mocks.saved).toHaveBeenCalledOnce());
    expect(mocks.saved).toHaveBeenCalledWith(id(2), expect.objectContaining({ laboratorySnapshots: expect.any(Object), sourceReadAt: '2026-09-29T12:00:00Z' }), actor);
    await waitFor(() => expect(mocks.success).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', { name: /Save Draft Note/ })).toBeDisabled();
  });
  it.each(['returned-unknown', 'lost-response'])('locks the form after %s without a blind retry', async (kind) => {
    if (kind === 'returned-unknown') mocks.saved.mockResolvedValue({ success: false, outcome: 'unknown' });
    else mocks.saved.mockRejectedValue(new Error('Network lost'));
    render(<ChecklistWizard {...props} />); await importOne(); await finalStep();
    fireEvent.click(screen.getByRole('button', { name: /Save Draft Note/ }));
    await screen.findByText(/This form is locked against another submission/);
    expect(screen.getByRole('button', { name: /Save Draft Note/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear linked patient' })).toBeDisabled();
    expect(mocks.saved).toHaveBeenCalledOnce();
  });
  it('does not attribute a late save response after account change to a new session', async () => {
    const gate = deferred<{ success: boolean; outcome: string }>(); mocks.saved.mockReturnValue(gate.promise);
    render(<ChecklistWizard {...props} />); await importOne(); await finalStep();
    fireEvent.click(screen.getByRole('button', { name: /Save Draft Note/ }));
    await waitFor(() => expect(mocks.saved).toHaveBeenCalledOnce());
    act(() => switchActor(id(99))); await act(async () => gate.resolve({ success: true, outcome: 'saved' }));
    expect(mocks.success).not.toHaveBeenCalled(); expect(screen.getByRole('alert')).toHaveTextContent('session changed');
  });
  it('keeps StrictMode initialization functional', async () => {
    render(<StrictMode><ChecklistWizard {...props} /></StrictMode>); await importOne();
    expect(screen.getByLabelText('Potassium (mEq/L)')).toHaveValue(4.2);
    expect(within(screen.getByRole('region', { name: 'Imported laboratory sources' })).getByText('Potassium: available')).toBeInTheDocument();
  });
});
