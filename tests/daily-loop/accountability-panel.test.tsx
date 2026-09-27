import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { designation, transfer, save, offer } = vi.hoisted(() => ({ designation: vi.fn(), transfer: vi.fn(), save: vi.fn(), offer: vi.fn() }));
vi.mock('@/lib/daily-loop/ownership-context-actions', () => ({ loadDesignationContext: designation, loadTransferContext: transfer }));
vi.mock('@/lib/daily-loop/actions', () => ({ designatePatientAccountable: save, assignWorkItem: offer }));
import { AccountabilityPanel } from '@/app/(provider)/patients/[patientId]/_components/accountability-panel';
import { OwnershipSelector } from '@/components/ownership-selector';
import { OWNERSHIP_CONTEXT_UNAVAILABLE, OWNERSHIP_WRITE_UNCONFIRMED } from '@/lib/daily-loop/ownership-context';
const id = (n: number) => `52000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const organizations = [{ id: id(1), name: 'Clinic A' }, { id: id(2), name: 'Clinic B' }];
const current = { id: id(4), name: 'Eligible colleague' };
const context = { organization_id: id(1), patient_id: id(3), current, targets: [current], next_cursor: null };
const transferContext = { work_item_id: id(5), patient_id: id(3), current_assignee: id(6), current_revision: '0', eligible: true, pending_recipient: null, targets: [current], next_cursor: null };
beforeEach(() => {
  vi.resetAllMocks(); designation.mockResolvedValue({ data: context, error: null });
  transfer.mockResolvedValue({ data: transferContext, error: null });
  save.mockResolvedValue({ success: true }); offer.mockResolvedValue({ success: true });
});
afterEach(cleanup);
function panel(scopeKey = 'actor:snapshot1', patientId = id(3)) {
  return <AccountabilityPanel scopeKey={scopeKey} patientId={patientId} organizations={organizations} />;
}
async function loadDesignation() { fireEvent.click(screen.getByRole('button', { name: 'Load current responsibility' })); await screen.findByTestId('accountability-current'); }
async function loadOffer() { fireEvent.click(screen.getByRole('button', { name: 'Review eligible transfer recipients' })); await screen.findByLabelText('Transfer recipient'); }
describe('current authorized ownership selectors', () => {
  it('does not imply no designation before a successful current read', async () => {
    render(panel()); expect(screen.queryByTestId('accountability-current')).toBeNull(); expect(designation).not.toHaveBeenCalled();
    await loadDesignation();
    expect(screen.getByTestId('accountability-current')).toHaveTextContent('Currently designated in this organization: Eligible colleague');
    expect(screen.getByLabelText('Accountable provider')).toHaveValue(id(4)); expect(save).not.toHaveBeenCalled();
  });
  it('shows no designation only after an explicit null result', async () => {
    designation.mockResolvedValueOnce({ data: { ...context, current: null }, error: null });
    render(panel()); await loadDesignation(); expect(screen.getByText('No accountable provider designated in this organization.')).toBeTruthy();
  });
  it('retains a current ineligible designation without preselecting or replacing it', async () => {
    designation.mockResolvedValueOnce({ data: { ...context, current: { id: id(99), name: 'Historical owner' } }, error: null });
    render(panel()); await loadDesignation();
    expect(screen.getByLabelText('Accountable provider')).toHaveValue('');
    expect(screen.getByText(/not selectable on this eligible page/)).toBeTruthy(); expect(save).not.toHaveBeenCalled();
  });
  it('separates organizations and discards a late first-organization read', async () => {
    let done!: (value: unknown) => void;
    designation.mockImplementationOnce(() => new Promise((resolve) => { done = resolve; }));
    render(panel()); fireEvent.click(screen.getByRole('button', { name: 'Load current responsibility' }));
    fireEvent.change(screen.getByLabelText('Designation organization'), { target: { value: id(2) } });
    await act(async () => done({ data: context, error: null }));
    expect(screen.queryByText(/Currently designated/)).toBeNull();
    designation.mockResolvedValueOnce({ data: { ...context, organization_id: id(2), current: null }, error: null });
    await loadDesignation();
    expect(designation).toHaveBeenLastCalledWith({ organizationId: id(2), patientId: id(3), after: null });
  });
  it.each(['different-actor:snapshot2', 'actor:snapshot2'])('clears names and stale reads for %s', async (scopeKey) => {
    const view = render(panel()); await loadDesignation();
    let done!: (value: unknown) => void;
    designation.mockImplementationOnce(() => new Promise((resolve) => { done = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: 'Load current responsibility' }));
    view.rerender(panel(scopeKey)); await act(async () => done({ data: context, error: null }));
    expect(screen.queryByText(/Eligible colleague/)).toBeNull(); expect(screen.queryByRole('button', { name: 'Save designation' })).toBeNull();
  });
  it('clears the previous patient context', async () => {
    const view = render(panel()); await loadDesignation(); view.rerender(panel('actor:snapshot1', id(33)));
    expect(screen.queryByText(/Currently designated/)).toBeNull();
  });
  it('does not report a read failure as nobody designated', async () => {
    designation.mockResolvedValueOnce({ data: null, error: OWNERSHIP_CONTEXT_UNAVAILABLE });
    render(panel()); fireEvent.click(screen.getByRole('button', { name: 'Load current responsibility' }));
    await screen.findByRole('alert'); expect(screen.queryByText(/No accountable provider designated/)).toBeNull();
  });
  it('requires explicit offer submission after selecting a server-eligible recipient', async () => {
    render(<OwnershipSelector scopeKey="actor:snapshot1" kind="offer" workItemId={id(5)} />); await loadOffer();
    fireEvent.change(screen.getByLabelText('Transfer recipient'), { target: { value: id(4) } }); expect(offer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm transfer offer' }));
    await screen.findByText(/Transfer offer recorded/);
    expect(offer).toHaveBeenCalledWith({ workItemId: id(5), patientId: id(3), assigneeId: id(4) });
    expect(screen.queryByRole('button', { name: 'Confirm transfer offer' })).toBeNull();
  });
  it.each(['returned-error', 'thrown-error'])('blocks another write after %s until fresh successful read', async (failure) => {
    if (failure === 'returned-error') offer.mockResolvedValueOnce({ success: false, error: 'transport error returned by SDK' });
    else offer.mockRejectedValueOnce(new Error('lost response'));
    render(<OwnershipSelector scopeKey="actor:snapshot1" kind="offer" workItemId={id(5)} />); await loadOffer();
    fireEvent.change(screen.getByLabelText('Transfer recipient'), { target: { value: id(4) } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm transfer offer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(OWNERSHIP_WRITE_UNCONFIRMED);
    expect(screen.queryByRole('button', { name: 'Confirm transfer offer' })).toBeNull(); expect(offer).toHaveBeenCalledOnce();
    transfer.mockResolvedValueOnce({ data: { ...transferContext, eligible: false, pending_recipient: id(4), targets: [] }, error: null });
    fireEvent.click(screen.getByRole('button', { name: 'Review eligible transfer recipients' }));
    await screen.findByText(/An offer is already pending/);
    expect(screen.queryByLabelText('Transfer recipient')).toBeNull(); expect(offer).toHaveBeenCalledOnce();
  });
  it('does not resubmit an already pending offer', async () => {
    transfer.mockResolvedValueOnce({ data: { ...transferContext, eligible: false, pending_recipient: id(4), targets: [] }, error: null });
    render(<OwnershipSelector scopeKey="actor:snapshot1" kind="offer" workItemId={id(5)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review eligible transfer recipients' }));
    await screen.findByText(/An offer is already pending/);
    expect(screen.queryByRole('button', { name: 'Confirm transfer offer' })).toBeNull(); expect(offer).not.toHaveBeenCalled();
  });
  it('uses pagination without keeping the preceding recipient selection', async () => {
    transfer.mockResolvedValueOnce({ data: { ...transferContext, next_cursor: id(4) }, error: null });
    render(<OwnershipSelector scopeKey="actor:snapshot1" kind="offer" workItemId={id(5)} />); await loadOffer();
    fireEvent.change(screen.getByLabelText('Transfer recipient'), { target: { value: id(4) } });
    fireEvent.click(screen.getByRole('button', { name: 'Next eligible recipients' }));
    await waitFor(() => expect(transfer).toHaveBeenLastCalledWith({ workItemId: id(5), after: id(4) }));
    await screen.findByLabelText('Transfer recipient'); expect(screen.getByLabelText('Transfer recipient')).toHaveValue('');
  });
  it('shows an empty eligible page without treating it as a failed read', async () => {
    designation.mockResolvedValueOnce({ data: { ...context, targets: [] }, error: null });
    render(panel()); await loadDesignation(); expect(screen.getByText('No eligible recipient is visible on this page.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull(); expect(screen.queryByRole('button', { name: 'Save designation' })).toBeNull();
  });
  it('does not retry designation after a lost confirmation and rereads the committed current state', async () => {
    save.mockResolvedValueOnce({ success: false });
    render(panel()); await loadDesignation(); fireEvent.click(screen.getByRole('button', { name: 'Save designation' }));
    await screen.findByRole('alert'); expect(screen.queryByTestId('accountability-current')).toBeNull();
    await loadDesignation(); expect(save).toHaveBeenCalledOnce();
    expect(screen.getByTestId('accountability-current')).toHaveTextContent('Eligible colleague');
  });
  it('ignores late write confirmation after a principal change and blocks a double submit', async () => {
    let done!: (value: unknown) => void;
    save.mockImplementationOnce(() => new Promise((resolve) => { done = resolve; }));
    const view = render(panel()); await loadDesignation();
    const button = screen.getByRole('button', { name: 'Save designation' });
    fireEvent.click(button); fireEvent.click(button); expect(save).toHaveBeenCalledOnce();
    view.rerender(panel('other-actor:snapshot2'));
    await act(async () => done({ success: true }));
    expect(screen.queryByText(/Designation recorded/)).toBeNull(); expect(screen.queryByTestId('accountability-current')).toBeNull();
  });
});
