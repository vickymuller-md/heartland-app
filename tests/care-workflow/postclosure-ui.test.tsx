import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ prepare: vi.fn(), recover: vi.fn(), apply: vi.fn(), cancel: vi.fn(), ack: vi.fn(), context: vi.fn(),
  list: vi.fn(), needs: vi.fn(), history: vi.fn(), successors: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn(), ready: vi.fn(), changed: vi.fn() }));
vi.mock('@/lib/care-workflow/postclosure-actions', () => ({ preparePostclosure: mocks.prepare, recoverPostclosure: mocks.recover,
  applyPostclosure: mocks.apply, cancelPostclosure: mocks.cancel, acknowledgePostclosure: mocks.ack, loadPostclosureContext: mocks.context,
  loadPendingPostclosure: mocks.list, loadPostclosureNeeds: mocks.needs, loadPostclosureHistory: mocks.history, loadPostclosureSuccessors: mocks.successors }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { onAuthStateChange: mocks.subscribe } }) }));
import { CarePostclosurePanel } from '@/app/(provider)/patients/[patientId]/_components/care-postclosure-panel';
import { postclosureInputSchema, postclosureStateSchema, type PostclosureContext, type PostclosureInput,
  type PostclosureState } from '@/lib/care-workflow/postclosure-types';
