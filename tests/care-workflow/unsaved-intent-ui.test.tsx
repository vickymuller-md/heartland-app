import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ prepare: vi.fn(), recover: vi.fn(), apply: vi.fn(), cancel: vi.fn(), ack: vi.fn(), context: vi.fn(),
  list: vi.fn(), targets: vi.fn(), history: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn(), ready: vi.fn(), changed: vi.fn() }));
vi.mock('@/lib/care-workflow/unsaved-intent-actions', () => ({ prepareUnsaved: mocks.prepare, recoverUnsaved: mocks.recover,
  applyUnsaved: mocks.apply, cancelUnsaved: mocks.cancel, acknowledgeUnsaved: mocks.ack,
  loadUnsavedContext: mocks.context, loadPendingUnsaved: mocks.list, loadUnsavedHistory: mocks.history }));
vi.mock('@/lib/care-workflow/composition-actions', () => ({ loadCompositionIntentions: mocks.targets }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { onAuthStateChange: mocks.subscribe } }) }));
import { CareUnsavedIntentPanel } from '@/app/(provider)/patients/[patientId]/_components/care-unsaved-intent-panel';
import { unsavedInputSchema, unsavedStateSchema, type UnsavedContext, type UnsavedInput, type UnsavedState } from '@/lib/care-workflow/unsaved-intent-types';
import type { CareWorkflowDetail } from '@/lib/care-workflow/step-types';
const id = (n: number) => `bc000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = '2026-09-29T12:00:00Z', appliedAt = '2026-09-29T12:20:00Z', due = '2026-10-01T12:00:00Z';
const scope = { actor_id: id(1), organization_id: id(3), patient_id: id(2) };
const snapshot: UnsavedContext['snapshot'] = { intent_id: id(6), recorded_at: at, submission_status: 'awaiting_save', submission_cancelled_at: null };
const context: UnsavedContext = { ...scope, work_item_id: id(5), workflow_revision: '1', ownership_revision: '3', snapshot };
const workflow: CareWorkflowDetail = { ...scope, work_item_id: id(5), assigned_to: id(1), accepted_by: id(1), accepted_at: at, transfer_pending_to: null,
  ownership_revision: '3', due_at: due, kind: 'laboratory_order', stage: 'requested', revision: '1', requested_analytes: ['potassium'],
  request: { kind: 'laboratory_order', source: 'external_documented', purpose: 'Synthetic follow-up', evidence: 'Original source', occurred_at: at, next_review_at: due, analytes: ['potassium'] },
  events: [{ id: id(9), actor_id: id(1), revision: '1', event_type: 'request_recorded', occurred_at: at, recorded_at: at }],
  next_action: 'Review next step', next_review_at: due, work_status: 'new', steps: [], compositions: [], humans: [], exceptions: [] };
const input = unsavedInputSchema.parse({ ...scope, request_id: id(10), work_item_id: id(5), intent_id: id(6), expected_revision: '1', expected_ownership_revision: '3',
  payload: { snapshot, occurred_at: at, evidence: '  Original administrative evidence  ', reason: 'Explicit cancellation reason', unsaved_cancellation_acknowledged: true } });
function saved(value = input, state: UnsavedState['state'] = 'prepared'): UnsavedState {
  return unsavedStateSchema.parse({ ...value, state, recorded_at: '2026-09-29T12:15:00Z', acknowledged_at: null, receipt: state === 'applied' ? {
    request_id: value.request_id, event_id: id(11), work_item_id: value.work_item_id, intent_id: value.intent_id,
    workflow_revision: value.expected_revision, ownership_revision: value.expected_ownership_revision, recorded_at: appliedAt,
    submission_cancelled_at: value.payload.snapshot.submission_cancelled_at ?? appliedAt, intent_cancelled_at: appliedAt,
    intention_cancelled: true, result_saved: false, result_linked: false, clinical_review_recorded: false, communication_confirmed: false, care_completed: false,
  } : null });
}
const target = { intent_id: id(6), recorded_at: at, intended_analytes: ['potassium'], submission: { status: 'awaiting_save', lab_result_id: null,
  event_id: null, evaluation_status: null, saved_at: null, acknowledged_at: null, recorded_analytes: [], missing_analytes: ['potassium'] } };
const props = { scope, workId: id(5), workflow, peersReady: true, refreshToken: 0, onReadiness: mocks.ready, onChanged: mocks.changed };
const ok = (data: unknown) => ({ data, error: null }), failed = { data: null, error: 'Unavailable' };
const page = (items: unknown[] = [], next_cursor: string | null = null) => ok({ items, next_cursor });
function deferred() { let resolve!: (value: unknown) => void;
  const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; }
beforeEach(() => {
  vi.resetAllMocks(); vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-29T13:00:00Z'));
  mocks.subscribe.mockReturnValue({ data: { subscription: { unsubscribe: mocks.unsubscribe } } });
  mocks.list.mockResolvedValue(page()); mocks.context.mockResolvedValue(ok(context)); mocks.targets.mockResolvedValue(page([target])); mocks.history.mockResolvedValue(page());
  mocks.prepare.mockImplementation(async (value) => ok(saved(value))); mocks.recover.mockImplementation(async (value) => ok(saved(value)));
  mocks.apply.mockImplementation(async (value) => ok(saved(value, 'applied'))); mocks.cancel.mockImplementation(async (value) => ok(saved(value, 'cancelled')));
  mocks.ack.mockImplementation(async (value) => ok({ ...saved(value, 'applied'), acknowledged_at: appliedAt }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function click(name: string) { fireEvent.click(screen.getByRole('button', { name })); }
function change(label: string, value: string) { fireEvent.change(screen.getByLabelText(label), { target: { value } }); }
async function recoverList() { click('Check administrative pending records'); await waitFor(() => expect(mocks.ready).toHaveBeenLastCalledWith(true)); }
async function targets() { click('Load pending laboratory intentions'); await screen.findByLabelText('Unsaved intention to resolve'); }
async function contextRead() { change('Unsaved intention to resolve', id(6)); click('Verify exact unsaved intention'); await screen.findByLabelText('Exact unsaved intention snapshot'); }
async function start() { const view = render(<CareUnsavedIntentPanel {...props} />); await recoverList(); await targets(); await contextRead(); return view; }
function fill(check = true) {
  change('Administrative cancellation reason', input.payload.reason); change('Administrative cancellation evidence', input.payload.evidence);
  change('Administrative occurrence at (UTC)', '2026-09-29T12:10');
  if (check) fireEvent.click(screen.getByRole('checkbox'));
}
function submit() { fireEvent.submit(screen.getByRole('form', { name: 'New administrative disposition' })); }
async function prepare() { const view = await start(); fill(); submit(); await screen.findByText('Administrative preparation saved. The intention has not been cancelled by this request.'); return view; }
describe('explicit unsaved intention administration', () => {
  it('requires target selection, fresh verification and unchecked consent without a new deadline', async () => {
    render(<CareUnsavedIntentPanel {...props} />); await recoverList(); await targets();
    expect(screen.getByLabelText('Unsaved intention to resolve')).toHaveValue(''); expect(mocks.context).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Verify exact unsaved intention' })).toBeDisabled();
    await contextRead(); expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.queryByLabelText(/Next review/)).toBeNull(); fill(false); submit(); expect(mocks.prepare).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox')); submit(); await screen.findByLabelText('Frozen administrative disposition');
    const value = mocks.prepare.mock.calls[0][0] as UnsavedInput;
    expect(value.payload.snapshot).toEqual(snapshot); expect(value.payload.evidence).toBe(input.payload.evidence);
    expect(value.expected_revision).toBe('1'); expect(Object.keys(value.payload).sort()).toEqual(['evidence', 'occurred_at', 'reason', 'snapshot', 'unsaved_cancellation_acknowledged']);
    expect(mocks.apply).not.toHaveBeenCalled();
  });
  it('applies separately, retains unchanged revision and requires separate ACK', async () => {
    await prepare(); const frozen = mocks.prepare.mock.calls[0][0]; click('Confirm cancellation of unsaved intention');
    await screen.findByText(/Unsaved intention cancelled. No result saved or linked/);
    expect(screen.getByText(/Workflow revision remains 1/)).toBeInTheDocument(); expect(mocks.changed).toHaveBeenCalledOnce(); expect(mocks.ack).not.toHaveBeenCalled();
    click('Acknowledge administrative receipt'); await screen.findByRole('button', { name: 'Return to administrative recovery' });
    expect(mocks.ack).toHaveBeenCalledExactlyOnceWith(frozen); click('Return to administrative recovery');
    expect(screen.queryByRole('form')).toBeNull(); await recoverList(); expect(mocks.ready).toHaveBeenLastCalledWith(true);
  });
  it('cancel preparation never claims that it cancelled the intention', async () => {
    await prepare(); click('Cancel administrative preparation only');
    await screen.findByText('Administrative preparation cancelled. This does not cancel the laboratory intention.'); expect(mocks.apply).not.toHaveBeenCalled();
  });
  it('reports a cancellation that lost to apply as an applied receipt', async () => {
    mocks.cancel.mockImplementation(async (value) => ok(saved(value, 'applied'))); await prepare(); click('Cancel administrative preparation only');
    await screen.findByText(/Unsaved intention cancelled. No result saved or linked/);
    expect(screen.queryByText('Administrative preparation cancelled. This does not cancel the laboratory intention.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Acknowledge administrative receipt' })).toBeInTheDocument();
  });
  it.each(['prepare', 'apply', 'cancel', 'ack'] as const)('preserves frozen identity and recovery after lost %s', async (operation) => {
    mocks[operation].mockResolvedValueOnce(failed); await start(); fill(); submit();
    await screen.findByLabelText('Frozen administrative disposition'); const frozen = mocks.prepare.mock.calls[0][0];
    if (operation !== 'prepare') {
      await screen.findByRole('button', { name: 'Confirm cancellation of unsaved intention' });
      if (operation === 'ack') { click('Confirm cancellation of unsaved intention'); await screen.findByRole('button', { name: 'Acknowledge administrative receipt' }); click('Acknowledge administrative receipt'); }
      else click(operation === 'apply' ? 'Confirm cancellation of unsaved intention' : 'Cancel administrative preparation only');
    }
    await screen.findByText(/Administrative state is unconfirmed/); expect(screen.getByText(`Request: ${frozen.request_id}`)).toBeInTheDocument();
    click('Check saved administrative request'); await screen.findByRole('button', { name: 'Cancel administrative preparation only' });
    expect(mocks.recover).toHaveBeenCalledExactlyOnceWith(frozen); expect(mocks.prepare).toHaveBeenCalledOnce();
  });
  it('same-ID retry retains exact payload after an uncertain preparation', async () => {
    mocks.prepare.mockResolvedValueOnce(failed); await start(); fill(); submit(); await screen.findByText(/Administrative state is unconfirmed/);
    const frozen = mocks.prepare.mock.calls[0][0]; click('Retry administrative preparation with same ID'); await screen.findByRole('button', { name: 'Cancel administrative preparation only' });
    expect(mocks.prepare.mock.calls[1][0]).toEqual(frozen);
  });
  it('supports already-cancelled submissions without inventing a new original cancellation time', async () => {
    const prior = '2026-09-29T12:01:00Z'; mocks.context.mockResolvedValue(ok({ ...context, snapshot: { ...snapshot, submission_status: 'submission_cancelled', submission_cancelled_at: prior } }));
    await prepare(); click('Confirm cancellation of unsaved intention'); await screen.findByText(`Submission cancelled: ${prior}`);
    expect(screen.getByText(`Original submission cancellation: ${prior}`)).toBeInTheDocument();
  });
  it.each(['reason', 'evidence', 'occurred_at'])('rejects invalid fresh %s before creating a request', async (field) => {
    await start(); fill(); const form = screen.getByRole('form') as HTMLFormElement;
    fireEvent.change(form.elements.namedItem(field)!, { target: { value: field === 'occurred_at' ? '2099-01-01T12:00' : '  ' } });
    submit(); expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it('blocks new preparation by peers while own readiness stays independent', async () => {
    const view = render(<CareUnsavedIntentPanel {...props} peersReady={false} />); await recoverList(); await targets(); await contextRead();
    expect(screen.queryByRole('form')).toBeNull(); expect(mocks.ready).toHaveBeenLastCalledWith(true);
    view.rerender(<CareUnsavedIntentPanel {...props} />); expect(screen.getByRole('form')).toBeInTheDocument();
  });
  it.each([null, { ...workflow, work_status: 'closed' }, { ...workflow, assigned_to: id(99) }, { ...workflow, transfer_pending_to: id(99) }] as const)('private recovery remains available without fresh eligibility %#', async (current) => {
    mocks.list.mockResolvedValue(page([saved()])); const view = render(<CareUnsavedIntentPanel {...props} workflow={current as CareWorkflowDetail | null} peersReady={false} />);
    click('Check administrative pending records'); await screen.findByRole('button', { name: `Recover administrative request ${input.request_id}` });
    click(`Recover administrative request ${input.request_id}`); await screen.findByRole('button', { name: 'Cancel administrative preparation only' });
    view.rerender(<CareUnsavedIntentPanel {...props} workflow={null} peersReady={false} refreshToken={1} />);
    click('Cancel administrative preparation only'); await screen.findByText('Administrative preparation cancelled. This does not cancel the laboratory intention.');
  });
  it('keeps applied recovery and ACK available after losing ownership', async () => {
    mocks.list.mockResolvedValue(page([saved(input, 'applied')])); mocks.recover.mockResolvedValue(ok(saved(input, 'applied')));
    render(<CareUnsavedIntentPanel {...props} workflow={null} peersReady={false} />); click('Check administrative pending records');
    await screen.findByRole('button', { name: `Recover administrative request ${input.request_id}` }); click(`Recover administrative request ${input.request_id}`);
    await screen.findByRole('button', { name: 'Acknowledge administrative receipt' }); click('Acknowledge administrative receipt');
    await screen.findByRole('button', { name: 'Return to administrative recovery' }); expect(mocks.context).not.toHaveBeenCalled();
  });
  it('keeps prefix recovery but denies readiness after a private-list tail failure', async () => {
    mocks.list.mockResolvedValueOnce(page([saved()], id(10))).mockResolvedValueOnce(failed);
    render(<CareUnsavedIntentPanel {...props} />); click('Check administrative pending records'); await screen.findByText(/full administrative recovery list could not be verified/);
    expect(mocks.ready).toHaveBeenLastCalledWith(false); click(`Recover administrative request ${input.request_id}`);
    await screen.findByRole('button', { name: 'Cancel administrative preparation only' });
  });
  it('fully paginates private requests before readiness and links foreign work rather than recovering it here', async () => {
    const other = saved({ ...input, work_item_id: id(99) }), gate = deferred();
    mocks.list.mockResolvedValueOnce(page([other], id(10))).mockReturnValueOnce(gate.promise);
    render(<CareUnsavedIntentPanel {...props} />); click('Check administrative pending records'); await screen.findByRole('link', { name: 'Open other follow-up' });
    expect(mocks.ready).toHaveBeenLastCalledWith(false); expect(screen.queryByRole('button', { name: `Recover administrative request ${input.request_id}` })).toBeNull();
    await act(async () => gate.resolve(page())); expect(mocks.ready).toHaveBeenLastCalledWith(true);
    expect(mocks.list.mock.calls[1][0].after).toBe(id(10));
  });
  it.each(['targets', 'history'] as const)('does not show a partial %s list as complete and keeps own readiness independent', async (kind) => {
    mocks[kind].mockResolvedValueOnce(page(kind === 'targets' ? [target] : [], id(10))).mockResolvedValueOnce(failed);
    render(<CareUnsavedIntentPanel {...props} />); await recoverList(); click(kind === 'targets' ? 'Load pending laboratory intentions' : 'Load administrative journal');
    await screen.findByText(/Current administrative evidence is unavailable or incomplete/);
    // Error text can render before the finally-state readiness effect flushes.
    await waitFor(() => expect(mocks.ready).toHaveBeenLastCalledWith(true));
    expect(screen.queryByLabelText(kind === 'targets' ? 'Unsaved intention to resolve' : 'Administrative journal')).toBeNull();
  });
  it('rejects duplicate private pages and retains the original recoverable prefix', async () => {
    mocks.list.mockResolvedValueOnce(page([saved()], id(10))).mockResolvedValueOnce(page([saved()], id(10)));
    render(<CareUnsavedIntentPanel {...props} />); click('Check administrative pending records'); await screen.findByText(/full administrative recovery list could not be verified/);
    expect(screen.getAllByRole('button', { name: `Recover administrative request ${input.request_id}` })).toHaveLength(1); expect(mocks.ready).toHaveBeenLastCalledWith(false);
  });
  it('filters saved results from selection and requires a new exact context when target changes', async () => {
    mocks.targets.mockResolvedValue(page([target, { ...target, intent_id: id(7) }, { ...target, intent_id: id(8), submission: { ...target.submission, status: 'saved_not_linked' } }]));
    await start(); fill(); change('Unsaved intention to resolve', id(7)); expect(screen.queryByRole('form')).toBeNull();
    expect(screen.queryByRole('option', { name: new RegExp(id(8)) })).toBeNull();
    mocks.context.mockResolvedValue(ok({ ...context, snapshot: { ...snapshot, intent_id: id(7) } })); click('Verify exact unsaved intention'); await screen.findByRole('form');
    expect(screen.getByLabelText('Administrative cancellation evidence')).toHaveValue(''); expect(screen.getByRole('checkbox')).not.toBeChecked();
  });
  it('labels the administrative journal separately and preserves the historical author and timestamps', async () => {
    const record = saved(input, 'applied'); mocks.history.mockResolvedValue(page([{ event_id: id(11), actor_id: id(99), intent_id: id(6),
      recorded_at: appliedAt, payload: input.payload, receipt: record.receipt }]));
    render(<CareUnsavedIntentPanel {...props} />); click('Load administrative journal'); const journal = await screen.findByLabelText('Administrative journal');
    expect(within(journal).getByText(/not clinical workflow progress/)).toBeInTheDocument();
    expect(within(journal).getByText(new RegExp(`Recorded by: ${id(99)}`))).toBeInTheDocument();
    expect(within(journal).getByText(/Historical workflow revision: 1/)).toBeInTheDocument();
  });
  it('invalidates the draft after a new workflow object even when its revision is unchanged', async () => {
    const view = await start(); fill(); view.rerender(<CareUnsavedIntentPanel {...props} workflow={{ ...workflow }} />);
    expect(screen.queryByRole('form')).toBeNull(); expect(screen.queryByLabelText('Exact unsaved intention snapshot')).toBeNull();
    await targets(); await contextRead(); expect(screen.getByLabelText('Administrative cancellation reason')).toHaveValue('');
  });
  it.each(['prepare', 'apply'] as const)('preserves private %s response through parent invalidation and refresh', async (operation) => {
    const gate = deferred(); let view;
    if (operation === 'prepare') { view = await start(); mocks.prepare.mockReturnValueOnce(gate.promise); fill(); submit(); }
    else { view = await prepare(); mocks.apply.mockReturnValueOnce(gate.promise); click('Confirm cancellation of unsaved intention'); }
    const frozen = mocks.prepare.mock.calls[0][0]; view.rerender(<CareUnsavedIntentPanel {...props} workflow={null} peersReady={false} refreshToken={1} />);
    await act(async () => gate.resolve(ok(saved(frozen, operation === 'apply' ? 'applied' : 'prepared'))));
    expect(screen.getByText(`Request: ${frozen.request_id}`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: operation === 'apply' ? 'Acknowledge administrative receipt' : 'Cancel administrative preparation only' })).toBeEnabled();
  });
  it('rejects a late context response after current workflow invalidation', async () => {
    const gate = deferred(); mocks.context.mockReturnValueOnce(gate.promise); const view = render(<CareUnsavedIntentPanel {...props} />);
    await recoverList(); await targets(); change('Unsaved intention to resolve', id(6)); click('Verify exact unsaved intention');
    view.rerender(<CareUnsavedIntentPanel {...props} workflow={null} />); await act(async () => gate.resolve(ok(context)));
    expect(screen.queryByLabelText('Exact unsaved intention snapshot')).toBeNull(); expect(screen.queryByRole('form')).toBeNull();
  });
  it.each(['prepare', 'apply', 'list', 'context'] as const)('clears sensitive evidence and rejects late %s after A→B→A', async (operation) => {
    const gate = deferred();
    if (operation === 'apply') { await prepare(); mocks.apply.mockReturnValueOnce(gate.promise); click('Confirm cancellation of unsaved intention'); }
    else if (operation === 'prepare') { await start(); mocks.prepare.mockReturnValueOnce(gate.promise); fill(); submit(); }
    else {
      render(<CareUnsavedIntentPanel {...props} />);
      if (operation === 'list') { mocks.list.mockReturnValueOnce(gate.promise); click('Check administrative pending records'); }
      else { await recoverList(); await targets(); mocks.context.mockReturnValueOnce(gate.promise); change('Unsaved intention to resolve', id(6)); click('Verify exact unsaved intention'); }
    }
    await act(async () => { const listener = mocks.subscribe.mock.calls[0][0]; listener('SIGNED_IN', { user: { id: id(99) } }); listener('SIGNED_IN', { user: { id: id(1) } }); });
    await act(async () => gate.resolve(operation === 'list' ? page([saved()]) : ok(operation === 'context' ? context : saved(mocks.prepare.mock.calls[0]?.[0] ?? input, operation === 'apply' ? 'applied' : 'prepared'))));
    expect(screen.getByRole('alert')).toHaveTextContent('Your session changed'); expect(screen.queryByText(input.payload.evidence)).toBeNull();
    expect(screen.queryByLabelText('Frozen administrative disposition')).toBeNull(); expect(mocks.changed).not.toHaveBeenCalled(); expect(mocks.ready).toHaveBeenLastCalledWith(false);
  });
  it('does not deliver the old route write into another follow-up', async () => {
    const view = await start(), gate = deferred(); mocks.prepare.mockReturnValueOnce(gate.promise); fill(); submit(); const frozen = mocks.prepare.mock.calls[0][0];
    view.rerender(<CareUnsavedIntentPanel {...props} workId={id(99)} workflow={null} />); await act(async () => gate.resolve(ok(saved(frozen))));
    expect(screen.queryByLabelText('Frozen administrative disposition')).toBeNull(); expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  });
});
