import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BatchVitalsActionState } from '@/lib/vitals/types';
const { recover, prepare, submit, acknowledge, cancel, pending } = vi.hoisted(() => ({
  recover: vi.fn(), prepare: vi.fn(), submit: vi.fn(), acknowledge: vi.fn(), cancel: vi.fn(), pending: vi.fn(),
}));
vi.mock('@/lib/vitals/batch-actions', () => ({ recoverVitalsBatch: recover, prepareVitalsBatch: prepare,
  submitCapturedVitalsBatch: submit, acknowledgeVitalsBatch: acknowledge, cancelVitalsBatch: cancel }));
vi.mock('@/lib/vitals/submission-actions', () => ({ listPendingVitalsSubmissions: pending, recoverVitalsSubmission: vi.fn() }));
import BatchEntryGrid from '@/app/(provider)/patients/[patientId]/track-b-entry/_components/batch-entry-grid';
const patient = '46000000-0000-4000-8000-000000000011';
const batch = '46000000-0000-4000-8000-000000000021';
const request = '46000000-0000-4000-8000-000000000031';
const saved: BatchVitalsActionState = { batchId: batch, saved: true, submissionStatus: 'committed', anyRedFlags: true, results: [{
  rowIndex: 0, date: '2026-09-22', success: false,
  redFlags: [{ id: 'spo2_low', severity: 'critical', message: 'Low oxygen saturation', action: 'Seek urgent evaluation' }],
  receipt: { requestId: request, saved: true, submissionStatus: 'batched', evaluationStatus: 'pending',
    vitals: { id: '46000000-0000-4000-8000-000000000041', patient_id: patient, recorded_at: '2026-09-22T12:00:00Z',
      weight_lbs: 180, sbp: 120, dbp: 80, heart_rate: 70, spo2: 90, source: 'provider_entry' },
    redFlags: [{ id: 'spo2_low', severity: 'critical', message: 'Low oxygen saturation', action: 'Seek urgent evaluation' }] },
}] };
beforeEach(() => {
  vi.resetAllMocks(); recover.mockResolvedValue({}); prepare.mockResolvedValue({ batchId: batch, submissionStatus: 'prepared' });
  submit.mockResolvedValue(saved); acknowledge.mockResolvedValue({ batchId: batch, submissionStatus: 'acknowledged' });
  cancel.mockResolvedValue({ batchId: batch, submissionStatus: 'cancelled' }); pending.mockResolvedValue({ receipts: [], total: 0 });
});
afterEach(() => vi.useRealTimers());
async function show() {
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(<BatchEntryGrid patientId={patient} />); }); return view;
}
describe('batch capture recovery UI', () => {
  it('keeps attempted dates across midnight but refreshes them after confirmed ACK', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime('2026-09-23T16:00:00Z');
    submit.mockResolvedValueOnce({ batchId: batch, submissionStatus: 'prepared', error: 'Correct the row' });
    const { container } = await show();
    const lastDate = () => (container.querySelector('input[name="row_6_recordedAt"]') as HTMLInputElement)?.value;
    expect(lastDate()).toBe('2026-09-23');
    fireEvent.click(screen.getByRole('button', { name: 'Save 7-Day Batch' }));
    await screen.findByText('Correct the row');
    vi.setSystemTime('2026-09-24T16:00:00Z');
    fireEvent.click(screen.getByRole('button', { name: 'kg', exact: true }));
    expect(lastDate()).toBe('2026-09-23');
    fireEvent.click(screen.getByRole('button', { name: 'Save 7-Day Batch' }));
    await screen.findByRole('heading', { name: 'Batch Saved — Review Each Evaluation' });
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge Saved Batch and Start Another' }));
    await screen.findByRole('button', { name: 'Save 7-Day Batch' });
    expect(lastDate()).toBe('2026-09-24');
  });
  it('renders seven dates and all measurement/symptom columns after recovery', async () => {
    const { container } = await show(); expect(container.querySelectorAll('tbody tr')).toHaveLength(7);
    for (const name of ['Date', 'Weight', 'SBP', 'DBP', 'HR', 'SpO2', 'Dyspnea']) expect(screen.getByRole('columnheader', { name, exact: true })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Save 7-Day Batch' })).not.toBeDisabled();
  });
  it('blocks capture when initial recovery fails', async () => {
    recover.mockResolvedValue({ errorKind: 'unavailable', error: 'Cannot check previous batch' });
    await show(); expect(screen.getByRole('button', { name: 'Save 7-Day Batch' })).toBeDisabled();
    expect(submit).not.toHaveBeenCalled();
  });
  it('saves using the prepared server identity and removes capture controls afterward', async () => {
    await show(); fireEvent.click(screen.getByRole('button', { name: 'Save 7-Day Batch' }));
    await screen.findByRole('heading', { name: 'Batch Saved — Review Each Evaluation' });
    expect(submit.mock.calls[0][1].get('batchId')).toBe(batch);
    expect(screen.queryByRole('button', { name: 'Save 7-Day Batch' })).toBeNull();
    expect(screen.getByText('Saved — Evaluation Pending')).toBeDefined();
    expect(screen.getByText(/Low oxygen saturation/)).toBeDefined();
    expect(screen.getByText(/180 lbs/)).toBeDefined();
  });
  it('reload recovers saved rows without recapturing or using freshly generated dates', async () => {
    recover.mockResolvedValue(saved); await show();
    expect(screen.getByText('2026-09-22')).toBeDefined(); expect(prepare).not.toHaveBeenCalled(); expect(submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry Batch Evaluations' }));
    await waitFor(() => expect(recover).toHaveBeenLastCalledWith(patient, batch));
  });
  it('another tab committed during prepare does not save the current form', async () => {
    prepare.mockResolvedValue(saved); await show(); fireEvent.click(screen.getByRole('button', { name: 'Save 7-Day Batch' }));
    await screen.findByText(/current form values were not saved/); expect(submit).not.toHaveBeenCalled();
  });
  it('preserves the prepared ID after thrown save and reuses it', async () => {
    submit.mockRejectedValueOnce(new Error('lost')); await show();
    fireEvent.click(screen.getByRole('button', { name: 'Save 7-Day Batch' }));
    await screen.findByText(/result could not be confirmed/);
    fireEvent.click(screen.getByRole('button', { name: 'Save 7-Day Batch' }));
    await screen.findByRole('heading', { name: 'Batch Saved — Review Each Evaluation' });
    expect(prepare).toHaveBeenCalledTimes(1); expect(submit.mock.calls[1][1].get('batchId')).toBe(batch);
  });
  it('retains the newly prepared ID when the first submission returns an error without identity', async () => {
    submit.mockResolvedValue({ errorKind: 'unavailable', error: 'Could not verify the prepared batch' });
    recover.mockResolvedValueOnce({}).mockResolvedValueOnce({ batchId: batch, submissionStatus: 'prepared' });
    await show(); fireEvent.click(screen.getByRole('button', { name: 'Save 7-Day Batch' }));
    await screen.findByText('Could not verify the prepared batch');
    expect(screen.getByRole('button', { name: 'Save 7-Day Batch' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Check Saved Batch' }));
    await waitFor(() => expect(recover).toHaveBeenLastCalledWith(patient, batch));
    expect(prepare).toHaveBeenCalledTimes(1);
  });
  it('acknowledges exact row IDs and permits new capture while pending remains discoverable', async () => {
    recover.mockResolvedValue(saved); await show();
    const pendingReads = pending.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge Saved Batch and Start Another' }));
    await screen.findByRole('button', { name: 'Save 7-Day Batch' });
    expect(acknowledge).toHaveBeenCalledWith(patient, batch, [request]); expect(pending).toHaveBeenCalled();
    await waitFor(() => expect(pending.mock.calls.length).toBeGreaterThan(pendingReads));
  });
  it('lost ACK retains saved measurements and critical instructions', async () => {
    recover.mockResolvedValue(saved); acknowledge.mockRejectedValue(new Error('lost')); await show();
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge Saved Batch and Start Another' }));
    await screen.findByText(/result could not be confirmed/);
    expect(screen.getByText(/Low oxygen saturation/)).toBeDefined(); expect(screen.queryByRole('button', { name: 'Save 7-Day Batch' })).toBeNull();
  });
  it('an error returned by ACK retains the receipt just like a lost response', async () => {
    recover.mockResolvedValue(saved); acknowledge.mockResolvedValue({ error: 'Receipt not confirmed' }); await show();
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge Saved Batch and Start Another' }));
    await screen.findByText('Receipt not confirmed'); expect(screen.getByText(/180 lbs/)).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Save 7-Day Batch' })).toBeNull();
  });
  it('ignores a late saved response after switching patients', async () => {
    let finish!: (result: BatchVitalsActionState) => void;
    recover.mockReturnValueOnce(new Promise<BatchVitalsActionState>((resolve) => { finish = resolve; }));
    const { rerender } = await show();
    const other = '46000000-0000-4000-8000-000000000099';
    await act(async () => { rerender(<BatchEntryGrid patientId={other} />); });
    await act(async () => { finish(saved); });
    expect(screen.queryByText(/180 lbs/)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Batch Saved — Review Each Evaluation' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Save 7-Day Batch' })).not.toBeDisabled();
  });
  it('recovers a confirmed cancellation by the same ID after its response was lost', async () => {
    recover.mockResolvedValueOnce({ batchId: batch, submissionStatus: 'prepared' })
      .mockResolvedValueOnce({ batchId: batch, submissionStatus: 'cancelled' });
    cancel.mockResolvedValue({ error: 'Cancellation unconfirmed' }); await show();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Unsaved Batch to Switch Modes' }));
    await screen.findByText('Cancellation unconfirmed');
    fireEvent.click(screen.getByRole('button', { name: 'Check Saved Batch' }));
    await waitFor(() => expect(screen.queryByText('Cancellation unconfirmed')).toBeNull());
    expect(recover).toHaveBeenLastCalledWith(patient, batch);
    expect(screen.queryByRole('button', { name: 'Cancel Unsaved Batch to Switch Modes' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Save 7-Day Batch' })).not.toBeDisabled();
  });
  it('transient retry failure preserves known flags but access revocation clears them', async () => {
    recover.mockResolvedValueOnce(saved).mockResolvedValueOnce({ error: 'Unavailable', errorKind: 'unavailable' })
      .mockResolvedValueOnce({ error: 'Access removed', errorKind: 'access' });
    await show(); fireEvent.click(screen.getByRole('button', { name: 'Retry Batch Evaluations' }));
    await screen.findByText('Unavailable'); expect(screen.getByText(/Low oxygen saturation/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Retry Batch Evaluations' }));
    await screen.findByText('Access removed'); expect(screen.queryByText(/180 lbs/)).toBeNull();
  });
  it('competing mode links to the individual receipt and blocks batch capture', async () => {
    recover.mockResolvedValue({ activeIndividual: true, error: 'Individual active' }); await show();
    expect(screen.getByRole('link', { name: 'Recover Active Individual Entry' }).getAttribute('href')).toContain('mode=single');
    expect(screen.getByRole('button', { name: 'Save 7-Day Batch' })).toBeDisabled();
  });
  it('cancel racing with capture displays the committed batch', async () => {
    recover.mockResolvedValue({ batchId: batch, submissionStatus: 'prepared' }); cancel.mockResolvedValue(saved); await show();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Unsaved Batch to Switch Modes' }));
    await screen.findByRole('heading', { name: 'Batch Saved — Review Each Evaluation' }); expect(submit).not.toHaveBeenCalled();
  });
  it('cancel confirmation clears old values before renewing dates; an unconfirmed cancel preserves both', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime('2026-09-23T16:00:00Z');
    recover.mockResolvedValue({ batchId: batch, submissionStatus: 'prepared' });
    cancel.mockResolvedValueOnce({ error: 'Cancellation unconfirmed' });
    const { container } = await show();
    const value = (name: string) => container.querySelector(`input[name="${name}"]`) as HTMLInputElement;
    fireEvent.change(value('row_6_weight'), { target: { value: '180' } });
    vi.setSystemTime('2026-09-24T16:00:00Z');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Unsaved Batch to Switch Modes' }));
    await screen.findByText('Cancellation unconfirmed');
    expect(value('row_6_recordedAt').value).toBe('2026-09-23'); expect(value('row_6_weight').value).toBe('180');
    // Recover the unchanged prepared attempt, then cancel successfully.
    fireEvent.click(screen.getByRole('button', { name: 'Check Saved Batch' }));
    await waitFor(() => expect(screen.queryByText('Cancellation unconfirmed')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Unsaved Batch to Switch Modes' }));
    await waitFor(() => expect(value('row_6_recordedAt').value).toBe('2026-09-24'));
    expect(value('row_6_weight').value).toBe('');
  });
});