import type { CareWorkflowDetail } from '@/lib/care-workflow/step-types';
const id = (n: number) => `bd000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = '2026-09-29T12:00:00Z', appliedAt = '2026-09-29T12:20:00Z', due = '2026-10-01T12:00:00Z';
const scope = { actor_id: id(1), organization_id: id(3), patient_id: id(2) };
const snapshot: PostclosureContext['snapshot'] = { invalidation_id: id(6), organization_id: id(3), patient_id: id(2), predecessor_work_item_id: id(7),
  closure_event_id: id(20), closure_recorded_at: at, entry_id: id(21), composition_event_id: id(22), analyte: 'potassium', root_id: id(23),
  change_version_id: id(24), change_revision: '2', change_status: 'corrected', change_recorded_at: at, invalidation_recorded_at: at };
const context: PostclosureContext = { ...scope, work_item_id: id(5), workflow_revision: '1', ownership_revision: '3', routing_revision: '0',
  previous_event_id: null, previous_work_item_id: null, successor_created_at: at, successor_accepted_at: at, review_at: due, snapshot };
const workflow: CareWorkflowDetail = { ...scope, work_item_id: id(5), assigned_to: id(1), accepted_by: id(1), accepted_at: at, transfer_pending_to: null,
  ownership_revision: '3', due_at: due, kind: 'laboratory_order', stage: 'requested', revision: '1', requested_analytes: ['potassium'],
  request: { kind: 'laboratory_order', source: 'external_documented', purpose: 'Synthetic follow-up', evidence: 'Original source', occurred_at: at, next_review_at: due, analytes: ['potassium'] },
  events: [{ id: id(9), actor_id: id(1), revision: '1', event_type: 'request_recorded', occurred_at: at, recorded_at: at }],
  next_action: 'Review next step', next_review_at: due, work_status: 'new', steps: [], compositions: [], humans: [], exceptions: [] };
const input = postclosureInputSchema.parse({ ...scope, request_id: id(10), work_item_id: id(5), invalidation_id: id(6), predecessor_work_item_id: id(7),
  expected_revision: '1', expected_ownership_revision: '3', expected_routing_revision: '0', previous_event_id: null,
  payload: { snapshot, occurred_at: at, evidence: '  Original routing evidence  ', reason: 'Explicit delegation reason', review_at: due,
    responsibility_acknowledged: true, supersession_acknowledged: false } });
function saved(value = input, state: PostclosureState['state'] = 'prepared'): PostclosureState {
  return postclosureStateSchema.parse({ ...value, state, recorded_at: '2026-09-29T12:15:00Z', acknowledged_at: null, receipt: state === 'applied' ? {
    request_id: value.request_id, event_id: id(11), invalidation_id: value.invalidation_id, predecessor_work_item_id: value.predecessor_work_item_id,
    work_item_id: value.work_item_id, previous_event_id: value.previous_event_id, routing_revision: String(BigInt(value.expected_routing_revision) + BigInt(1)),
    workflow_revision: value.expected_revision, ownership_revision: value.expected_ownership_revision, recorded_at: appliedAt, review_at: value.payload.review_at,
    delegated: true, clinical_invalidation_resolved: false, clinical_review_recorded: false, communication_confirmed: false, care_completed: false,
  } : null });
}
const need = { invalidation_id: id(6), patient_id: id(2), predecessor_work_item_id: id(7), recorded_at: at, snapshot, current_route: null, routing_state: 'unrouted' };
const props = { scope, workId: id(5), workflow, peersReady: true, refreshToken: 0, onReadiness: mocks.ready, onChanged: mocks.changed };
const ok = (data: unknown) => ({ data, error: null }), failed = { data: null, error: 'Unavailable' };
const page = (items: unknown[] = [], next_cursor: string | null = null) => ok({ items, next_cursor });
function deferred() { let resolve!: (value: unknown) => void;
  const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; }
beforeEach(() => {
  vi.resetAllMocks(); vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-29T13:00:00Z'));
  mocks.subscribe.mockReturnValue({ data: { subscription: { unsubscribe: mocks.unsubscribe } } });
  mocks.list.mockResolvedValue(page()); mocks.context.mockResolvedValue(ok(context));
  mocks.needs.mockResolvedValue(ok({ ...scope, items: [need], next_cursor: null, organization_counts: null }));
  mocks.history.mockResolvedValue(ok({ invalidation_id: id(6), items: [], next_cursor: null }));
  mocks.prepare.mockImplementation(async (value) => ok(saved(value))); mocks.recover.mockImplementation(async (value) => ok(saved(value)));
  mocks.apply.mockImplementation(async (value) => ok(saved(value, 'applied'))); mocks.cancel.mockImplementation(async (value) => ok(saved(value, 'cancelled')));
  mocks.ack.mockImplementation(async (value) => ok({ ...saved(value, 'applied'), acknowledged_at: appliedAt }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function click(name: string) { fireEvent.click(screen.getByRole('button', { name })); }
function change(label: string, value: string) { fireEvent.change(screen.getByLabelText(label), { target: { value } }); }
async function recovery() { click('Check routing pending records'); await waitFor(() => expect(mocks.ready).toHaveBeenLastCalledWith(true)); }
async function target() { click('Read post-closure needs'); await screen.findByLabelText('Post-closure origin to inspect'); change('Post-closure origin to inspect', id(6)); }
async function verify() { click('Verify this successor for selected origin'); await screen.findByLabelText('Verified routing context'); }
async function start() { const view = render(<CarePostclosurePanel {...props} />); await recovery(); await target(); await verify(); return view; }
function fill(check = true) { change('Routing reason', input.payload.reason); change('Routing evidence', input.payload.evidence);
  change('Routing occurrence at (UTC)', '2026-09-29T12:10'); if (check) fireEvent.click(screen.getByRole('checkbox', { name: /acknowledge accepted responsibility/ })); }
function submit() { fireEvent.submit(screen.getByRole('form', { name: 'New post-closure routing' })); }
async function prepare() { const view = await start(); fill(); submit(); await screen.findByText('Routing preparation saved. No delegation recorded by this request.'); return view; }
describe('recoverable explicit post-closure delegation', () => {
  it('requires explicit target and unchecked responsibility with the existing review time; never applies automatically', async () => {
    render(<CarePostclosurePanel {...props} />); await recovery(); click('Read post-closure needs'); await screen.findByLabelText('Post-closure origin to inspect');
    expect(screen.getByLabelText('Post-closure origin to inspect')).toHaveValue(''); expect(mocks.context).not.toHaveBeenCalled();
    change('Post-closure origin to inspect', id(6)); await verify(); expect(screen.getByRole('checkbox')).not.toBeChecked();
    fill(false); submit(); expect(mocks.prepare).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('checkbox')); submit();
    await screen.findByLabelText('Frozen post-closure routing'); const value = mocks.prepare.mock.calls[0][0] as PostclosureInput;
    expect(value.payload.snapshot).toEqual(snapshot); expect(value.payload.evidence).toBe(input.payload.evidence); expect(value.payload.review_at).toBe(due);
    expect(value.expected_routing_revision).toBe('0'); expect(value.payload.supersession_acknowledged).toBe(false); expect(mocks.apply).not.toHaveBeenCalled();
  });
  it('requires separate explicit replacement consent, preserving previous routing identity', async () => {
    mocks.context.mockResolvedValue(ok({ ...context, routing_revision: '2', previous_event_id: id(50), previous_work_item_id: id(51) }));
    await start(); expect(screen.getByRole('checkbox', { name: /explicitly replace/ })).not.toBeChecked(); fill(); submit(); expect(mocks.prepare).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox', { name: /explicitly replace/ })); submit(); await screen.findByLabelText('Frozen post-closure routing');
    expect(mocks.prepare.mock.calls[0][0]).toMatchObject({ expected_routing_revision: '2', previous_event_id: id(50), payload: { supersession_acknowledged: true } });
  });
  it('applies and acknowledges separately without claiming clinical resolution or a fresh workflow', async () => {
    await prepare(); const frozen = mocks.prepare.mock.calls[0][0]; click('Confirm explicit delegation'); await screen.findByText(/Delegation recorded, not clinical resolution/);
    expect(mocks.changed).toHaveBeenCalledOnce(); expect(mocks.ack).not.toHaveBeenCalled(); expect(screen.getByText(/Workflow revision remains 1/)).toBeInTheDocument();
    click('Acknowledge routing receipt'); await screen.findByRole('button', { name: 'Return to routing recovery' }); expect(mocks.ack).toHaveBeenCalledExactlyOnceWith(frozen);
    click('Return to routing recovery'); await recovery(); expect(screen.queryByRole('form')).toBeNull();
  });
  it.each(['cancelled', 'applied'] as const)('handles preparation cancellation that returns %s without falsely erasing origin or prior routing', async (state) => {
    mocks.cancel.mockImplementation(async (value) => ok(saved(value, state))); await prepare(); click('Cancel routing preparation only');
    await screen.findByText(state === 'cancelled' ? 'Routing preparation cancelled. The origin and any earlier routing remain unchanged.' : /Delegation recorded, not clinical resolution/);
  });
  it.each(['prepare', 'apply', 'cancel', 'ack'] as const)('retains exact request identity and frozen evidence after lost %s', async (operation) => {
    mocks[operation].mockResolvedValueOnce(failed); await start(); fill(); submit(); await screen.findByLabelText('Frozen post-closure routing');
    const frozen = mocks.prepare.mock.calls[0][0];
    if (operation !== 'prepare') {
      await screen.findByRole('button', { name: 'Confirm explicit delegation' });
      if (operation === 'ack') { click('Confirm explicit delegation'); await screen.findByRole('button', { name: 'Acknowledge routing receipt' }); click('Acknowledge routing receipt'); }
      else click(operation === 'apply' ? 'Confirm explicit delegation' : 'Cancel routing preparation only');
    }
    await screen.findByText(/Routing outcome is unconfirmed/); click('Check saved routing request'); await screen.findByText(/Routing preparation saved/);
    expect(mocks.recover).toHaveBeenCalledExactlyOnceWith(frozen); expect(mocks.prepare).toHaveBeenCalledOnce();
  });
  it('retries a lost preparation with the same ID and evidence', async () => {
    mocks.prepare.mockResolvedValueOnce(failed); await start(); fill(); submit(); await screen.findByText(/Routing outcome is unconfirmed/);
    const frozen = mocks.prepare.mock.calls[0][0]; click('Retry routing preparation with same ID'); await screen.findByText(/Routing preparation saved/);
    expect(mocks.prepare.mock.calls[1][0]).toEqual(frozen);
  });
  it.each(['future', 'before-creation', 'before-acceptance', 'expired-review', 'blank-evidence'] as const)('rejects %s before creating a request', async (invalid) => {
    if (invalid === 'before-creation') mocks.context.mockResolvedValue(ok({ ...context, successor_created_at: '2026-09-29T12:10:00.000001Z' }));
    if (invalid === 'before-acceptance') mocks.context.mockResolvedValue(ok({ ...context, successor_accepted_at: '2026-09-29T12:10:00.000001Z' }));
    if (invalid === 'expired-review') mocks.context.mockResolvedValue(ok({ ...context, review_at: at }));
    await start(); fill(); if (invalid === 'future') change('Routing occurrence at (UTC)', '2026-09-30T12:00'); if (invalid === 'blank-evidence') change('Routing evidence', '   ');
    submit(); expect(mocks.prepare).not.toHaveBeenCalled(); expect(screen.getByRole('alert')).toHaveTextContent('Provide meaningful reason');
  });
  it('own readiness is independent of blocked peers, failed needs/history and current context reads', async () => {
    const view = render(<CarePostclosurePanel {...props} peersReady={false} />); await recovery(); await target();
    mocks.history.mockResolvedValue(failed); click('Read exact routing history'); await screen.findByText(/Routing history is incomplete/);
    const pending = deferred(); mocks.context.mockReturnValueOnce(pending.promise); click('Verify this successor for selected origin');
    expect(mocks.ready).toHaveBeenLastCalledWith(true); await act(async () => pending.resolve(failed));
    expect(mocks.ready).toHaveBeenLastCalledWith(true); view.rerender(<CarePostclosurePanel {...props} peersReady={false} />);
    await verify(); expect(screen.queryByRole('form')).toBeNull(); expect(mocks.ready).toHaveBeenLastCalledWith(true);
  });
  it('restores readiness after immediate recovery is batched into a single render', async () => {
    await start(); mocks.ready.mockClear(); await act(async () => click('Check routing pending records'));
    expect(mocks.ready).toHaveBeenLastCalledWith(true);
  });
  it.each([null, { ...workflow, work_status: 'closed' }, { ...workflow, assigned_to: id(99), accepted_by: id(99) }, { ...workflow, transfer_pending_to: id(99) }] as (CareWorkflowDetail | null)[])
    ('recovers private requests without fresh clinical detail or current ownership %#', async (current) => {
      mocks.list.mockResolvedValue(page([saved()])); render(<CarePostclosurePanel {...props} workflow={current} peersReady={false} />);
      click('Check routing pending records'); fireEvent.click(await screen.findByRole('button', { name: `Recover routing request ${id(10)}` }));
      await screen.findByText(/Routing preparation saved/); expect(mocks.context).not.toHaveBeenCalled(); expect(mocks.ready).toHaveBeenLastCalledWith(false);
    });
  it('can acknowledge an applied historical receipt with closed workflow and expired deadline', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2027-01-01T00:00:00Z')); mocks.list.mockResolvedValue(page([saved(input, 'applied')]));
    mocks.recover.mockResolvedValue(ok(saved(input, 'applied'))); render(<CarePostclosurePanel {...props} workflow={{ ...workflow, work_status: 'closed' }} peersReady={false} />);
    click('Check routing pending records'); fireEvent.click(await screen.findByRole('button', { name: `Recover routing request ${id(10)}` }));
    await screen.findByRole('button', { name: 'Acknowledge routing receipt' }); click('Acknowledge routing receipt');
    await screen.findByRole('button', { name: 'Return to routing recovery' }); expect(mocks.context).not.toHaveBeenCalled();
  });
  it('retains a recoverable prefix on failed pagination, without declaring readiness', async () => {
    mocks.list.mockResolvedValueOnce(page([saved()], id(10))).mockResolvedValueOnce(failed); render(<CarePostclosurePanel {...props} />);
    click('Check routing pending records'); await screen.findByText(/Routing recovery is incomplete/); expect(mocks.ready).toHaveBeenLastCalledWith(false);
    click(`Recover routing request ${id(10)}`); await screen.findByText(/Routing preparation saved/);
  });
  it('pages other-work requests without blocking this work, but prevents a duplicate target and links its recovery', async () => {
    const other = saved({ ...input, work_item_id: id(99) }); mocks.list.mockResolvedValueOnce(page([other], id(10))).mockResolvedValueOnce(page());
    await start(); expect(mocks.list.mock.calls[1][0].after).toBe(id(10)); expect(mocks.ready).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole('link', { name: `Open other routing follow-up ${id(99)}` })).toHaveAttribute('href', `/patients/${id(2)}/care/${id(99)}?organization=${id(3)}`);
    expect(screen.queryByRole('form')).toBeNull(); expect(screen.getByText(/An own pending request already references this origin/)).toBeInTheDocument();
  });
  it('rejects duplicated recovery pages', async () => {
    mocks.list.mockResolvedValue(page([saved()], id(10))); render(<CarePostclosurePanel {...props} />); click('Check routing pending records');
    await screen.findByText(/Routing recovery is incomplete/); expect(mocks.list).toHaveBeenCalledTimes(2); expect(mocks.ready).toHaveBeenLastCalledWith(false);
  });
  it('invalidates drafts on same-revision workflow replacement', async () => {
    const view = await start(); fill(); view.rerender(<CarePostclosurePanel {...props} workflow={{ ...workflow }} />);
    expect(screen.queryByRole('form')).toBeNull(); expect(screen.queryByLabelText('Verified routing context')).toBeNull();
    await target(); await verify(); expect(screen.getByLabelText('Routing reason')).toHaveValue(''); expect(screen.getByRole('checkbox')).not.toBeChecked();
  });
  it.each(['prepare', 'apply'] as const)('preserves frozen %s response while parent refresh invalidates clinical detail', async (operation) => {
    const pending = deferred(); const view = operation === 'prepare' ? await start() : await prepare(); mocks[operation].mockReturnValueOnce(pending.promise);
    if (operation === 'prepare') { fill(); submit(); } else click('Confirm explicit delegation');
    const frozen = mocks.prepare.mock.calls[0][0]; view.rerender(<CarePostclosurePanel {...props} workflow={null} peersReady={false} refreshToken={1} />);
    await act(async () => pending.resolve(ok(saved(frozen, operation === 'prepare' ? 'prepared' : 'applied'))));
    await screen.findByText(operation === 'prepare' ? /Routing preparation saved/ : /Delegation recorded, not clinical resolution/);
    expect(screen.getByLabelText('Frozen post-closure routing')).toHaveTextContent(frozen.request_id);
  });
  it('discards a late context after same-revision invalidation', async () => {
    const pending = deferred(); const view = render(<CarePostclosurePanel {...props} />);
    await recovery(); await target(); mocks.context.mockReturnValueOnce(pending.promise); click('Verify this successor for selected origin');
    view.rerender(<CarePostclosurePanel {...props} workflow={{ ...workflow }} />); await act(async () => pending.resolve(ok(context)));
    expect(screen.queryByRole('form')).toBeNull(); expect(screen.queryByLabelText('Verified routing context')).toBeNull();
  });
  it.each(['prepare', 'apply', 'list', 'context'] as const)('latches session A→B→A and discards late %s', async (operation) => {
    const pending = deferred();
    if (operation === 'list') { mocks.list.mockReturnValueOnce(pending.promise); render(<CarePostclosurePanel {...props} />); click('Check routing pending records'); }
    else if (operation === 'context') { render(<CarePostclosurePanel {...props} />); await recovery(); await target(); mocks.context.mockReturnValueOnce(pending.promise); click('Verify this successor for selected origin'); }
    else { if (operation === 'prepare') { await start(); fill(); mocks.prepare.mockReturnValueOnce(pending.promise); submit(); }
      else { await prepare(); mocks.apply.mockReturnValueOnce(pending.promise); click('Confirm explicit delegation'); } }
    const callbacks = mocks.subscribe.mock.calls.map((call) => call[0]);
    act(() => { for (const callback of callbacks) { callback('SIGNED_IN', { user: { id: id(99) } }); callback('SIGNED_IN', { user: { id: id(1) } }); } });
    await act(async () => pending.resolve(operation === 'context' ? ok(context) : operation === 'list' ? page([saved()]) : ok(saved(mocks.prepare.mock.calls[0][0], 'applied'))));
    expect(screen.getByRole('alert')).toHaveTextContent('Your session changed'); expect(screen.queryByLabelText('Frozen post-closure routing')).toBeNull();
    expect(screen.queryByLabelText('Verified routing context')).toBeNull(); expect(mocks.ready).toHaveBeenLastCalledWith(false);
  });
  it('scope remount discards a late write rather than replacing its identity in the new scope', async () => {
    const view = await start(), pending = deferred(); mocks.prepare.mockReturnValueOnce(pending.promise); fill(); submit();
    const frozen = mocks.prepare.mock.calls[0][0]; view.rerender(<CarePostclosurePanel {...props} workId={id(99)} workflow={null} />);
    await act(async () => pending.resolve(ok(saved(frozen)))); expect(screen.queryByLabelText('Frozen post-closure routing')).toBeNull(); expect(mocks.changed).not.toHaveBeenCalled();
  });
});
