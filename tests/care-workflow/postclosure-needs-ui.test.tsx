import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ needs: vi.fn(), history: vi.fn(), successors: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn() }));
vi.mock('@/lib/care-workflow/postclosure-actions', () => ({ loadPostclosureNeeds: mocks.needs, loadPostclosureHistory: mocks.history, loadPostclosureSuccessors: mocks.successors }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { onAuthStateChange: mocks.subscribe } }) }));
import { CarePostclosureNeedsPanel, appendPostclosureHistory } from '@/app/(provider)/patients/[patientId]/_components/care-postclosure-needs-panel';
import { postclosureNeedSchema, type PostclosureHistoryItem } from '@/lib/care-workflow/postclosure-types';
const id = (n: number) => `be000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = '2026-09-29T12:00:00Z', due = '2026-10-01T12:00:00Z';
const scope = { actor_id: id(1), organization_id: id(3), patient_id: id(2) };
const snapshot = { invalidation_id: id(6), organization_id: id(3), patient_id: id(2), predecessor_work_item_id: id(7),
  closure_event_id: id(20), closure_recorded_at: at, entry_id: id(21), composition_event_id: id(22), analyte: 'potassium', root_id: id(23),
  change_version_id: id(24), change_revision: '2', change_status: 'corrected', change_recorded_at: at, invalidation_recorded_at: at };
const need = postclosureNeedSchema.parse({ invalidation_id: id(6), patient_id: id(2), predecessor_work_item_id: id(7), recorded_at: at, snapshot, current_route: null, routing_state: 'unrouted' });
const route = { event_id: id(40), routing_revision: '1', work_item_id: id(5), recorded_at: at, assigned_to: id(1), accepted_by: id(1), accepted_at: at,
  transfer_pending_to: null, work_status: 'new', current_due_at: due };
const props = { actorId: id(1), patientId: id(2), scopeKey: 'first', organizations: [{ id: id(3), name: 'Clinic A' }, { id: id(4), name: 'Clinic B' }] };
const ok = (data: unknown) => ({ data, error: null }), failed = { data: null, error: 'Unavailable' };
const page = (items: unknown[] = [need], next_cursor: string | null = null, counts: unknown = null) => ok({ ...scope, items, next_cursor, organization_counts: counts });
function historical(n: number): PostclosureHistoryItem {
  return { event_id: id(100 + n), actor_id: id(1), payload: { snapshot: need.snapshot, occurred_at: at, evidence: `Exact evidence ${n}`, reason: `Reason ${n}`,
    review_at: due, responsibility_acknowledged: true, supersession_acknowledged: n > 1 }, receipt: { event_id: id(100 + n), request_id: id(200 + n),
    invalidation_id: id(6), predecessor_work_item_id: id(7), work_item_id: id(n % 2 ? 5 : 8), previous_event_id: n > 1 ? id(99 + n) : null,
    routing_revision: String(n), workflow_revision: '1', ownership_revision: '3', recorded_at: at, review_at: due, delegated: true,
    clinical_invalidation_resolved: false, clinical_review_recorded: false, communication_confirmed: false, care_completed: false } };
}
const historyPage = (items: PostclosureHistoryItem[], next_cursor: string | null = null) => ({ invalidation_id: id(6), items, next_cursor });
function deferred() { let resolve!: (value: unknown) => void; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; }
beforeEach(() => {
  vi.resetAllMocks(); mocks.subscribe.mockReturnValue({ data: { subscription: { unsubscribe: mocks.unsubscribe } } });
  mocks.needs.mockResolvedValue(page()); mocks.history.mockResolvedValue(ok(historyPage([])));
  mocks.successors.mockResolvedValue(ok({ invalidation_id: id(6), items: [], next_cursor: null }));
});
afterEach(() => cleanup());
function click(name: string) { fireEvent.click(screen.getByRole('button', { name })); }
function change(label: string, value: string) { fireEvent.change(screen.getByLabelText(label), { target: { value } }); }
async function start() { const view = render(<CarePostclosureNeedsPanel {...props} />); change('Organization for post-closure follow-up', id(3));
  click('Read post-closure needs'); await screen.findByLabelText('Post-closure origin to inspect'); change('Post-closure origin to inspect', id(6)); return view; }
describe('minimal authorized post-closure overview', () => {
  it('does not read before explicit organization choice and labels counts organization-wide', async () => {
    mocks.needs.mockResolvedValue(page([need], null, { unrouted: 4, delegated: 3, overdue: 2, responsibility_unavailable: 1, successor_closed: 7 }));
    render(<CarePostclosureNeedsPanel {...props} />); expect(mocks.needs).not.toHaveBeenCalled(); expect(screen.getByLabelText('Organization for post-closure follow-up')).toHaveValue('');
    change('Organization for post-closure follow-up', id(3)); click('Read post-closure needs'); await screen.findByLabelText('Organization-wide routing counts');
    expect(screen.getByText(/not this patient's counts/)).toBeInTheDocument(); expect(mocks.needs).toHaveBeenCalledExactlyOnceWith({ ...scope, after: null });
    change('Post-closure origin to inspect', id(6)); expect(screen.getByLabelText('Immutable post-closure origin')).toHaveTextContent(id(7));
  });
  it('preserves an opaque organization cursor across an empty filtered patient page', async () => {
    mocks.needs.mockResolvedValueOnce(page([], id(50))).mockResolvedValueOnce(page([need])); render(<CarePostclosureNeedsPanel {...props} />);
    change('Organization for post-closure follow-up', id(3)); click('Read post-closure needs'); await screen.findByText(/Patient read incomplete/);
    expect(screen.queryByText(/No matching post-closure need/)).toBeNull(); click('Read next needs page'); await screen.findByLabelText('Post-closure origin to inspect');
    expect(mocks.needs.mock.calls[1][0].after).toBe(id(50)); expect(screen.getByText(/Patient read complete/)).toBeInTheDocument();
  });
  it.each(['delegated', 'overdue', 'responsibility_unavailable', 'successor_closed'] as const)('displays %s separately from immutable origin and historical receipt', async (state) => {
    const current_route = { ...route, work_status: state === 'successor_closed' ? 'closed' : 'new' };
    mocks.needs.mockResolvedValue(page([postclosureNeedSchema.parse({ ...need, current_route, routing_state: state })])); await start();
    expect(screen.getByLabelText('Immutable post-closure origin')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: `Open current successor ${id(5)}` })).toHaveAttribute('href', `/patients/${id(2)}/care/${id(5)}?organization=${id(3)}`);
    expect(screen.getByText(/Delegation is not clinical reconciliation/)).toBeInTheDocument();
  });
  it('shows pending transfer separately while retaining accepted responsibility and delegated state', async () => {
    mocks.needs.mockResolvedValue(page([postclosureNeedSchema.parse({ ...need, current_route: { ...route, transfer_pending_to: id(99) }, routing_state: 'delegated' })]));
    await start(); expect(screen.getByRole('heading', { name: 'Delegated — not resolved (when loaded)' })).toBeInTheDocument();
    expect(screen.getByText(/Assigned responsibility:/)).toHaveTextContent(id(1)); expect(screen.getByText(/Accepted by:/)).toHaveTextContent(id(1));
    expect(screen.getByText(/Transfer offer pending:/)).toHaveTextContent(id(99)); expect(screen.getByText(/Transfer offer pending:/)).toHaveTextContent('not yet transferred');
  });
  it('does not turn failed tail or duplicate pages into an empty or complete read', async () => {
    mocks.needs.mockResolvedValueOnce(page([need], id(50))).mockResolvedValueOnce(page([need])); await start(); click('Read next needs page');
    await screen.findByText(/The needs read is incomplete/); expect(screen.queryByText(/Patient read complete/)).toBeNull();
    expect(screen.getByLabelText('Post-closure origin to inspect')).toBeInTheDocument();
  });
  it('offers existing eligible successors without creating or automatically routing one', async () => {
    mocks.successors.mockResolvedValue(ok({ invalidation_id: id(6), items: [{ work_item_id: id(5), created_at: at, accepted_at: at,
      workflow_revision: '1', ownership_revision: '3', review_at: due }], next_cursor: null }));
    await start(); expect(mocks.successors).not.toHaveBeenCalled(); click('Find eligible accepted successors');
    expect(await screen.findByRole('link', { name: `Open eligible successor ${id(5)}` })).toHaveAttribute('href', `/patients/${id(2)}/care/${id(5)}?organization=${id(3)}`);
    expect(screen.getByText(/Nothing is created, assigned or routed automatically/)).toBeInTheDocument();
  });
  it('failed successor pagination preserves available links without claiming an empty complete list', async () => {
    const candidate = { work_item_id: id(5), created_at: at, accepted_at: at, workflow_revision: '1', ownership_revision: '3', review_at: due };
    mocks.successors.mockResolvedValueOnce(ok({ invalidation_id: id(6), items: [candidate], next_cursor: id(5) })).mockResolvedValueOnce(failed);
    await start(); click('Find eligible accepted successors'); await screen.findByRole('button', { name: 'Read more eligible successors' }); click('Read more eligible successors');
    await screen.findByText(/Candidate read is incomplete/); expect(screen.getByRole('link', { name: `Open eligible successor ${id(5)}` })).toBeInTheDocument();
    expect(screen.queryByText(/Candidate read complete/)).toBeNull();
  });
  it('retains the verified history prefix after tail failure', async () => {
    const prefix = Array.from({ length: 25 }, (_, n) => historical(n + 1));
    mocks.history.mockResolvedValueOnce(ok(historyPage(prefix, '25'))).mockResolvedValueOnce(failed); await start(); click('Read exact routing history');
    await screen.findByText(/Routing history is incomplete/); expect(screen.getAllByText(/Historical routing revision:/)).toHaveLength(25);
    expect(screen.queryByText(/Routing history read complete/)).toBeNull(); expect(mocks.history.mock.calls[1][0].after).toBe('25');
  });
  it('continues history across pages with exact chain and allows A→B→A routing without requiring current head equality', async () => {
    const prefix = Array.from({ length: 25 }, (_, n) => historical(n + 1));
    mocks.history.mockResolvedValueOnce(ok(historyPage(prefix, '25'))).mockResolvedValueOnce(ok(historyPage([historical(26)])));
    await start(); click('Read exact routing history'); await screen.findByText(/26 historical events verified/);
    expect(screen.getAllByText(/Historical routing revision:/)).toHaveLength(26); expect(screen.getByRole('heading', { name: 'Not routed (when loaded)' })).toBeInTheDocument();
  });
  it.each(['revision', 'previous', 'same-child', 'snapshot', 'time', 'event-duplicate', 'request-duplicate'] as const)('rejects cross-page %s without corrupting verified prefix', async (field) => {
    const prefix = Array.from({ length: 25 }, (_, n) => historical(n + 1)), row = structuredClone(historical(26));
    if (field === 'revision') row.receipt.routing_revision = '27';
    if (field === 'previous') row.receipt.previous_event_id = id(999);
    if (field === 'same-child') row.receipt.work_item_id = prefix[24].receipt.work_item_id;
    if (field === 'snapshot') row.payload.snapshot.root_id = id(999);
    if (field === 'time') prefix.forEach((old) => { old.receipt.recorded_at = '2026-09-29T12:10:00Z'; });
    if (field === 'event-duplicate') { row.event_id = prefix[0].event_id; row.receipt.event_id = row.event_id; }
    if (field === 'request-duplicate') row.receipt.request_id = prefix[0].receipt.request_id;
    expect(() => appendPostclosureHistory(prefix, historyPage([row]))).toThrow(); expect(prefix).toHaveLength(25);
    mocks.history.mockResolvedValueOnce(ok(historyPage(prefix, '25'))).mockResolvedValueOnce(ok(historyPage([row])));
    await start(); click('Read exact routing history'); await screen.findByText(/Routing history is incomplete/);
    expect(screen.getAllByText(/Historical routing revision:/)).toHaveLength(25);
  });
  it.each(['needs', 'history', 'successors'] as const)('discards late %s when organization changes', async (operation) => {
    const pending = deferred();
    if (operation === 'needs') { mocks.needs.mockReturnValueOnce(pending.promise); render(<CarePostclosureNeedsPanel {...props} />);
      change('Organization for post-closure follow-up', id(3)); click('Read post-closure needs'); }
    else { await start(); mocks[operation].mockReturnValueOnce(pending.promise); click(operation === 'history' ? 'Read exact routing history' : 'Find eligible accepted successors'); }
    change('Organization for post-closure follow-up', id(4)); await act(async () => pending.resolve(operation === 'needs' ? page() : ok(historyPage([historical(1)]))));
    expect(screen.queryByLabelText('Immutable post-closure origin')).toBeNull(); expect(screen.queryByText(/Historical routing revision:/)).toBeNull();
    expect(within(screen.getByLabelText('Patient post-closure needs')).queryAllByRole('link')).toHaveLength(0);
  });
  it('latches A→B→A session changes even if original actor returns', async () => {
    await start(); const callbacks = mocks.subscribe.mock.calls.map((call) => call[0]);
    act(() => { for (const callback of callbacks) { callback('SIGNED_IN', { user: { id: id(99) } }); callback('SIGNED_IN', { user: { id: id(1) } }); } });
    expect(screen.getByRole('alert')).toHaveTextContent('Your session changed'); expect(screen.queryByLabelText('Immutable post-closure origin')).toBeNull();
  });
  it.each(['patientId', 'actorId', 'scopeKey'] as const)('resets organization and displayed data on %s remount', async (key) => {
    const view = await start(); view.rerender(<CarePostclosureNeedsPanel {...props} {...{ [key]: key === 'scopeKey' ? 'second' : id(99) }} />);
    expect(screen.getByLabelText('Organization for post-closure follow-up')).toHaveValue(''); expect(screen.queryByLabelText('Immutable post-closure origin')).toBeNull();
  });
});
