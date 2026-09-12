import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';

const { mockSave, mockRetry, mockLabs, mockEvaluations, mockGet, mockPrepare, mockAck, mockCancel, mockUser, authListeners } = vi.hoisted(() => ({
  mockSave: vi.fn(), mockRetry: vi.fn(), mockLabs: vi.fn(), mockEvaluations: vi.fn(),
  mockGet: vi.fn(), mockPrepare: vi.fn(), mockAck: vi.fn(), mockCancel: vi.fn(), mockUser: vi.fn(),
  authListeners: new Set<(event: string, session: { user: { id: string } } | null) => void>(),
}));
vi.mock('@/lib/dashboard/actions', () => ({ saveLabResult: mockSave, retryLabAlerts: mockRetry,
  getLabSubmission: mockGet, prepareLabSubmission: mockPrepare,
  acknowledgeLabSubmission: mockAck, cancelLabSubmission: mockCancel,
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser: mockUser,
      onAuthStateChange: (listener: (event: string, session: { user: { id: string } } | null) => void) => {
        authListeners.add(listener);
        return { data: { subscription: { unsubscribe: () => authListeners.delete(listener) } } };
      },
    },
    from: (table: string) => {
      let patientId = '';
      let cursor: string | undefined;
      const query = {
        select: () => query,
        eq: (key: string, value: string) => { if (key === 'patient_id') patientId = value; return query; },
        order: () => query, limit: () => query,
        gt: (_key: string, value: string) => { cursor = value; return query; },
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve(table === 'lab_results' ? mockLabs(patientId) : mockEvaluations(patientId, cursor)).then(resolve, reject),
      };
      return query;
    },
  }),
}));

import { LabResultsTab } from '@/app/(provider)/patients/[patientId]/_components/lab-results-tab';
import type { LabSubmission } from '@/lib/dashboard/actions';

const patientId = '00000000-0000-4000-a000-000000000001';
const otherPatientId = '00000000-0000-4000-a000-000000000002';
const labId = '10000000-0000-4000-a000-000000000001';
const actorId = '20000000-0000-4000-a000-000000000001';
const otherActorId = '20000000-0000-4000-a000-000000000002';
const requestId = '30000000-0000-4000-a000-000000000001';
const pending = { status: 'saved_alert_pending', success: false, labResultId: labId, eventId: 'event-a', alertStatus: 'pending' };
let currentSubmission: LabSubmission | null;

function submission(overrides: Partial<LabSubmission> = {}): LabSubmission {
  return { requestId, status: 'prepared', isNew: false, labResultId: null, eventId: null,
    alertStatus: null, collectedAt: null, potassium: null, egfr: null, creatinine: null,
    sodium: null, notes: null, ...overrides };
}

function committed(overrides: Partial<LabSubmission> = {}): LabSubmission {
  return submission({ status: 'committed', labResultId: labId, eventId: 'event-a',
    alertStatus: 'pending', collectedAt: '2025-08-01T13:15:00.123456Z', potassium: 6.2, ...overrides });
}

function response(row: LabSubmission | null, actor = actorId) {
  return { success: true as const, actorId: actor, submission: row };
}

function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => { resolve = finish; });
  return { promise, resolve };
}

function savedLab(id = labId, notes: string | null = null) {
  return { id, collected_at: '2025-08-01T13:15:00.000Z', potassium: 4.5,
    creatinine: null, egfr: null, bun: null, bnp: null, nt_probnp: null,
    hba1c: null, glucose: null, sodium: null, hemoglobin: null,
    ferritin: null, tsat: null, ldl: null, lab_facility: null, notes };
}

function fillAndSubmit(input: HTMLInputElement) {
  fireEvent.change(input, { target: { value: '2025-08-01T09:15' } });
  fireEvent.change(screen.getByLabelText('K+ (mEq/L)'), { target: { value: '6.2' } });
  fireEvent.submit(input.closest('form')!);
}

async function openForm() {
  render(<LabResultsTab patientId="00000000-0000-4000-a000-000000000001" />);
  const add = await screen.findByRole('button', { name: 'Add Lab Result' });
  await waitFor(() => expect(add).toBeEnabled());
  fireEvent.click(add);
  return await screen.findByLabelText('Collection date and time') as HTMLInputElement;
}

function collectionInstant(): string {
  return (document.querySelector('input[name="collectedAt"]') as HTMLInputElement).value;
}

