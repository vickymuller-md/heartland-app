import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { load, submit, refresh, finish, list } = vi.hoisted(() => ({ load: vi.fn(), submit: vi.fn(), refresh: vi.fn(), finish: vi.fn(), list: vi.fn() }));
vi.mock('@/lib/daily-loop/reassignment-actions', () => ({ loadWorkReassignmentContext: load, finishWorkReassignment: finish, loadMyReassignmentRequests: list }));
vi.mock('@/lib/daily-loop/actions', () => ({ reassignWorkItem: submit }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
import { WorkReassignment } from '@/components/work-reassignment';
import { ReassignmentRequestsPanel } from '@/app/(provider)/team/reassignment-requests/requests-panel';
import { REASSIGNMENT_UNKNOWN, REASSIGNMENT_UNAVAILABLE } from '@/lib/daily-loop/reassignment';
const id = (n: number) => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const context = { work_item_id: id(2), patient_id: id(3), current_assignee: id(4), current_revision: '0', eligible: true, targets: [{ id: id(5), name: 'Eligible recipient' }], next_cursor: null };
const receipt = { request_id: id(1), event_id: id(6), work_item_id: id(2), recorded_assignee: id(5), recorded_revision: '1', recorded_at: '2026-09-24T12:00:00Z', acceptance_recorded: false };
const request = { requestId: id(1), workItemId: id(2), patientId: id(3), expectedAssignee: id(4), expectedRevision: '0', assigneeId: id(5), reason: 'Synthetic reviewed handover' };
const prepared = { state: 'prepared' as const, request, receipt: null };
const applied = { state: 'applied' as const, request, receipt: { ...receipt, acceptance_recorded: false as const } };
beforeEach(() => { vi.resetAllMocks(); load.mockResolvedValue({ data: context, error: null }); submit.mockResolvedValue({ success: true, receipt, recovery: applied }); });
afterEach(cleanup);
async function open() {
  fireEvent.click(screen.getByRole('button', { name: 'Reassign' }));
  await screen.findByLabelText('Reassign to');
}
function fill() {
  fireEvent.change(screen.getByLabelText('Reassign to'), { target: { value: id(5) } });
  fireEvent.change(screen.getByLabelText('Why is this being reassigned?'), { target: { value: 'Synthetic reviewed handover' } });
}
describe('recoverable reassignment control', () => {
  it('does not read or mutate before explicit review', () => {
    render(<WorkReassignment scopeKey="actor:snapshot1" workItemId={id(2)} />); expect(load).not.toHaveBeenCalled(); expect(submit).not.toHaveBeenCalled();
  });
  it('uses the observed owner and revision, and labels the receipt as historical', async () => {
    render(<WorkReassignment scopeKey="actor:snapshot1" workItemId={id(2)} />); await open(); fill();
    fireEvent.click(screen.getByRole('button', { name: 'Reassign item' }));
    await screen.findByText(/Reassignment recorded at/);
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ expectedAssignee: id(4), expectedRevision: '0', assigneeId: id(5), workItemId: id(2) }));
    expect(screen.getByText(/not necessarily the current owner/)).toBeTruthy();
    expect(screen.getByText(/Acceptance was not recorded/)).toBeTruthy(); expect(refresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh current work' })); expect(refresh).toHaveBeenCalledOnce();
  });
  it('preserves exactly the same request and payload after a lost response', async () => {
    submit.mockRejectedValueOnce(new Error('private transport'));
    render(<WorkReassignment scopeKey="actor:snapshot1" workItemId={id(2)} />); await open(); fill();
    fireEvent.click(screen.getByRole('button', { name: 'Reassign item' }));
    await screen.findByRole('button', { name: 'Recover this same request' });
    expect(screen.getByRole('alert').textContent).toBe(REASSIGNMENT_UNKNOWN);
    expect(screen.queryByLabelText('Reassign to')).toBeNull(); expect(screen.queryByRole('button', { name: 'Refresh ownership' })).toBeNull();
    const request = submit.mock.calls[0][0];
    fireEvent.click(screen.getByRole('button', { name: 'Recover this same request' }));
    await screen.findByText(/Reassignment recorded at/);
    expect(submit.mock.calls[1][0]).toEqual(request); expect(submit.mock.calls[1][0]).toBe(request);
  });
  it('blocks a second click while the first write is unresolved', async () => {
    let finish!: (value: unknown) => void;
    submit.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    render(<WorkReassignment scopeKey="actor:snapshot1" workItemId={id(2)} />); await open(); fill();
    const button = screen.getByRole('button', { name: 'Reassign item' });
    fireEvent.click(button); fireEvent.click(button);
    expect(submit).toHaveBeenCalledOnce(); expect(screen.getByRole('status').textContent).toContain('request identity');
    await act(async () => finish({ success: true, receipt, recovery: applied }));
  });
  it('requires another current read after a rejected stale revision', async () => {
    submit.mockResolvedValueOnce({ success: false, status: 'rejected', error: 'Ownership changed' });
    render(<WorkReassignment scopeKey="actor:snapshot1" workItemId={id(2)} />); await open(); fill();
    fireEvent.click(screen.getByRole('button', { name: 'Reassign item' }));
    await screen.findByRole('button', { name: 'Refresh and review again' });
    expect(screen.queryByRole('button', { name: 'Recover this same request' })).toBeNull();
    load.mockResolvedValueOnce({ data: { ...context, current_revision: '5' }, error: null });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh and review again' }));
    await screen.findByLabelText('Reassign to'); fill(); fireEvent.click(screen.getByRole('button', { name: 'Reassign item' }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(submit.mock.calls[1][0].expectedRevision).toBe('5');
    expect(submit.mock.calls[1][0].requestId).not.toBe(submit.mock.calls[0][0].requestId);
  });
  it('uses the server recipient cursor and clears the previous selection', async () => {
    load.mockResolvedValueOnce({ data: { ...context, next_cursor: id(5) }, error: null });
    render(<WorkReassignment scopeKey="actor:snapshot1" workItemId={id(2)} />); await open(); fill();
    fireEvent.click(screen.getByRole('button', { name: 'Next recipients' }));
    await waitFor(() => expect(load).toHaveBeenLastCalledWith({ workItemId: id(2), after: id(5) }));
    await screen.findByLabelText('Reassign to'); expect((screen.getByLabelText('Reassign to') as HTMLSelectElement).value).toBe('');
  });
  it('distinguishes no eligible targets from unavailable access', async () => {
    load.mockResolvedValueOnce({ data: { ...context, targets: [] }, error: null });
    render(<WorkReassignment scopeKey="actor:snapshot1" workItemId={id(2)} />); await open();
    expect(screen.getByText(/No eligible recipient is visible/)).toBeTruthy();
    load.mockRejectedValueOnce(new Error('private denied'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh ownership' }));
    await screen.findByRole('alert'); expect(screen.getByRole('alert').textContent).toBe(REASSIGNMENT_UNAVAILABLE);
    expect(screen.queryByText(/No eligible recipient is visible/)).toBeNull();
  });
  it('cannot adopt a legacy item or reopen closed work', async () => {
    load.mockResolvedValueOnce({ data: { ...context, eligible: false, targets: [] }, error: null });
    render(<WorkReassignment scopeKey="actor:snapshot1" workItemId={id(2)} />); fireEvent.click(screen.getByRole('button', { name: 'Reassign' }));
    await screen.findByText(/cannot adopt, merge or reopen/); expect(screen.queryByRole('button', { name: 'Reassign item' })).toBeNull();
  });
  it('does not restore a previous item after its in-flight read finishes', async () => {
    let finish!: (value: unknown) => void;
    load.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const view = render(<WorkReassignment scopeKey="actor:snapshot1" workItemId={id(2)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reassign' }));
    view.rerender(<WorkReassignment scopeKey="actor:snapshot1" workItemId={id(9)} />);
    await act(async () => finish({ data: context, error: null }));
    expect(screen.queryByLabelText('Reassign to')).toBeNull();
  });
  it('invalidates recipients and late results on the same item after a new authenticated snapshot', async () => {
    const view = render(<WorkReassignment scopeKey="actor:snapshot1" workItemId={id(2)} />); await open();
    let resolve!: (value: unknown) => void;
    load.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh ownership' }));
    view.rerender(<WorkReassignment scopeKey="actor:snapshot2" workItemId={id(2)} />);
    await act(async () => resolve({ data: context, error: null }));
    expect(screen.queryByText('Eligible recipient')).toBeNull();
    load.mockResolvedValueOnce({ data: null, error: REASSIGNMENT_UNAVAILABLE });
    fireEvent.click(screen.getByRole('button', { name: 'Reassign' }));
    await screen.findByRole('alert'); expect(screen.queryByLabelText('Reassign to')).toBeNull();
  });
  it('recovers a committed request after unmount without creating a new command or acknowledging automatically', async () => {
    const view = render(<WorkReassignment scopeKey="actor:snapshot1" workItemId={id(2)} />); await open(); fill();
    submit.mockResolvedValueOnce({ success: false, status: 'unknown', error: REASSIGNMENT_UNKNOWN, recovery: prepared });
    fireEvent.click(screen.getByRole('button', { name: 'Reassign item' }));
    await screen.findByText(/Leaving this page does not discard/); view.unmount();
    load.mockResolvedValueOnce({ data: null, recovery: applied, error: null });
    render(<WorkReassignment scopeKey="actor:snapshot2" workItemId={id(2)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reassign' }));
    await screen.findByText(/Reassignment recorded at/);
    expect(submit).toHaveBeenCalledOnce(); expect(finish).not.toHaveBeenCalled();
  });
  it('can recover a receipt from the independent page after the work item leaves both queues', async () => {
    render(<ReassignmentRequestsPanel scopeKey="actor:snapshot1" initial={{ data: { items: [applied], inaccessible_count: 1, next_cursor: null }, error: null }} />);
    expect(screen.getByText(/Reassignment recorded at/)).toBeTruthy();
    expect(screen.getByText(/1 of your pending requests cannot be displayed/)).toBeTruthy();
    expect(finish).not.toHaveBeenCalled();
    finish.mockResolvedValueOnce({ data: { ...applied, state: 'seen' }, error: null });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm I reviewed this technical receipt' }));
    await screen.findByText(/Technical receipt review recorded/);
    expect(finish).toHaveBeenCalledWith({ requestId: id(1), receiptId: id(6), cancel: false });
  });
  it('shows the winning receipt instead of claiming cancellation when apply won the race', async () => {
    load.mockResolvedValueOnce({ data: null, recovery: prepared, error: null });
    render(<WorkReassignment scopeKey="actor:snapshot1" workItemId={id(2)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reassign' }));
    await screen.findByRole('button', { name: 'Cancel only if not applied' });
    finish.mockResolvedValueOnce({ data: applied, error: null });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel only if not applied' }));
    await screen.findByText(/Reassignment recorded at/);
    expect(screen.queryByText(/Request cancelled without/)).toBeNull();
  });
  it('clears a previous principal and ignores their in-flight pagination response', async () => {
    const initial = { data: { items: [applied], inaccessible_count: 0, next_cursor: id(99) }, error: null };
    let resolve!: (value: unknown) => void;
    list.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const view = render(<ReassignmentRequestsPanel scopeKey="actor1:snapshot1" initial={initial} />);
    fireEvent.click(screen.getByRole('button', { name: 'Next requests' }));
    view.rerender(<ReassignmentRequestsPanel scopeKey="actor2:snapshot2" initial={{ data: { items: [], inaccessible_count: 0, next_cursor: null }, error: null }} />);
    await act(async () => resolve(initial));
    expect(screen.queryByText(request.reason)).toBeNull(); expect(screen.getByText(/No pending requests are visible/)).toBeTruthy();
  });
  it('identifies original patients and items when reasons and targets are identical', () => {
    const other = { ...prepared, request: { ...request, requestId: id(11), workItemId: id(12), patientId: id(13) } };
    render(<ReassignmentRequestsPanel scopeKey="actor:snapshot1" initial={{ data: { items: [prepared, other], inaccessible_count: 0, next_cursor: null }, error: null }} />);
    expect(screen.getAllByRole('link', { name: 'Review the original patient workspace' }).map((link) => link.getAttribute('href'))).toEqual([`/patients/${id(3)}`, `/patients/${id(13)}`]);
    expect(screen.getByText(id(2))).toBeTruthy(); expect(screen.getByText(id(12))).toBeTruthy();
  });
});
