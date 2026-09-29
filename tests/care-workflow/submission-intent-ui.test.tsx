import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ attempt: vi.fn(), get: vi.fn(), ack: vi.fn(), cancelAttempt: vi.fn(), save: vi.fn(),
  prepare: vi.fn(), recover: vi.fn(), cancel: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn(), block: vi.fn(), close: vi.fn() }));
vi.mock('@/lib/dashboard/actions', () => ({ prepareCareLabSubmission: mocks.attempt, getCareLabSubmission: mocks.get,
  acknowledgeCareLabSubmission: mocks.ack, cancelCareLabSubmission: mocks.cancelAttempt, saveCareLabResult: mocks.save, saveLabResult: vi.fn() }));
vi.mock('@/lib/care-workflow/submission-intent-actions', () => ({ prepareSubmissionIntent: mocks.prepare, recoverSubmissionIntent: mocks.recover, cancelSubmissionIntent: mocks.cancel }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { onAuthStateChange: mocks.subscribe } }) }));
import { CareLabSave } from '@/app/(provider)/patients/[patientId]/_components/care-lab-save';
import type { CareWorkflowDetail } from '@/lib/care-workflow/step-types';
import type { SubmissionIntentInput, SubmissionIntentState } from '@/lib/care-workflow/submission-intent-types';
import type { LabSubmission } from '@/lib/dashboard/actions';
const id = (n: number) => `67000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = '2026-09-01T12:00:00Z'; const scope = { actor_id: id(1), organization_id: id(90), patient_id: id(11) };
const input: SubmissionIntentInput = { ...scope, intent_id: id(200), work_item_id: id(100), submission_request_id: id(300), expected_revision: '1', expected_ownership_revision: '7',
  payload: { analytes: ['potassium', 'egfr'], evidence: 'Original intention evidence', occurred_at: at } };
const detail = { requested_analytes: ['potassium', 'egfr', 'bnp'], revision: '1', ownership_revision: '7' } as CareWorkflowDetail;
const props = { scope, workId: id(100), detail, initial: null, mayStart: true, onBlock: mocks.block, onClose: mocks.close };
function intention(value = input, saved = false): SubmissionIntentState {
  return { ...value, state: 'prepared', recorded_at: at, cancelled_at: null, reconciled_at: null, reconciliation: null,
    result_linked: false, clinical_review_recorded: false, care_completed: false,
    submission: { status: saved ? 'saved_not_linked' : 'awaiting_save', lab_result_id: saved ? id(400) : null, event_id: saved ? id(500) : null,
      evaluation_status: saved ? 'pending' : null, saved_at: saved ? at : null, acknowledged_at: null,
      recorded_analytes: saved ? ['potassium'] : [], missing_analytes: saved ? ['egfr'] : value.payload.analytes } };
}
function attempt(status: LabSubmission['status'] = 'prepared', isNew = true) {
  return { success: true, actorId: scope.actor_id, submission: { requestId: id(300), status, isNew,
    labResultId: status === 'committed' || status === 'acknowledged' ? id(400) : null, eventId: null, alertStatus: null,
    collectedAt: null, potassium: null, egfr: null, creatinine: null, sodium: null, notes: null } };
}
const ok = (data: unknown) => ({ data, error: null });
function deferred() { let resolve!: (value: unknown) => void; let reject!: (error: Error) => void;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeEach(() => {
  vi.resetAllMocks(); vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-29T13:00:00Z'));
  mocks.subscribe.mockReturnValue({ data: { subscription: { unsubscribe: mocks.unsubscribe } } });
  mocks.attempt.mockResolvedValue(attempt()); mocks.get.mockResolvedValue(attempt('committed', false)); mocks.ack.mockResolvedValue(attempt('acknowledged', false));
  mocks.prepare.mockImplementation(async (value) => ok(intention(value))); mocks.recover.mockImplementation(async (value) => ok(intention(value, true)));
  mocks.cancel.mockImplementation(async (value) => ok({ ...intention(value), state: 'cancelled', cancelled_at: at, submission: { ...intention(value).submission, status: 'submission_cancelled' } }));
  mocks.save.mockResolvedValue({ status: 'saved_alert_pending', success: true, labResultId: id(400), eventId: id(500) });
  mocks.cancelAttempt.mockResolvedValue(attempt('cancelled', false));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function change(label: string | RegExp, value: string) { fireEvent.change(screen.getByLabelText(label), { target: { value } }); }
function fillIntention() {
  fireEvent.click(screen.getByRole('checkbox', { name: 'Potassium' })); fireEvent.click(screen.getByRole('checkbox', { name: 'eGFR' }));
  change('Intention evidence', input.payload.evidence); change('Intention occurred at (UTC)', '2026-09-01T12:00');
}
function submitIntention() { fireEvent.submit(screen.getByRole('form', { name: 'New follow-up lab intention' })); }
async function fresh() { render(<CareLabSave {...props} />); fillIntention(); submitIntention(); await screen.findByLabelText('Collection date and time'); }
function submitValues() {
  change('Collection date and time', '2026-09-01T12:00'); change('K+ (mEq/L)', '4.6');
  fireEvent.submit(screen.getByLabelText('Collection date and time').closest('form')!);
}
describe('care-linked laboratory value entry', () => {
  it('does not read or mutate automatically; records intent before exposing values', async () => {
    const gate = deferred(); mocks.prepare.mockReturnValueOnce(gate.promise);
    render(<CareLabSave {...props} />); expect(mocks.attempt).not.toHaveBeenCalled(); expect(screen.queryByLabelText('Collection date and time')).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'BNP' })).toBeNull(); fillIntention(); submitIntention();
    await waitFor(() => expect(mocks.prepare).toHaveBeenCalledOnce()); expect(screen.queryByLabelText('Collection date and time')).toBeNull();
    const frozen = mocks.prepare.mock.calls[0][0];
    expect(frozen).toMatchObject({ ...scope, work_item_id: id(100), submission_request_id: id(300), expected_revision: '1', expected_ownership_revision: '7', payload: input.payload });
    await act(async () => gate.resolve(ok(intention(frozen)))); expect(screen.getByLabelText('Collection date and time')).not.toBeDisabled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('validates meaningful intent before preparing an attempt or generating a UUID', () => {
    render(<CareLabSave {...props} />); fillIntention(); change('Intention evidence', ' '); const uuid = vi.spyOn(crypto, 'randomUUID'); submitIntention();
    expect(screen.getByRole('alert')).toHaveTextContent('Select supported'); expect(mocks.attempt).not.toHaveBeenCalled(); expect(uuid).not.toHaveBeenCalled();
  });
  it('never binds an existing prepared attempt or recreates its value form', async () => {
    mocks.attempt.mockResolvedValue(attempt('prepared', false)); render(<CareLabSave {...props} />); fillIntention(); submitIntention();
    await screen.findByText(/An existing attempt must be recovered/); expect(mocks.prepare).not.toHaveBeenCalled(); expect(screen.queryByLabelText('Collection date and time')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel recovered unbound attempt' }));
    await screen.findByRole('button', { name: 'Return to source association' });
    expect(mocks.cancelAttempt).toHaveBeenCalledExactlyOnceWith({ actorId: scope.actor_id, patientId: scope.patient_id, requestId: id(300) });
  });
  it('recovers an ambiguous attempt without preparing a replacement', async () => {
    mocks.attempt.mockRejectedValue(new Error('offline')); render(<CareLabSave {...props} />); fillIntention(); submitIntention();
    await screen.findByRole('alert'); mocks.get.mockResolvedValueOnce(attempt('prepared', false));
    fireEvent.click(screen.getByRole('button', { name: 'Check exact lab submission' })); await screen.findByText(/Exact lab attempt: prepared/);
    expect(mocks.attempt).toHaveBeenCalledOnce(); expect(mocks.prepare).not.toHaveBeenCalled(); expect(screen.queryByLabelText('Collection date and time')).toBeNull();
  });
  it('retries lost intention preparation with the same frozen identities and payload', async () => {
    mocks.prepare.mockRejectedValueOnce(new Error('offline')); render(<CareLabSave {...props} />); fillIntention(); submitIntention();
    await screen.findByRole('alert'); const frozen = mocks.prepare.mock.calls[0][0];
    fireEvent.click(screen.getByRole('button', { name: 'Retry same intention preparation' })); await screen.findByLabelText('Collection date and time');
    expect(mocks.prepare).toHaveBeenNthCalledWith(2, frozen); expect(mocks.attempt).toHaveBeenCalledOnce(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it('escapes a rejected intention preparation by cancelling only the exact attempt and returning to recovery, not assuming absence', async () => {
    mocks.prepare.mockResolvedValueOnce({ data: null, error: '40001' }); mocks.recover.mockResolvedValue({ data: null, error: '42501' });
    render(<CareLabSave {...props} />); fillIntention(); submitIntention(); await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel exact attempt and check intention' }));
    await screen.findByRole('button', { name: 'Return to recovery lists' });
    expect(mocks.cancelAttempt).toHaveBeenCalledExactlyOnceWith({ actorId: scope.actor_id, patientId: scope.patient_id, requestId: id(300) });
    expect(screen.getByText(/Intention status remains unconfirmed/)).toBeInTheDocument(); expect(mocks.cancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Return to recovery lists' })); expect(mocks.close).toHaveBeenCalledOnce();
  });
  it('reconciles a prepared intention after its exact raw attempt was cancelled', async () => {
    mocks.prepare.mockRejectedValueOnce(new Error('lost'));
    mocks.recover.mockImplementation(async (value) => ok({ ...intention(value), submission: { ...intention(value).submission, status: 'submission_cancelled' } }));
    render(<CareLabSave {...props} />); fillIntention(); submitIntention(); await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel exact attempt and check intention' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel unsaved intention and attempt' }));
    await screen.findByText(/Intention: cancelled/); expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith(mocks.prepare.mock.calls[0][0]);
    expect(screen.getByRole('button', { name: 'Return to source association' })).toBeInTheDocument(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it('does not report cancellation when save wins against the exact attempt cancellation', async () => {
    mocks.prepare.mockRejectedValueOnce(new Error('lost')); mocks.cancelAttempt.mockResolvedValueOnce(attempt('committed', false));
    render(<CareLabSave {...props} />); fillIntention(); submitIntention(); await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel exact attempt and check intention' }));
    await screen.findByText('Saved, not linked to this follow-up.'); expect(screen.queryByRole('button', { name: 'Return to recovery lists' })).toBeNull();
    expect(screen.queryByText(/Intention: cancelled/)).toBeNull(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it('keeps the actual form mounted during a delayed save, reads the exact outcome, and never treats ACK as linking', async () => {
    await fresh(); const gate = deferred(); mocks.save.mockReturnValueOnce(gate.promise); submitValues();
    const field = screen.getByLabelText('K+ (mEq/L)'); expect(field).toBeDisabled(); expect(field).toHaveValue(4.6);
    fireEvent.submit(field.closest('form')!); expect(mocks.save).toHaveBeenCalledOnce();
    expect(mocks.save.mock.calls[0][0]).toBe(scope.actor_id); expect(mocks.save.mock.calls[0][2].get('requestId')).toBe(id(300));
    await act(async () => gate.resolve({ status: 'saved_alert_pending', success: true }));
    await screen.findByText('Saved, not linked to this follow-up.'); expect(mocks.get).toHaveBeenCalledExactlyOnceWith({ actorId: scope.actor_id, patientId: scope.patient_id, requestId: id(300) });
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge exact saved receipt' }));
    await screen.findByText(/Exact lab attempt: acknowledged/); expect(screen.getByText('Saved, not linked to this follow-up.')).toBeInTheDocument();
    expect(screen.getByText(/Missing intended analytes: eGFR/)).toBeInTheDocument(); expect(mocks.save).toHaveBeenCalledOnce();
    expect(mocks.ack).toHaveBeenCalledExactlyOnceWith({ actorId: scope.actor_id, patientId: scope.patient_id, requestId: id(300), labResultId: id(400) });
  });
  it('retains entered values only after a proven rejection and exact unsaved recovery', async () => {
    await fresh(); mocks.save.mockResolvedValue({ status: 'not_saved', error: 'Rejected before save' });
    mocks.get.mockResolvedValue(attempt()); mocks.recover.mockImplementation(async (value) => ok(intention(value)));
    submitValues(); await waitFor(() => expect(screen.getByLabelText('K+ (mEq/L)')).not.toBeDisabled());
    expect(screen.getByLabelText('K+ (mEq/L)')).toHaveValue(4.6); expect(mocks.save).toHaveBeenCalledOnce();
  });
  it('does not permit resending values after an ambiguous save even if still prepared on readback', async () => {
    await fresh(); mocks.save.mockRejectedValue(new Error('lost response')); mocks.get.mockResolvedValue(attempt());
    mocks.recover.mockImplementation(async (value) => ok(intention(value))); submitValues();
    await screen.findByText(/An earlier save may still be in flight/); expect(screen.queryByLabelText('K+ (mEq/L)')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Recover exact intention' })); await screen.findByText(/An earlier save may still be in flight/);
    expect(mocks.save).toHaveBeenCalledOnce(); expect(screen.queryByLabelText('Collection date and time')).toBeNull();
  });
  it('never reconstructs values when recovering an existing intention', async () => {
    mocks.recover.mockResolvedValue(ok(intention())); render(<CareLabSave {...props} initial={input} detail={null} mayStart={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Recover exact intention' })); await screen.findByText(/An earlier save may still be in flight/);
    expect(screen.queryByLabelText('Collection date and time')).toBeNull(); expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.attempt).not.toHaveBeenCalled();
  });
  it('shows a save that wins against cancellation, never a false cancellation', async () => {
    await fresh(); mocks.cancel.mockImplementation(async (value) => ok(intention(value, true)));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel unsaved intention and attempt' })); await screen.findByText('Saved, not linked to this follow-up.');
    expect(screen.queryByText(/Intention: cancelled/)).toBeNull(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it('fails closed after a saved result when the exact intention read cannot be confirmed', async () => {
    await fresh(); mocks.recover.mockRejectedValue(new Error('offline')); submitValues(); await screen.findByRole('alert');
    expect(screen.queryByLabelText('Collection date and time')).toBeNull(); expect(screen.queryByRole('button', { name: 'Return to source association' })).toBeNull();
    expect(mocks.save).toHaveBeenCalledOnce();
  });
  it.each(['attempt', 'prepare', 'save'] as const)('ignores late %s after the account changes', async (operation) => {
    const gate = deferred();
    if (operation === 'save') { await fresh(); mocks.save.mockReturnValueOnce(gate.promise); submitValues(); }
    else { mocks[operation].mockReturnValueOnce(gate.promise); render(<CareLabSave {...props} />); fillIntention(); submitIntention(); await act(async () => {}); }
    act(() => mocks.subscribe.mock.calls[0][0]('SIGNED_IN', { user: { id: id(99) } }));
    await act(async () => gate.resolve(operation === 'attempt' ? attempt() : operation === 'save' ? { status: 'saved' } : ok(intention())));
    expect(screen.getByRole('alert')).toHaveTextContent('Your session changed'); expect(screen.queryByLabelText('Collection date and time')).toBeNull(); expect(mocks.get).not.toHaveBeenCalled();
  });
  it.each(['actor_id', 'organization_id', 'patient_id'] as const)('discards a delayed attempt after %s changes', async (key) => {
    const gate = deferred(); mocks.attempt.mockReturnValueOnce(gate.promise); const view = render(<CareLabSave {...props} />); fillIntention(); submitIntention();
    view.rerender(<CareLabSave {...props} scope={{ ...scope, [key]: id(99) }} />); await act(async () => gate.resolve(attempt()));
    expect(mocks.prepare).not.toHaveBeenCalled(); expect(screen.queryByText(/Exact lab attempt/)).toBeNull(); expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  });
});
