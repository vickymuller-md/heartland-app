import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ prepare: vi.fn(), recover: vi.fn(), apply: vi.fn(), cancel: vi.fn(), acknowledge: vi.fn(),
  list: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn() }));
vi.mock('@/lib/care-workflow/actions', () => ({ prepareCareRequest: mocks.prepare, recoverCareRequest: mocks.recover,
  applyCareRequest: mocks.apply, cancelCareRequest: mocks.cancel, acknowledgeCareRequest: mocks.acknowledge,
  loadPendingCareRequests: mocks.list }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { onAuthStateChange: mocks.subscribe } }) }));
import { CareRequestPanel } from '@/app/(provider)/patients/[patientId]/_components/care-request-panel';
import { CARE_UNCONFIRMED, type CareRequestInput, type CareRequestState } from '@/lib/care-workflow/types';
const id = (n: number) => `59000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const props = { actorId: id(1), patientId: id(2), scopeKey: 'snapshot1', organizations: [{ id: id(3), name: 'Clinic A' }, { id: id(8), name: 'Clinic B' }] };
const input: CareRequestInput = { actor_id: id(1), patient_id: id(2), organization_id: id(3), request_id: id(4), work_item_id: id(5),
  payload: { kind: 'laboratory_order', source: 'external_documented', purpose: 'Synthetic potassium follow-up',
    evidence: '  Original source  ', occurred_at: '2026-09-29T12:00:00Z', next_review_at: '2026-10-01T12:00:00Z', analytes: ['potassium'] } };
function saved(value = input, state: 'prepared' | 'applied' | 'cancelled' = 'prepared'): CareRequestState {
  return { ...value, state, recorded_at: '2026-09-29T13:00:00Z', acknowledged_at: null, receipt: state === 'applied' ? {
    request_id: value.request_id, work_item_id: value.work_item_id, event_id: id(6), workflow_revision: '1', stage: 'requested',
    recorded_at: '2026-09-29T13:00:00Z', acceptance_recorded: false, external_transmission_confirmed: false,
  } : null };
}
const result = (data: CareRequestState) => ({ data, error: null });
beforeEach(() => {
  vi.resetAllMocks(); mocks.subscribe.mockReturnValue({ data: { subscription: { unsubscribe: mocks.unsubscribe } } });
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-29T13:00:00Z'));
  mocks.list.mockResolvedValue({ data: { items: [], next_cursor: null }, error: null });
  mocks.prepare.mockImplementation(async (value) => result(saved(value)));
  mocks.apply.mockImplementation(async (value) => result(saved(value, 'applied')));
  mocks.recover.mockImplementation(async (value) => result(saved(value)));
  mocks.cancel.mockImplementation(async (value) => result(saved(value, 'cancelled')));
  mocks.acknowledge.mockImplementation(async (value) => result({ ...saved(value, 'applied'), acknowledged_at: '2026-09-29T13:01:00Z' }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function chooseOrg() { fireEvent.change(screen.getByLabelText('Request organization'), { target: { value: id(3) } }); }
async function start() {
  render(<CareRequestPanel {...props} />); chooseOrg();
  fireEvent.click(screen.getByRole('button', { name: 'Check pending requests' }));
  await screen.findByRole('form', { name: 'New care request' });
}
function fill() {
  for (const [label, value] of [['Request source', 'external_documented'], ['Purpose', input.payload.purpose],
    ['Source evidence or reference', input.payload.evidence], ['Request occurred at (UTC)', '2026-09-29T12:00'],
    ['Next review at (UTC)', '2026-10-01T12:00']]) fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByLabelText('potassium'));
}
async function prepare() {
  await start(); fill(); fireEvent.click(screen.getByRole('button', { name: 'Prepare request for review' }));
  await screen.findByText(/Prepared and recoverable/);
}
describe('care request UI recovery', () => {
  it('requires explicit organization and a verified pending list before showing a new request', async () => {
    render(<CareRequestPanel {...props} />); expect(mocks.list).not.toHaveBeenCalled();
    expect(screen.queryByRole('form')).toBeNull(); chooseOrg(); expect(screen.queryByRole('form')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Check pending requests' }));
    await screen.findByRole('form'); expect(mocks.list).toHaveBeenCalledWith({ actor_id: id(1), patient_id: id(2), organization_id: id(3), after: null });
  });
  it('freezes exact payload/UUIDs, separates preparation from applying and labels UTC', async () => {
    await prepare(); expect(mocks.apply).not.toHaveBeenCalled();
    const frozen = mocks.prepare.mock.calls[0][0]; expect(frozen.payload).toEqual(input.payload);
    expect(frozen.actor_id).toBe(props.actorId); expect(frozen.request_id).not.toBe(frozen.work_item_id);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm request in Daily Loop' }));
    await screen.findByText(/Request recorded in Daily Loop/);
    expect(mocks.apply).toHaveBeenCalledExactlyOnceWith(frozen);
    expect(screen.getByRole('link', { name: /Open Daily Loop/ })).toHaveAttribute('href', '/dashboard');
    expect(mocks.acknowledge).not.toHaveBeenCalled(); expect(screen.queryByRole('form')).toBeNull();
  });
  it('keeps the same frozen input after a lost preparation response', async () => {
    mocks.prepare.mockRejectedValueOnce(new Error('lost response'));
    await start(); fill(); fireEvent.click(screen.getByRole('button', { name: 'Prepare request for review' }));
    await screen.findByText(CARE_UNCONFIRMED); expect(screen.queryByRole('form')).toBeNull();
    const frozen = mocks.prepare.mock.calls[0][0];
    fireEvent.click(screen.getByRole('button', { name: 'Retry preparation with same ID' }));
    await screen.findByText(/Prepared and recoverable/);
    expect(mocks.prepare).toHaveBeenNthCalledWith(2, frozen); expect(mocks.apply).not.toHaveBeenCalled();
  });
  it('recovers an ambiguous apply read-only before allowing more writes', async () => {
    await prepare(); mocks.apply.mockResolvedValueOnce({ data: null, error: CARE_UNCONFIRMED });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm request in Daily Loop' }));
    await screen.findByText(CARE_UNCONFIRMED); expect(screen.queryByRole('button', { name: 'Confirm request in Daily Loop' })).toBeNull();
    mocks.recover.mockImplementationOnce(async (value) => result(saved(value, 'applied')));
    fireEvent.click(screen.getByRole('button', { name: 'Check saved request' })); await screen.findByText(/Request recorded in Daily Loop/);
    expect(mocks.apply).toHaveBeenCalledOnce(); expect(mocks.recover).toHaveBeenCalledWith(mocks.prepare.mock.calls[0][0]);
  });
  it('acknowledges explicitly then reloads pending requests before allowing creation', async () => {
    await prepare(); fireEvent.click(screen.getByRole('button', { name: 'Confirm request in Daily Loop' }));
    await screen.findByText(/Request recorded in Daily Loop/);
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge receipt (not care completion)' }));
    await screen.findByRole('button', { name: 'Return to pending requests' }); expect(screen.queryByRole('form')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Return to pending requests' })); await screen.findByRole('form');
    expect(mocks.list).toHaveBeenCalledTimes(2);
  });
  it('does not describe a losing cancellation as cancelled', async () => {
    await prepare(); mocks.cancel.mockImplementationOnce(async (value) => result(saved(value, 'applied')));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel prepared request' }));
    await screen.findByText(/Request recorded in Daily Loop/); expect(screen.queryByText(/Preparation cancelled/)).toBeNull();
  });
  it('reloads an existing durable request without preparing or applying it', async () => {
    mocks.list.mockResolvedValueOnce({ data: { items: [saved()], next_cursor: null }, error: null });
    render(<CareRequestPanel {...props} />); chooseOrg(); fireEvent.click(screen.getByRole('button', { name: 'Check pending requests' }));
    fireEvent.click(await screen.findByRole('button', { name: `Review request ${input.request_id}` }));
    await screen.findByText(/Prepared and recoverable/); expect(mocks.recover).toHaveBeenCalledExactlyOnceWith(input);
    expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.apply).not.toHaveBeenCalled();
  });
  it('keeps creation disabled across pagination and a failed tail read', async () => {
    mocks.list.mockResolvedValueOnce({ data: { items: [saved()], next_cursor: input.request_id }, error: null })
      .mockResolvedValueOnce({ data: null, error: 'Read unavailable' });
    render(<CareRequestPanel {...props} />); chooseOrg(); fireEvent.click(screen.getByRole('button', { name: 'Check pending requests' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Load more pending requests' }));
    await screen.findByText('Read unavailable'); expect(screen.queryByRole('form')).toBeNull();
    expect(mocks.list).toHaveBeenLastCalledWith({ actor_id: id(1), patient_id: id(2), organization_id: id(3), after: input.request_id });
  });
  it('never treats a read failure as an empty queue', async () => {
    mocks.list.mockRejectedValue(new Error('offline'));
    render(<CareRequestPanel {...props} />); chooseOrg(); fireEvent.click(screen.getByRole('button', { name: 'Check pending requests' }));
    await screen.findByRole('alert'); expect(screen.queryByRole('form')).toBeNull();
  });
  it.each(['actorId', 'patientId', 'scopeKey'])('discards a late preparation when %s changes', async (field) => {
    let resolve!: (value: unknown) => void;
    mocks.prepare.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const view = render(<CareRequestPanel {...props} />); chooseOrg(); fireEvent.click(screen.getByRole('button', { name: 'Check pending requests' }));
    await screen.findByRole('form'); fill(); fireEvent.click(screen.getByRole('button', { name: 'Prepare request for review' }));
    view.rerender(<CareRequestPanel {...props} {...{ [field]: id(99) }} />);
    await act(async () => resolve(result(saved(mocks.prepare.mock.calls[0][0]))));
    expect(screen.queryByText(/Prepared and recoverable/)).toBeNull(); expect(screen.queryByRole('form')).toBeNull();
    expect(mocks.unsubscribe).toHaveBeenCalled();
  });
  it('discards late reads when the organization changes', async () => {
    let resolve!: (value: unknown) => void; mocks.list.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    render(<CareRequestPanel {...props} />); chooseOrg(); fireEvent.click(screen.getByRole('button', { name: 'Check pending requests' }));
    fireEvent.change(screen.getByLabelText('Request organization'), { target: { value: id(8) } });
    await act(async () => resolve({ data: { items: [saved()], next_cursor: null }, error: null }));
    expect(screen.queryByText(input.payload.purpose)).toBeNull(); expect(screen.queryByRole('form')).toBeNull();
  });
  it('invalidates the complete UI on a live account change and ignores a late error', async () => {
    let reject!: (value: unknown) => void; mocks.prepare.mockImplementationOnce(() => new Promise((_done, fail) => { reject = fail; }));
    await start(); fill(); fireEvent.click(screen.getByRole('button', { name: 'Prepare request for review' }));
    act(() => mocks.subscribe.mock.calls[0][0]('SIGNED_IN', { user: { id: id(99) } }));
    await act(async () => reject(new Error('late response')));
    expect(screen.getByRole('alert')).toHaveTextContent('Your session changed');
    expect(screen.queryByText(CARE_UNCONFIRMED)).toBeNull(); expect(screen.queryByRole('form')).toBeNull();
  });
  it('rejects empty analyte selection and rapid double submit', async () => {
    await start(); fill(); fireEvent.click(screen.getByLabelText('potassium'));
    fireEvent.submit(screen.getByRole('form')); await screen.findByRole('alert'); expect(mocks.prepare).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('potassium'));
    mocks.prepare.mockImplementationOnce(() => new Promise(() => {}));
    const form = screen.getByRole('form'); fireEvent.submit(form); fireEvent.submit(form);
    await waitFor(() => expect(mocks.prepare).toHaveBeenCalledOnce());
  });
  it.each([['Purpose', '   '], ['Source evidence or reference', ' a '],
    ['Request occurred at (UTC)', '2026-09-30T12:00'], ['Next review at (UTC)', '2026-09-28T12:00']])(
    'keeps invalid new %s editable without allocating a frozen request', async (label, value) => {
      await start(); fill(); fireEvent.change(screen.getByLabelText(label), { target: { value } });
      fireEvent.submit(screen.getByRole('form')); await screen.findByRole('alert');
      expect(mocks.prepare).not.toHaveBeenCalled(); expect(screen.getByRole('form')).toBeTruthy();
      expect(screen.queryByRole('region', { name: 'Frozen request' })).toBeNull();
    });
});