describe('lab collection form', () => {
  beforeEach(() => {
    vi.stubEnv('TZ', 'America/New_York');
    currentSubmission = null;
    authListeners.clear();
    mockUser.mockReset().mockResolvedValue({ data: { user: { id: actorId } }, error: null });
    mockGet.mockReset().mockImplementation(async () => response(currentSubmission && { ...currentSubmission, isNew: false }));
    mockPrepare.mockReset().mockImplementation(async () => {
      const isNew = currentSubmission === null;
      currentSubmission ??= submission();
      return response({ ...currentSubmission, isNew });
    });
    mockAck.mockReset().mockImplementation(async () => {
      currentSubmission = { ...currentSubmission!, status: 'acknowledged' };
      return response(currentSubmission);
    });
    mockCancel.mockReset().mockImplementation(async () => {
      currentSubmission = { ...currentSubmission!, status: 'cancelled' };
      return response(currentSubmission);
    });
    mockSave.mockReset();
    mockSave.mockResolvedValue({ error: 'Test save stopped after inspecting input' });
    mockRetry.mockReset().mockResolvedValue({ error: 'Retry unavailable' });
    mockEvaluations.mockReset().mockResolvedValue({ data: [], error: null });
    mockLabs.mockReset();
    mockLabs.mockResolvedValue({ data: [] });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it('requires an explicit collection time, identifies the browser timezone and leaves entry time blank', async () => {
    const input = await openForm();
    expect(input).toBeRequired();
    expect(input).toHaveValue('');
    expect(collectionInstant()).toBe('');
    expect(await screen.findByText(/America\/New_York/)).toBeInTheDocument();
  });

  it('submits the selected historical local time as an unambiguous UTC instant', async () => {
    const input = await openForm();
    fireEvent.change(input, { target: { value: '2026-08-01T09:15' } });
    fireEvent.change(screen.getByLabelText('K+ (mEq/L)'), { target: { value: '4.5' } });
    expect(collectionInstant()).toBe('2026-08-01T13:15:00.000Z');
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
    expect((mockSave.mock.calls[0][1] as FormData).get('collectedAt')).toBe('2026-08-01T13:15:00.000Z');
  });

  it('rejects a nonexistent spring-forward time instead of moving it forward', async () => {
    const input = await openForm();
    fireEvent.change(input, { target: { value: '2026-03-08T02:30' } });
    expect(collectionInstant()).toBe('');
    expect(screen.getByRole('alert')).toHaveTextContent(/does not exist/);
    expect(screen.getByRole('button', { name: 'Save Lab Result' })).toBeDisabled();
  });

  it('requires the source offset for a repeated fall-back time and preserves either choice', async () => {
    const input = await openForm();
    fireEvent.change(input, { target: { value: '2025-11-02T01:30' } });
    const offset = screen.getByLabelText('Collection time offset');
    expect(offset).toBeRequired();
    expect(collectionInstant()).toBe('');
    expect(screen.getByRole('button', { name: 'Save Lab Result' })).toBeDisabled();
    expect(screen.getByRole('option', { name: 'UTC-04:00' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'UTC-05:00' })).toBeInTheDocument();

    fireEvent.change(offset, { target: { value: '2025-11-02T05:30:00.000Z' } });
    expect(collectionInstant()).toBe('2025-11-02T05:30:00.000Z');
    fireEvent.change(offset, { target: { value: '2025-11-02T06:30:00.000Z' } });
    expect(collectionInstant()).toBe('2025-11-02T06:30:00.000Z');
    expect(screen.getByRole('button', { name: 'Save Lab Result' })).toBeEnabled();

    fireEvent.change(input, { target: { value: '2025-11-02T01:45' } });
    expect(collectionInstant()).toBe('');
  });

  it('handles a half-hour DST overlap without assuming a one-hour change', async () => {
    vi.stubEnv('TZ', 'Australia/Lord_Howe');
    const input = await openForm();
    fireEvent.change(input, { target: { value: '2026-04-05T01:45' } });
    expect(collectionInstant()).toBe('');
    expect(screen.getByRole('option', { name: 'UTC+11:00' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'UTC+10:30' })).toBeInTheDocument();
  });

  it('shows the collection year, time and offset for distinct saved instants', async () => {
    const instants = [
      '2026-08-01T13:15:00.000Z',
      '2026-08-01T16:45:30.000Z',
      '2025-08-01T13:15:00.000Z',
      '2025-11-02T05:30:00.000Z',
      '2025-11-02T06:30:00.000Z',
    ];
    mockLabs.mockResolvedValue({ data: instants.map((collectedAt, index) => ({
      id: String(index), collected_at: collectedAt, potassium: 4.5,
      creatinine: null, egfr: null, bun: null, bnp: null, nt_probnp: null,
      hba1c: null, glucose: null, sodium: null, hemoglobin: null,
      ferritin: null, tsat: null, ldl: null, lab_facility: null, notes: null,
    })) });
    render(<LabResultsTab patientId="00000000-0000-4000-a000-000000000001" />);

    const expected = [
      /Aug 1, 2026.*9:15:00 AM GMT-04:00/,
      /Aug 1, 2026.*12:45:30 PM GMT-04:00/,
      /Aug 1, 2025.*9:15:00 AM GMT-04:00/,
      /Nov 2, 2025.*1:30:00 AM GMT-04:00/,
      /Nov 2, 2025.*1:30:00 AM GMT-05:00/,
    ];
    for (const [index, name] of expected.entries()) {
      const header = await screen.findByRole('columnheader', { name });
      expect(header).toBeVisible();
      expect(header.querySelector('time')).toHaveAttribute('datetime', instants[index]);
    }
  });

  it('uses the prepared server request UUID and retains it across a known failed save', async () => {
    mockSave.mockResolvedValue({ status: 'not_saved', error: 'Unable to save lab result' });
    const input = await openForm();
    expect(mockPrepare).toHaveBeenCalledWith({ patientId });
    const request = document.querySelector('input[name="requestId"]') as HTMLInputElement;
    expect(request.value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const initialId = request.value;
    fillAndSubmit(input);
    await screen.findByText('Unable to save lab result');
    fireEvent.change(screen.getByLabelText('K+ (mEq/L)'), { target: { value: '5.8' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(2));
    expect(mockSave.mock.calls.map((call) => (call[1] as FormData).get('requestId'))).toEqual([initialId, initialId]);
  });

  it('keeps a saved pending exam visible, blocks a duplicate insert and retries only its alert evaluation', async () => {
    mockSave.mockResolvedValue(pending);
    mockRetry.mockImplementation(async () => {
      currentSubmission = committed({ alertStatus: 'recorded' });
      return { status: 'saved', success: true, labResultId: labId, alertStatus: 'recorded' };
    });
    const input = await openForm();
    currentSubmission = committed();
    fillAndSubmit(input);
    expect(await screen.findByText(/Lab result saved\. Alert evaluation pending/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Save Lab Result' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Lab Result' })).toBeDisabled();
    fireEvent.submit(input.closest('form')!);
    expect(mockSave).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry alert evaluation' }));
    await waitFor(() => expect(mockRetry).toHaveBeenCalledWith({ patientId, labResultId: labId }));
    await waitFor(() => expect(screen.queryByText(/Lab result saved\. Alert evaluation pending/)).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Retry alert evaluation' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByLabelText('Collection date and time')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Acknowledge saved receipt' })).toBeVisible();
    expect(mockAck).not.toHaveBeenCalled();
    expect(mockSave).toHaveBeenCalledTimes(1);
  });

  it('keeps pending state on retry denial without claiming that the saved exam failed', async () => {
    mockSave.mockResolvedValue(pending);
    mockRetry.mockRejectedValue(new Error('Private backend detail'));
    const input = await openForm();
    currentSubmission = committed();
    fillAndSubmit(input);
    fireEvent.click(await screen.findByRole('button', { name: 'Retry alert evaluation' }));
    expect(await screen.findByText(/Unable to complete alert evaluation/)).toBeVisible();
    expect(screen.getByText(/Lab result saved\. Alert evaluation pending/)).toBeVisible();
    expect(screen.queryByText('Private backend detail')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save Lab Result' })).not.toBeInTheDocument();
  });

  it('preserves the original payload and request ID after an ambiguous save with no automatic retry', async () => {
    mockSave.mockRejectedValueOnce(new Error('Private network detail'));
    const input = await openForm();
    fillAndSubmit(input);
    expect(await screen.findByText(/Save confirmation is unavailable/)).toBeVisible();
    expect(screen.queryByText(/not saved/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Private network detail')).not.toBeInTheDocument();
    expect(screen.getByLabelText('K+ (mEq/L)')).toHaveValue(6.2);
    expect(screen.getByLabelText('K+ (mEq/L)')).toBeDisabled();
    expect(mockSave).toHaveBeenCalledTimes(1);
    currentSubmission = committed();
    fireEvent.click(screen.getByRole('button', { name: 'Recheck submission status' }));
    await waitFor(() => expect(mockGet).toHaveBeenLastCalledWith({ patientId, requestId }));
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Lab result saved\. Alert evaluation pending/)).toBeVisible();
    expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(true);
  });

  it('retains uncertainty and the payload when a confirmation retry is denied', async () => {
    mockSave.mockResolvedValueOnce({ status: 'save_unconfirmed' });
    const input = await openForm();
    fillAndSubmit(input);
    await screen.findByRole('button', { name: 'Recheck submission status' });
    mockGet.mockResolvedValue({ success: false, error: 'Access unavailable' });
    fireEvent.click(screen.getByRole('button', { name: 'Recheck submission status' }));
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(3));
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Save confirmation is unavailable/)).toBeVisible();
    expect(screen.getByLabelText('K+ (mEq/L)')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add Lab Result' })).toBeDisabled();
  });

  it('suppresses double save submissions while the first response is pending', async () => {
    let finish!: (state: unknown) => void;
    mockSave.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const input = await openForm();
    fillAndSubmit(input);
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Save Lab Result' })).toBeDisabled();
    expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(false);
    currentSubmission = committed();
    await act(async () => { finish(pending); });
    expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(true);
  });

  it('recovers persisted pending evaluations and linked collection time after reload, even outside the recent labs', async () => {
    mockLabs.mockResolvedValue({ data: [] });
    mockEvaluations.mockImplementation((_patient: string, cursor?: string) => ({ data: cursor ? [] : [{
      id: 'event-a', lab_result_id: labId, patient_id: patientId, status: 'pending', attempt_count: 2,
      lab_results: { collected_at: '2025-08-01T13:15:00.000Z' },
    }] }));
    const { unmount } = render(<LabResultsTab patientId={patientId} />);
    expect(await screen.findByText(/Lab result saved\. Alert evaluation pending/)).toBeVisible();
    expect(screen.getByText('2025-08-01T13:15:00.000Z')).toBeVisible();
    expect(mockEvaluations).toHaveBeenCalledWith(patientId, 'event-a');
    unmount();
    render(<LabResultsTab patientId={patientId} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Retry alert evaluation' }));
    await waitFor(() => expect(mockRetry).toHaveBeenCalledWith({ patientId, labResultId: labId }));
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('keeps known labs visible when evaluation status cannot be read and does not claim an empty pending queue', async () => {
    mockLabs.mockResolvedValue({ data: [savedLab()] });
    mockEvaluations.mockResolvedValue({ data: null, error: { message: 'Private RLS detail' } });
    render(<LabResultsTab patientId={patientId} />);
    expect(await screen.findByText(/Unable to load alert evaluation status/)).toBeVisible();
    expect(screen.getByRole('columnheader', { name: /Aug 1, 2025/ })).toBeVisible();
    expect(screen.queryByText('Private RLS detail')).not.toBeInTheDocument();
  });

  it('does not silently treat an incomplete evaluation page sequence as an empty queue', async () => {
    mockEvaluations.mockImplementation((_id: string, cursor?: string) => cursor
      ? { data: null, error: { message: 'Page two unavailable' } }
      : { data: [{ id: 'event-a', lab_result_id: labId, patient_id: patientId, status: 'pending', attempt_count: 1, lab_results: null }] });
    render(<LabResultsTab patientId={patientId} />);
    expect(await screen.findByText(/Unable to load alert evaluation status/)).toBeVisible();
    expect(mockEvaluations).toHaveBeenCalledWith(patientId, 'event-a');
    expect(screen.queryByText('Page two unavailable')).not.toBeInTheDocument();
  });

  it('suppresses double retry clicks and never calls the insert action', async () => {
    let finish!: (state: unknown) => void;
    mockEvaluations.mockImplementation((_id: string, cursor?: string) => ({ data: cursor ? [] : [{
      id: 'event-a', lab_result_id: labId, patient_id: patientId, status: 'pending', attempt_count: 1, lab_results: null,
    }] }));
    mockRetry.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    render(<LabResultsTab patientId={patientId} />);
    const retry = await screen.findByRole('button', { name: 'Retry alert evaluation' });
    fireEvent.click(retry);
    fireEvent.click(retry);
    expect(mockRetry).toHaveBeenCalledTimes(1);
    expect(mockSave).not.toHaveBeenCalled();
    await act(async () => { finish({ error: 'Unavailable' }); });
  });

  it('does not expose old lab data or old pending events after switching patients', async () => {
    let finishOld!: (value: unknown) => void;
    mockLabs.mockImplementation((id: string) => id === patientId
      ? new Promise((resolve) => { finishOld = resolve; }) : { data: [savedLab('lab-b', 'Current patient note')] });
    const { rerender } = render(<LabResultsTab patientId={patientId} />);
    await waitFor(() => expect(mockLabs).toHaveBeenCalledWith(patientId));
    rerender(<LabResultsTab patientId={otherPatientId} />);
    expect(await screen.findByText('Current patient note')).toBeVisible();
    await act(async () => { finishOld({ data: [savedLab(labId, 'Private previous patient note')] }); });
    expect(screen.queryByText('Private previous patient note')).not.toBeInTheDocument();
    expect(screen.getByText('Current patient note')).toBeVisible();
  });

  it('ignores a previous patient pending-status response after the new patient has loaded', async () => {
    let finishOld!: (value: unknown) => void;
    mockEvaluations.mockImplementation((id: string) => id === patientId
      ? new Promise((resolve) => { finishOld = resolve; }) : { data: [] });
    const { rerender } = render(<LabResultsTab patientId={patientId} />);
    await waitFor(() => expect(mockEvaluations).toHaveBeenCalledWith(patientId, undefined));
    rerender(<LabResultsTab patientId={otherPatientId} />);
    await screen.findByRole('button', { name: 'Add Lab Result' });
    await act(async () => { finishOld({ data: [{
      id: 'event-old', lab_result_id: labId, patient_id: patientId, status: 'pending', attempt_count: 1,
      lab_results: { collected_at: '2020-01-01T01:00:00Z' },
    }] }); });
    expect(screen.queryByText(/2020-01-01/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry alert evaluation' })).not.toBeInTheDocument();
  });

  it('checks existing submissions before enabling Add and prepares once before exposing inputs', async () => {
    const load = deferred();
    const prepare = deferred();
    mockGet.mockReturnValue(load.promise);
    mockPrepare.mockReturnValue(prepare.promise);
    render(<LabResultsTab patientId={patientId} />);
    const add = await screen.findByRole('button', { name: 'Add Lab Result' });
    expect(add).toBeDisabled();
    expect(mockPrepare).not.toHaveBeenCalled();
    await act(async () => load.resolve(response(null)));
    fireEvent.click(add);
    fireEvent.click(add);
    expect(mockPrepare).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('Collection date and time')).not.toBeInTheDocument();
    await act(async () => prepare.resolve(response(submission({ isNew: true }))));
    expect(await screen.findByLabelText('Collection date and time')).toBeVisible();
  });

  it('fails closed on active-submission load errors without hiding readable labs or showing backend details', async () => {
    mockGet.mockRejectedValue(new Error('Private receipt query detail'));
    mockLabs.mockResolvedValue({ data: [savedLab()] });
    render(<LabResultsTab patientId={patientId} />);
    expect(await screen.findByText(/Unable to check submission status/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add Lab Result' })).toBeDisabled();
    expect(screen.getByRole('columnheader', { name: /Aug 1, 2025/ })).toBeVisible();
    expect(screen.queryByText('Private receipt query detail')).not.toBeInTheDocument();
    expect(mockPrepare).not.toHaveBeenCalled();
  });

  it('recovers a lost preparation response without preparing again or collecting a replacement payload', async () => {
    mockPrepare.mockImplementation(async () => {
      currentSubmission = submission();
      throw new Error('Private transport detail');
    });
    render(<LabResultsTab patientId={patientId} />);
    const add = await screen.findByRole('button', { name: 'Add Lab Result' });
    await waitFor(() => expect(add).toBeEnabled());
    fireEvent.click(add);
    expect(await screen.findByText(/An earlier submission needs confirmation/)).toBeVisible();
    expect(screen.queryByLabelText('Collection date and time')).not.toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(mockPrepare).toHaveBeenCalledTimes(1);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('does not treat an existing prepared request returned by Add as a fresh editable form', async () => {
    mockPrepare.mockResolvedValue(response(submission()));
    render(<LabResultsTab patientId={patientId} />);
    const add = await screen.findByRole('button', { name: 'Add Lab Result' });
    await waitFor(() => expect(add).toBeEnabled());
    fireEvent.click(add);
    expect(await screen.findByText(/An earlier submission needs confirmation/)).toBeVisible();
    expect(screen.queryByLabelText('Collection date and time')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel this submission' })).toBeVisible();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('shows the same committed receipt after reload or opening another tab without acknowledging it', async () => {
    currentSubmission = committed({ notes: 'Saved source note', alertStatus: 'not_required' });
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    const first = render(<LabResultsTab patientId={patientId} />);
    expect(await screen.findByRole('heading', { name: 'Saved lab receipt' })).toBeVisible();
    expect(screen.getByText('2025-08-01T13:15:00.123456Z')).toBeVisible();
    expect(screen.getByText('Saved source note')).toBeVisible();
    expect(screen.getByText(/Acknowledgment only confirms receipt/)).toBeVisible();
    first.unmount();
    render(<LabResultsTab patientId={patientId} />);
    expect(await screen.findByRole('heading', { name: 'Saved lab receipt' })).toBeVisible();
    expect(mockAck).not.toHaveBeenCalled();
    expect(mockPrepare).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
    expect(storage).not.toHaveBeenCalled();
    storage.mockRestore();
  });

  it('reconfirms an exact saved request after a lost save response and requires explicit acknowledgment', async () => {
    mockSave.mockImplementation(async () => {
      currentSubmission = committed({ alertStatus: 'not_required' });
      throw new Error('Response lost');
    });
    fillAndSubmit(await openForm());
    const ack = await screen.findByRole('button', { name: 'Acknowledge saved receipt' });
    expect(mockGet).toHaveBeenLastCalledWith({ patientId, requestId });
    expect(mockAck).not.toHaveBeenCalled();
    expect(mockSave).toHaveBeenCalledTimes(1);
    fireEvent.click(ack);
    await waitFor(() => expect(mockAck).toHaveBeenCalledWith({ patientId, requestId, labResultId: labId }));
    expect(await screen.findByText(/Receipt acknowledged/)).toBeVisible();
    expect(mockPrepare).toHaveBeenCalledTimes(1);
  });

  it('reconfirms acknowledgment after a lost response without acknowledging twice or creating a new request', async () => {
    currentSubmission = committed({ alertStatus: 'not_required' });
    mockAck.mockImplementation(async () => {
      currentSubmission = committed({ status: 'acknowledged', alertStatus: 'not_required' });
      throw new Error('Acknowledgment response lost');
    });
    render(<LabResultsTab patientId={patientId} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Acknowledge saved receipt' }));
    expect(await screen.findByText(/Receipt acknowledged/)).toBeVisible();
    expect(mockGet).toHaveBeenLastCalledWith({ patientId, requestId });
    expect(mockAck).toHaveBeenCalledTimes(1);
    expect(mockPrepare).not.toHaveBeenCalled();
  });

  it('keeps a saved receipt visible when acknowledgment and reconfirmation both fail', async () => {
    currentSubmission = committed({ alertStatus: 'not_required' });
    render(<LabResultsTab patientId={patientId} />);
    const ack = await screen.findByRole('button', { name: 'Acknowledge saved receipt' });
    mockAck.mockResolvedValue({ success: false, error: 'Private denied detail' });
    mockGet.mockResolvedValue({ success: false, error: 'Private read detail' });
    fireEvent.click(ack);
    expect(await screen.findByText(/Unable to check submission status/)).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Saved lab receipt' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add Lab Result' })).toBeDisabled();
    expect(screen.queryByText(/Private denied detail|Private read detail/)).not.toBeInTheDocument();
  });

  it('cancels an old prepared identity before enabling a deliberate new submission', async () => {
    currentSubmission = submission();
    render(<LabResultsTab patientId={patientId} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel this submission' }));
    expect(await screen.findByText(/Submission cancelled/)).toBeVisible();
    expect(mockCancel).toHaveBeenCalledWith({ patientId, requestId });
    expect(mockPrepare).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Add Lab Result' })).toBeEnabled();
  });

  it('shows the saved receipt when the commit wins a cancellation race', async () => {
    currentSubmission = submission();
    mockCancel.mockResolvedValue(response(committed({ alertStatus: 'recorded' })));
    render(<LabResultsTab patientId={patientId} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel this submission' }));
    expect(await screen.findByRole('heading', { name: 'Saved lab receipt' })).toBeVisible();
    expect(screen.queryByText(/Submission cancelled/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Lab Result' })).toBeDisabled();
    expect(mockAck).not.toHaveBeenCalled();
  });

  it('recovers the prepared request after leaving while save is still in flight and never retransmits it', async () => {
    const save = deferred();
    mockSave.mockReturnValue(save.promise);
    fillAndSubmit(await openForm());
    cleanup();
    render(<LabResultsTab patientId={patientId} />);
    expect(await screen.findByText(/An earlier submission needs confirmation/)).toBeVisible();
    expect(screen.queryByLabelText('Collection date and time')).not.toBeInTheDocument();
    currentSubmission = committed({ alertStatus: 'not_required' });
    await act(async () => save.resolve({ status: 'saved', success: true, labResultId: labId }));
    expect(screen.queryByRole('heading', { name: 'Saved lab receipt' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Recheck submission status' }));
    expect(await screen.findByRole('heading', { name: 'Saved lab receipt' })).toBeVisible();
    expect(mockSave).toHaveBeenCalledTimes(1);
  });

  it('ignores an old patient receipt response after patient navigation', async () => {
    const old = deferred();
    mockGet.mockImplementation((input: { patientId: string }) => input.patientId === patientId
      ? old.promise : response(null));
    const view = render(<LabResultsTab patientId={patientId} />);
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith({ patientId }));
    view.rerender(<LabResultsTab patientId={otherPatientId} />);
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith({ patientId: otherPatientId }));
    await act(async () => old.resolve(response(committed({ notes: 'Old patient private note' }))));
    expect(screen.queryByText('Old patient private note')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Saved lab receipt' })).not.toBeInTheDocument();
  });

  it('clears clinical UI at logout and ignores delayed receipt and lab responses from the former account', async () => {
    const old = deferred();
    mockGet.mockReturnValue(old.promise);
    mockLabs.mockResolvedValue({ data: [savedLab(labId, 'Former account note')] });
    render(<LabResultsTab patientId={patientId} />);
    expect(await screen.findByText('Former account note')).toBeVisible();
    await act(async () => {
      mockUser.mockResolvedValue({ data: { user: null }, error: null });
      authListeners.forEach((notify) => notify('SIGNED_OUT', null));
    });
    expect(screen.queryByText('Former account note')).not.toBeInTheDocument();
    await act(async () => old.resolve(response(committed({ notes: 'Late old account note' }))));
    expect(screen.queryByText('Late old account note')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Lab Result' })).not.toBeInTheDocument();
  });

  it('rechecks the current user after account changes and rejects action actor mismatches', async () => {
    const old = deferred();
    mockGet.mockReturnValueOnce(old.promise).mockResolvedValue(response(committed({ notes: 'Mismatched account note' })));
    render(<LabResultsTab patientId={patientId} />);
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1));
    await act(async () => {
      mockUser.mockResolvedValue({ data: { user: { id: otherActorId } }, error: null });
      authListeners.forEach((notify) => notify('SIGNED_IN', { user: { id: otherActorId } }));
    });
    expect(await screen.findByText(/Unable to check submission status/)).toBeVisible();
    await act(async () => old.resolve(response(committed({ notes: 'Late actor note' }))));
    expect(screen.queryByText('Mismatched account note')).not.toBeInTheDocument();
    expect(screen.queryByText('Late actor note')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Lab Result' })).toBeDisabled();
  });

  it('never loads patient data when authentication cannot be verified', async () => {
    mockUser.mockRejectedValue(new Error('Private auth detail'));
    render(<LabResultsTab patientId={patientId} />);
    expect(await screen.findByText(/Unable to verify your session/)).toBeVisible();
    expect(mockGet).not.toHaveBeenCalled();
    expect(mockLabs).not.toHaveBeenCalled();
    expect(screen.queryByText('Private auth detail')).not.toBeInTheDocument();
  });

  it('normalizes a saved offset to UTC without dropping recorded microseconds', async () => {
    currentSubmission = committed({ collectedAt: '2025-08-01T09:15:00.123456-04:00', alertStatus: 'not_required' });
    render(<LabResultsTab patientId={patientId} />);
    expect(await screen.findByText('2025-08-01T13:15:00.123456Z')).toBeVisible();
    expect(screen.getByText('2025-08-01T13:15:00.123456Z').closest('time'))
      .toHaveAttribute('datetime', '2025-08-01T09:15:00.123456-04:00');
  });

  it('does not prepare automatically or lose initial status under StrictMode effect replay', async () => {
    render(<StrictMode><LabResultsTab patientId={patientId} /></StrictMode>);
    const add = await screen.findByRole('button', { name: 'Add Lab Result' });
    await waitFor(() => expect(add).toBeEnabled());
    expect(mockPrepare).not.toHaveBeenCalled();
    fireEvent.click(add);
    expect(await screen.findByLabelText('Collection date and time')).toBeVisible();
    expect(mockPrepare).toHaveBeenCalledTimes(1);
  });

  it('keeps Add blocked when both preparation and its recovery read fail', async () => {
    render(<LabResultsTab patientId={patientId} />);
    const add = await screen.findByRole('button', { name: 'Add Lab Result' });
    await waitFor(() => expect(add).toBeEnabled());
    mockPrepare.mockRejectedValue(new Error('Prepare response missing'));
    mockGet.mockRejectedValue(new Error('Read response missing'));
    fireEvent.click(add);
    expect(await screen.findByText(/Unable to check submission status/)).toBeVisible();
    expect(add).toBeDisabled();
    expect(screen.queryByLabelText('Collection date and time')).not.toBeInTheDocument();
    expect(mockPrepare).toHaveBeenCalledTimes(1);
  });

  it('recovers cancellation after response loss and suppresses duplicate cancel clicks', async () => {
    const cancel = deferred();
    currentSubmission = submission();
    mockCancel.mockReturnValue(cancel.promise);
    render(<LabResultsTab patientId={patientId} />);
    const button = await screen.findByRole('button', { name: 'Cancel this submission' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(mockCancel).toHaveBeenCalledTimes(1);
    currentSubmission = submission({ status: 'cancelled' });
    await act(async () => cancel.resolve({ success: false, error: 'Cancellation response missing' }));
    expect(await screen.findByText(/Submission cancelled/)).toBeVisible();
    expect(mockGet).toHaveBeenLastCalledWith({ patientId, requestId });
    expect(mockPrepare).not.toHaveBeenCalled();
  });

  it('does not replace an exact request with a mismatched or missing receipt', async () => {
    currentSubmission = submission();
    render(<LabResultsTab patientId={patientId} />);
    const recheck = await screen.findByRole('button', { name: 'Recheck submission status' });
    mockGet.mockResolvedValueOnce(response(committed({ requestId: 'wrong-request', notes: 'Unrelated saved note' })))
      .mockResolvedValueOnce(response(null));
    fireEvent.click(recheck);
    expect(await screen.findByText(/Unable to check submission status/)).toBeVisible();
    expect(screen.queryByText('Unrelated saved note')).not.toBeInTheDocument();
    fireEvent.click(recheck);
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(3));
    expect(screen.getByRole('button', { name: 'Add Lab Result' })).toBeDisabled();
    expect(screen.getByText(/An earlier submission needs confirmation/)).toBeVisible();
  });

  it('ignores old authentication verification after a different account is verified', async () => {
    const oldAuth = deferred();
    mockUser.mockReturnValueOnce(oldAuth.promise)
      .mockResolvedValue({ data: { user: { id: otherActorId } }, error: null });
    mockGet.mockResolvedValue(response(committed({ notes: 'Current account saved note', alertStatus: 'not_required' }), otherActorId));
    render(<LabResultsTab patientId={patientId} />);
    await waitFor(() => expect(mockUser).toHaveBeenCalledTimes(1));
    await act(async () => authListeners.forEach((notify) => notify('SIGNED_IN', { user: { id: otherActorId } })));
    expect(await screen.findByText('Current account saved note')).toBeVisible();
    await act(async () => oldAuth.resolve({ data: { user: { id: actorId } }, error: null }));
    expect(screen.getByText('Current account saved note')).toBeVisible();
    expect(mockGet).toHaveBeenCalledTimes(1);
  });
});
