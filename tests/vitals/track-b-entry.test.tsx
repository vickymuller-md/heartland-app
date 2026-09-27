/**
 * Provider recovery UI. Atomic RPC/auth/engine assertions live in
 * submission-actions.test.ts and the real PostgreSQL receipt/evaluation suites.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const { recover, prepare, submit, acknowledge, listPending } = vi.hoisted(() => ({
  recover: vi.fn(), prepare: vi.fn(), submit: vi.fn(), acknowledge: vi.fn(), listPending: vi.fn(),
}));
vi.mock('@/lib/vitals/submission-actions', () => ({
  recoverVitalsSubmission: recover, prepareVitalsSubmission: prepare,
  submitCapturedProviderVitals: submit, submitCapturedVitals: vi.fn(),
  acknowledgeVitalsSubmission: acknowledge, listPendingVitalsSubmissions: listPending,
}));
import ProviderVitalsForm from '@/app/(provider)/patients/[patientId]/track-b-entry/_components/provider-vitals-form';
import { VitalsSubmissionStatus } from '@/lib/vitals/submission-status';
import type { VitalsActionState } from '@/lib/vitals/types';

const patient = '45000000-0000-4000-8000-000000000011';
const request = '45000000-0000-4000-8000-000000000021';
const saved: VitalsActionState = {
  requestId: request, saved: true, submissionStatus: 'committed', evaluationStatus: 'pending',
  symptomsId: '45000000-0000-4000-8000-000000000041',
  vitals: { id: '45000000-0000-4000-8000-000000000031', patient_id: patient,
    recorded_at: '2026-09-23T12:00:00Z', weight_lbs: 180, sbp: 120, dbp: 80, heart_rate: 70, spo2: 90, source: 'provider_entry' },
  redFlags: [{ id: 'spo2_low', severity: 'critical', message: 'Low oxygen saturation (<92%)', action: 'Seek urgent evaluation' }],
};
beforeEach(() => {
  vi.resetAllMocks();
  recover.mockResolvedValue({});
  prepare.mockResolvedValue({ requestId: request, submissionStatus: 'prepared' });
  submit.mockResolvedValue({ ...saved, success: true, evaluationStatus: 'complete' });
  acknowledge.mockResolvedValue({ submissionStatus: 'acknowledged' });
  listPending.mockResolvedValue({ total: 0, receipts: [] });
});
async function renderForm() {
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(<ProviderVitalsForm patientId={patient} />); });
  return view;
}
function fillForm() {
  for (const [label, value] of [[/weight/i, '190'], [/systolic/i, '120'], [/diastolic/i, '80'], [/heart rate/i, '70']] as const) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
}

describe('provider receipt recovery', () => {
  it('renders all measurement/symptom/date fields and the patient identity', async () => {
    const { container } = await renderForm();
    for (const label of [/weight/i, /systolic/i, /diastolic/i, /heart rate/i, /spo2/i, /date/i]) expect(screen.getByLabelText(label)).toBeInTheDocument();
    for (const text of [/shortness of breath/i, /swelling/i, /breathing lying down/i, /tiredness/i]) expect(screen.getByText(text)).toBeInTheDocument();
    expect(container.querySelector<HTMLInputElement>('input[name="patientId"]')?.value).toBe(patient);
    expect(screen.getByText('lbs')).toBeInTheDocument(); expect(screen.getByText('kg')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save vitals/i })).toBeEnabled();
  });
  it('prepares before saving and attaches the exact request id', async () => {
    await renderForm(); fillForm();
    await userEvent.click(screen.getByRole('button', { name: /save vitals/i }));
    expect(prepare).toHaveBeenCalledWith(patient);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0][1].get('requestId')).toBe(request);
    expect(submit.mock.calls[0][1].get('weight')).toBe('190');
    expect(await screen.findByText('180 lbs')).toBeInTheDocument();
  });
  it('recovers a committed entry after reload without writing another measurement', async () => {
    recover.mockResolvedValue(saved);
    await renderForm();
    expect(screen.getByText('Saved — Evaluation Pending')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save vitals/i })).not.toBeInTheDocument();
    expect(prepare).not.toHaveBeenCalled(); expect(submit).not.toHaveBeenCalled();
    expect(screen.getByText(/seek urgent evaluation/i)).toBeInTheDocument();
  });
  it('retries evaluation by receipt id, not by current form contents', async () => {
    recover.mockResolvedValueOnce(saved).mockResolvedValueOnce({ ...saved, success: true, evaluationStatus: 'complete' });
    await renderForm();
    await userEvent.click(screen.getByRole('button', { name: 'Retry Evaluation' }));
    expect(recover).toHaveBeenLastCalledWith(patient, request);
    expect(await screen.findByText('Vitals and Symptoms Saved')).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
  });
  it('another tab committing during prepare is explicit and displays actual saved values', async () => {
    prepare.mockResolvedValue({ ...saved, success: true, evaluationStatus: 'complete' });
    await renderForm(); fillForm();
    await userEvent.click(screen.getByRole('button', { name: /save vitals/i }));
    expect(await screen.findByText(/values in your current form were not saved/i)).toBeInTheDocument();
    expect(screen.getByText('180 lbs')).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
  });
  it('a transient recovery error preserves the proven saved receipt and its critical instructions', async () => {
    recover.mockResolvedValueOnce(saved)
      .mockResolvedValueOnce({ error: 'Temporarily unavailable', errorKind: 'unavailable' })
      .mockResolvedValueOnce(saved);
    await renderForm();
    await userEvent.click(screen.getByRole('button', { name: 'Retry Evaluation' }));
    expect(await screen.findByText('Temporarily unavailable')).toBeInTheDocument();
    expect(screen.getByText('180 lbs')).toBeInTheDocument();
    expect(screen.getByText(/seek urgent evaluation/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save vitals/i })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Retry Evaluation' }));
    expect(recover.mock.calls.slice(1)).toEqual([[patient, request], [patient, request]]);
  });
  it('explicit access revocation clears saved values instead of keeping a stale authorized view', async () => {
    recover.mockResolvedValueOnce(saved).mockResolvedValueOnce({ error: 'Unauthorized', errorKind: 'access' });
    await renderForm();
    await userEvent.click(screen.getByRole('button', { name: 'Retry Evaluation' }));
    expect(await screen.findByText('Unauthorized')).toBeInTheDocument();
    expect(screen.queryByText('180 lbs')).toBeNull();
    expect(screen.getByRole('button', { name: /save vitals/i })).toBeDisabled();
  });
  it('ACK after a transient retry error still enables the next reading', async () => {
    recover.mockResolvedValueOnce(saved).mockResolvedValueOnce({ error: 'Temporarily unavailable', errorKind: 'unavailable' });
    await renderForm();
    await userEvent.click(screen.getByRole('button', { name: 'Retry Evaluation' }));
    await userEvent.click(screen.getByRole('button', { name: /acknowledge saved record/i }));
    expect(await screen.findByRole('button', { name: /save vitals/i })).toBeEnabled();
  });
  it('a fresh saved failure still exposes newly computed critical flags', async () => {
    recover.mockResolvedValueOnce({ ...saved, redFlags: undefined })
      .mockResolvedValueOnce({ ...saved, evaluationStatus: 'failed', error: 'Evaluation could not be persisted.' });
    await renderForm();
    expect(screen.queryByText(/seek urgent evaluation/i)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Retry Evaluation' }));
    expect(await screen.findByText(/seek urgent evaluation/i)).toBeInTheDocument();
  });
  it('pending panel keeps instructions on transient retry failure for the same receipt', async () => {
    listPending.mockResolvedValue({ total: 1, receipts: [saved] });
    await renderForm();
    recover.mockResolvedValueOnce(saved).mockResolvedValueOnce({ error: 'Transient pending failure', errorKind: 'unavailable' });
    await userEvent.click(screen.getByRole('button', { name: 'Retry Saved Evaluation' }));
    expect(await screen.findByText(/seek urgent evaluation/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry Saved Evaluation' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Retry Saved Evaluation' }));
    expect(await screen.findByText('Transient pending failure')).toBeInTheDocument();
    expect(screen.getByText(/seek urgent evaluation/i)).toBeInTheDocument();
  });
  it('ACK of a pending record permits a new reading while retaining a discoverable pending receipt', async () => {
    recover.mockResolvedValue(saved);
    await renderForm();
    listPending.mockResolvedValue({ total: 1, receipts: [{ ...saved, submissionStatus: 'acknowledged' }] });
    await userEvent.click(screen.getByRole('button', { name: /acknowledge saved record/i }));
    expect(acknowledge).toHaveBeenCalledWith(request, saved.vitals!.id, saved.symptomsId, patient);
    expect(await screen.findByRole('button', { name: /save vitals/i })).toBeEnabled();
    expect(await screen.findByText('Pending Evaluations (1)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry Saved Evaluation' })).toBeInTheDocument();
  });
  it('an ambiguous ACK does not silently start another entry', async () => {
    recover.mockResolvedValue(saved);
    acknowledge.mockRejectedValueOnce(new Error('lost response'));
    await renderForm();
    await userEvent.click(screen.getByRole('button', { name: /acknowledge saved record/i }));
    expect(await screen.findByText(/receipt confirmation is pending/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save vitals/i })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /acknowledge saved record/i }));
    expect(acknowledge).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole('button', { name: /save vitals/i })).toBeEnabled();
  });
  it('initial recovery failure blocks a new capture until checked', async () => {
    recover.mockResolvedValueOnce({ error: 'Could not check the saved record.' }).mockResolvedValueOnce({});
    await renderForm();
    expect(screen.getByRole('button', { name: /save vitals/i })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Check Saved Record' }));
    expect(screen.getByRole('button', { name: /save vitals/i })).toBeEnabled();
    expect(submit).not.toHaveBeenCalled();
  });
  it('retains instructions when the capture is saved but evaluation fails', async () => {
    submit.mockResolvedValue({ ...saved, evaluationStatus: 'failed' });
    await renderForm(); fillForm();
    await userEvent.click(screen.getByRole('button', { name: /save vitals/i }));
    expect(await screen.findByText('Saved — Evaluation Pending')).toBeInTheDocument();
    expect(screen.getByText(/seek urgent evaluation/i)).toBeInTheDocument();
    expect(screen.queryByText('Vitals and Symptoms Saved')).toBeNull();
  });
  it('retains prepared identity after a lost action response', async () => {
    submit.mockRejectedValueOnce(new Error('network'));
    await renderForm(); fillForm();
    await userEvent.click(screen.getByRole('button', { name: /save vitals/i }));
    expect(await screen.findByText(/save could not be confirmed/i)).toBeInTheDocument();
    fillForm();
    await userEvent.click(screen.getByRole('button', { name: /save vitals/i }));
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls.map((call) => call[1].get('requestId'))).toEqual([request, request]);
  });
  it('retries an acknowledged pending receipt by its original id', async () => {
    listPending.mockResolvedValue({ total: 1, receipts: [saved] });
    await renderForm();
    recover.mockResolvedValueOnce({ ...saved, success: true, evaluationStatus: 'complete' });
    listPending.mockResolvedValueOnce({ total: 0, receipts: [] });
    await userEvent.click(screen.getByRole('button', { name: 'Retry Saved Evaluation' }));
    expect(recover).toHaveBeenLastCalledWith(patient, request);
    expect(await screen.findByText(/saved evaluation completed/i)).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
  });
  it('does not call an unsupported complete response a confirmed evaluation', () => {
    render(<VitalsSubmissionStatus state={{ ...saved, evaluationStatus: 'complete', success: undefined }}
      busy={false} onRetry={vi.fn()} onNew={vi.fn()} />);
    expect(screen.getByText('Saved — Evaluation Pending')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry Evaluation' })).toBeInTheDocument();
  });
  it('pending query errors are visible instead of an empty queue', async () => {
    listPending.mockResolvedValue({ error: 'Could not load pending evaluations.' });
    await renderForm();
    expect(screen.getByText('Could not load pending evaluations.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh Pending Evaluations' })).toBeInTheDocument();
  });
  it('pending pagination keeps entries beyond the first twenty accessible', async () => {
    listPending.mockResolvedValue({ total: 21, receipts: [saved] });
    await renderForm();
    await userEvent.click(screen.getByRole('button', { name: 'Next Pending Records' }));
    await waitFor(() => expect(listPending).toHaveBeenLastCalledWith(patient, 20));
    expect(screen.getByRole('button', { name: 'Previous Pending Records' })).toBeInTheDocument();
  });
});
