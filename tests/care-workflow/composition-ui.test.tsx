import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
const mocks = vi.hoisted(() => ({ prepare: vi.fn(), recover: vi.fn(), apply: vi.fn(), cancel: vi.fn(), ack: vi.fn(),
  detail: vi.fn(), list: vi.fn(), intents: vi.fn(), routing: vi.fn(), changes: vi.fn(), sources: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn(),
  ready: vi.fn(), changed: vi.fn(), workflow: vi.fn(), steps: vi.fn(), humanReady: true }));
vi.mock('@/app/(provider)/patients/[patientId]/_components/care-human-panel', () => ({
  CareHumanPanel: function HumanCoordination({ refreshToken, onReadiness, onChanged }: {
    refreshToken: number; onReadiness: (ready: boolean) => void; onChanged: () => void;
  }) {
    useEffect(() => { if (refreshToken > 0) onReadiness(mocks.humanReady); }, [refreshToken, onReadiness]);
    return <div><button onClick={() => onReadiness(false)}>Simulate pending human request</button>
      <button onClick={() => onReadiness(true)}>Simulate complete human recovery</button>
      <button onClick={onChanged}>Simulate applied human record</button></div>;
  },
}));
vi.mock('@/lib/care-workflow/composition-actions', () => ({ prepareComposition: mocks.prepare, recoverComposition: mocks.recover,
  applyComposition: mocks.apply, cancelComposition: mocks.cancel, acknowledgeComposition: mocks.ack, loadCompositionDetail: mocks.detail,
  loadPendingCompositions: mocks.list, loadCompositionIntentions: mocks.routing, loadCompositionInvalidations: mocks.changes }));
vi.mock('@/lib/care-workflow/submission-intent-actions', () => ({ loadPendingSubmissionIntents: mocks.intents }));
vi.mock('@/lib/labs/observation-actions', () => ({ loadSourceContext: mocks.sources }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { onAuthStateChange: mocks.subscribe } }) }));
vi.mock('@/lib/care-workflow/step-actions', () => ({ loadCareWorkflow: mocks.workflow, loadPendingCareSteps: mocks.steps,
  prepareCareStep: vi.fn(), recoverCareStep: vi.fn(), applyCareStep: vi.fn(), cancelCareStep: vi.fn(), acknowledgeCareStep: vi.fn() }));
vi.mock('@/app/(provider)/patients/[patientId]/_components/care-lab-save', () => ({ CareLabSave: ({ initial, mayStart, onClose }: {
  initial: unknown; mayStart: boolean; onClose: () => void;
}) => <section aria-label="Save boundary"><p>{initial ? 'Recovered intention' : `Fresh save allowed: ${mayStart}`}</p><button onClick={onClose}>Close save boundary</button></section> }));
import { CareLabPanel } from '@/app/(provider)/patients/[patientId]/_components/care-lab-panel';
import { CareWorkflowPanel } from '@/app/(provider)/patients/[patientId]/_components/care-workflow-panel';
import type { CompositionInput } from '@/lib/care-workflow/composition-types';
import type { CareWorkflowDetail } from '@/lib/care-workflow/step-types';
const id = (n: number) => `68000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = '2026-09-01T12:00:00Z'; const due = '2026-10-01T12:00:00Z';
const scope = { actor_id: id(1), organization_id: id(90), patient_id: id(11) };
const workflow: CareWorkflowDetail = { ...scope, work_item_id: id(100), assigned_to: id(1), accepted_by: id(1), accepted_at: at,
  transfer_pending_to: null, ownership_revision: '7', due_at: due, kind: 'laboratory_order', stage: 'requested', revision: '1', requested_analytes: ['potassium', 'egfr'],
  request: { kind: 'laboratory_order', source: 'external_documented', purpose: 'Synthetic follow-up', evidence: 'Original source', occurred_at: at, next_review_at: due, analytes: ['potassium', 'egfr'] },
  events: [{ id: id(9), actor_id: id(1), revision: '1', event_type: 'request_recorded', occurred_at: at, recorded_at: at }],
  next_action: 'Review next step', next_review_at: due, work_status: 'new', steps: [], compositions: [], humans: [], exceptions: [] };
const input: CompositionInput = { ...scope, work_item_id: id(100), request_id: id(200), expected_revision: '1', expected_ownership_revision: '7',
  payload: { occurred_at: at, next_review_at: due, evidence: 'Exact source evidence', reason: 'Partial source available', next_action: 'Review missing eGFR',
    sources: [{ analyte: 'egfr', root_id: null, expected_root_revision: null }, { analyte: 'potassium', root_id: id(400), expected_root_revision: '1' }], intent_resolutions: [] } };
const observation = { id: id(600) + ':potassium', patient_id: scope.patient_id, original_lab_result_id: id(600), analyte: 'potassium',
  root_id: id(400), version_id: id(500), revision: '1', status: 'original', effective_lab_result_id: id(600), value: '4.600', collected_at: at,
  notes: null, lab_facility: null, evaluation_status: 'pending' };
const sources = { ...scope, can_mutate: true, items: [{ observation, source_authority_organization_id: id(90) }] };
const detail = { ...scope, work_item_id: id(100), workflow_revision: '1', ownership_revision: '7', stage: 'requested', composition_event_id: null,
  pending_intent_count: '0', invalidation_count: '0', sources: [], clinical_review_recorded: false, communication_confirmed: false, care_completed: false };
function saved(value = input, state = 'prepared') { return { ...value, state, recorded_at: at, acknowledged_at: null, receipt: state === 'applied' ? {
  request_id: value.request_id, work_item_id: value.work_item_id, event_id: id(300), previous_event_id: null, workflow_revision: '2', ownership_revision: '7', stage: 'result_received', recorded_at: at, due_at: due,
  sources: [{ analyte: 'egfr', root_id: null, observed_head: null }, { analyte: 'potassium', root_id: id(400), observed_head: {
    version_id: id(500), revision: '1', status: 'original', effective_lab_result_id: id(600), value: '4.600', collected_at: at } }],
  intent_resolutions: [], clinical_review_recorded: false, communication_confirmed: false, care_completed: false } : null }; }
function intention(status = 'saved_not_linked') { return { ...scope, work_item_id: id(100), intent_id: id(700), submission_request_id: id(800), expected_revision: '1', expected_ownership_revision: '7',
  payload: { analytes: ['potassium', 'egfr'], evidence: 'Intended exact save', occurred_at: at }, state: 'prepared', recorded_at: at, cancelled_at: null,
  reconciled_at: null, reconciliation: null, result_linked: false, clinical_review_recorded: false, care_completed: false,
  submission: { status, lab_result_id: status === 'saved_not_linked' ? id(600) : null, event_id: id(900), evaluation_status: 'pending',
    saved_at: at, acknowledged_at: at, recorded_analytes: ['potassium'], missing_analytes: ['egfr'] } }; }
const props = { scope, workId: id(100), workflow, stepsReady: true, refreshToken: 0, onReadiness: mocks.ready, onChanged: mocks.changed };
const ok = (data: unknown) => ({ data, error: null });
const empty = () => ok({ items: [], next_cursor: null });
function deferred() { let resolve!: (value: unknown) => void; let reject!: (error: Error) => void;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeEach(() => {
  vi.resetAllMocks(); vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-29T13:00:00Z'));
  mocks.humanReady = true;
  mocks.subscribe.mockReturnValue({ data: { subscription: { unsubscribe: mocks.unsubscribe } } });
  for (const name of ['list', 'intents', 'routing', 'changes', 'steps'] as const) mocks[name].mockResolvedValue(empty());
  mocks.detail.mockResolvedValue(ok(detail)); mocks.sources.mockResolvedValue(ok(sources)); mocks.workflow.mockResolvedValue(ok(workflow));
  mocks.prepare.mockImplementation(async (value) => ok(saved(value))); mocks.recover.mockImplementation(async (value) => ok(saved(value)));
  mocks.apply.mockImplementation(async (value) => ok(saved(value, 'applied'))); mocks.cancel.mockImplementation(async (value) => ok(saved(value, 'cancelled')));
  mocks.ack.mockImplementation(async (value) => ok({ ...saved(value, 'applied'), acknowledged_at: at }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function refresh() { fireEvent.click(screen.getByRole('button', { name: 'Refresh laboratory context and recovery' })); }
async function start() { render(<CareLabPanel {...props} />); refresh(); await screen.findByRole('form', { name: 'New laboratory source composition' }); }
function change(label: string, value: string) { fireEvent.change(screen.getByLabelText(label), { target: { value } }); }
function fill() {
  change('Source for Potassium', id(400)); change('Association evidence', input.payload.evidence); change('Source selection or replacement reason', input.payload.reason);
  change('Association next action', input.payload.next_action); change('Association occurred at (UTC)', '2026-09-01T12:00'); change('Association next review at (UTC)', '2026-10-01T12:00');
}
function submit() { fireEvent.submit(screen.getByRole('form', { name: 'New laboratory source composition' })); }
async function prepare() { await start(); fill(); submit(); await screen.findByText('Prepared and recoverable; no association applied.'); }
describe('exact laboratory source association', () => {
  it('labels unresolved counts and retains both original open and resolved source-change records', async () => {
    const row = { id: id(810), entry_id: id(811), change_version_id: id(812), recorded_at: at, analyte: 'potassium', root_id: id(400), event_id: id(300), resolution: null };
    mocks.detail.mockResolvedValue(ok({ ...detail, invalidation_count: '1' })); mocks.changes.mockResolvedValue(ok({ work_item_id: id(100), next_cursor: null, items: [row,
      { ...row, id: id(820), resolution: { event_id: id(821), revision: '5', recorded_at: at, disposition: 'no_longer_used' } }] }));
    await start(); expect(screen.getByText(/1 unresolved source-change records/)).toBeInTheDocument();
    expect(screen.getByText('Source-change history (2 loaded)')).toBeInTheDocument(); expect(screen.getByText(/Unresolved when loaded/)).toBeInTheDocument();
    expect(screen.getByText(/Resolution recorded:/)).toHaveTextContent(id(821)); expect(screen.getByText(/Resolution recorded:/)).toHaveTextContent('Not completed care');
    expect(screen.getByText(/Live paginated history, not an atomic/)).toBeInTheDocument();
  });
  it('requires explicit complete recovery and never prepares automatically', async () => {
    render(<CareLabPanel {...props} />); expect(mocks.detail).not.toHaveBeenCalled(); expect(screen.queryByRole('form')).toBeNull();
    refresh(); await screen.findByRole('form'); expect(mocks.ready).toHaveBeenLastCalledWith(true); expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it('restores parent readiness after an immediately resolved refresh batched into one render', async () => {
    await start(); mocks.ready.mockClear(); await act(async () => { refresh(); });
    expect(screen.getByRole('form')).toBeInTheDocument(); expect(mocks.ready).toHaveBeenLastCalledWith(true);
  });
  it.each(['empty', 'failed'] as const)('does not restore readiness before a %s recovery tail actually completes', async (outcome) => {
    await start(); const tail = deferred(); mocks.ready.mockClear();
    mocks.intents.mockResolvedValueOnce(ok({ items: [], next_cursor: id(999) })).mockReturnValueOnce(tail.promise);
    await act(async () => { refresh(); }); expect(mocks.ready).toHaveBeenLastCalledWith(false); expect(screen.queryByRole('form')).toBeNull();
    await act(async () => tail.resolve(outcome === 'empty' ? empty() : { data: null, error: 'unavailable' }));
    expect(mocks.ready).toHaveBeenLastCalledWith(outcome === 'empty');
    if (outcome === 'failed') expect(screen.queryByRole('form')).toBeNull();
  });
  it('freezes missingness, decimal value presentation, both revisions and metadata before applying', async () => {
    await prepare(); const frozen = mocks.prepare.mock.calls[0][0]; expect(frozen).toMatchObject({ ...scope, expected_revision: '1', expected_ownership_revision: '7', payload: input.payload });
    expect(within(screen.getByLabelText('Frozen source presentation')).getByText(/Potassium: 4.600 mEq\/L/)).toHaveTextContent(`Collected: ${at}`);
    expect(screen.getByText('eGFR: Missing')).toBeInTheDocument(); expect(mocks.apply).not.toHaveBeenCalled(); expect(mocks.ready).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm exact source association' })); await screen.findByText(/Association recorded at revision 2/);
    expect(mocks.apply).toHaveBeenCalledExactlyOnceWith(frozen); expect(mocks.changed).toHaveBeenCalledOnce(); expect(mocks.ack).not.toHaveBeenCalled();
  });
  it('preserves frozen presentation across refresh without substituting a changed source head', async () => {
    await prepare(); mocks.sources.mockResolvedValue(ok({ ...sources, items: [{ ...sources.items[0], observation: { ...observation, revision: '2', value: '9.900', status: 'corrected' } }] }));
    refresh(); await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh laboratory context and recovery' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Check saved association' })); await screen.findByText('Prepared and recoverable; no association applied.');
    expect(screen.getByLabelText('Frozen source presentation')).toHaveTextContent('4.600'); expect(screen.getByLabelText('Frozen source presentation')).not.toHaveTextContent('9.900');
  });
  it('does not offer apply for a recovered preparation when the exact source presentation is unavailable', async () => {
    mocks.list.mockResolvedValue(ok({ items: [saved()], next_cursor: null }));
    mocks.sources.mockResolvedValue(ok({ ...sources, items: [{ ...sources.items[0], observation: { ...observation, revision: '2', value: '9.900', status: 'corrected' } }] }));
    render(<CareLabPanel {...props} />); refresh(); fireEvent.click(await screen.findByRole('button', { name: `Recover composition ${id(200)}` }));
    await screen.findByText('Prepared and recoverable; no association applied.'); expect(screen.getByRole('button', { name: 'Confirm exact source association' })).toBeDisabled();
    expect(screen.getByLabelText('Frozen source presentation')).toHaveTextContent('exact frozen source presentation is unavailable');
    expect(screen.getByLabelText('Frozen source presentation')).not.toHaveTextContent('9.900');
  });
  it('retains the same request after lost preparation and ambiguous apply, never rebasing', async () => {
    mocks.prepare.mockRejectedValueOnce(new Error('offline')); await start(); fill(); submit(); await screen.findByRole('alert'); const frozen = mocks.prepare.mock.calls[0][0];
    fireEvent.click(screen.getByRole('button', { name: 'Retry association preparation with same ID' })); await screen.findByText('Prepared and recoverable; no association applied.');
    expect(mocks.prepare).toHaveBeenNthCalledWith(2, frozen); mocks.apply.mockResolvedValueOnce({ data: null, error: '40001' });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm exact source association' })); await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: 'Confirm exact source association' })).toBeNull();
    mocks.recover.mockResolvedValueOnce(ok(saved(frozen, 'applied'))); fireEvent.click(screen.getByRole('button', { name: 'Check saved association' }));
    await screen.findByText(/Association recorded at revision 2/); expect(mocks.recover).toHaveBeenCalledExactlyOnceWith(frozen); expect(mocks.apply).toHaveBeenCalledOnce();
  });
  it('reports winning application after cancellation and requires separate ACK and context reload', async () => {
    await prepare(); mocks.cancel.mockImplementation(async (value) => ok(saved(value, 'applied')));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel prepared association' })); await screen.findByText(/Association recorded at revision 2/);
    expect(screen.queryByText(/Preparation cancelled/)).toBeNull(); fireEvent.click(screen.getByRole('button', { name: 'Acknowledge association receipt' }));
    await screen.findByRole('button', { name: 'Reload after association receipt' }); expect(screen.queryByRole('form')).toBeNull();
  });
  it('requires deliberate reconciliation for every own saved intention, including after lab ACK', async () => {
    const intent = intention(); mocks.intents.mockResolvedValue(ok({ items: [intent], next_cursor: null }));
    mocks.routing.mockResolvedValue(ok({ items: [{ ...intent, intended_analytes: intent.payload.analytes }], next_cursor: null }));
    await start(); expect(mocks.ready).toHaveBeenLastCalledWith(false); expect(screen.getByRole('button', { name: 'Save a new exam for this follow-up' })).toBeDisabled();
    fill(); submit(); expect(mocks.prepare).not.toHaveBeenCalled(); expect(screen.getByRole('alert')).toHaveTextContent('Explicitly reconcile');
    change(`Disposition for ${id(700)}`, 'linked'); change(`Reconciliation reason for ${id(700)}`, 'Exact saved potassium; eGFR remains missing'); submit();
    await screen.findByText('Prepared and recoverable; no association applied.');
    expect(mocks.prepare.mock.calls[0][0].payload.intent_resolutions).toEqual([{ intent_id: id(700), disposition: 'linked', reason: 'Exact saved potassium; eGFR remains missing' }]);
  });
  it('does not start any new value entry or composition with an unsaved own intention', async () => {
    mocks.intents.mockResolvedValue(ok({ items: [intention('awaiting_save')], next_cursor: null })); render(<CareLabPanel {...props} />); refresh();
    fireEvent.click(await screen.findByRole('button', { name: `Recover intention ${id(700)}` })); await screen.findByText('Recovered intention');
    expect(screen.queryByRole('form')).toBeNull(); expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it('loads the complete25+tail for both private request families without overlooking own tail records', async () => {
    mocks.list.mockResolvedValueOnce(ok({ items: Array.from({ length: 25 }, (_, n) => saved({ ...input, request_id: id(1000 + n), work_item_id: id(999) })), next_cursor: id(1024) }))
      .mockResolvedValueOnce(ok({ items: [saved()], next_cursor: null }));
    mocks.intents.mockResolvedValueOnce(ok({ items: [], next_cursor: id(2000) })).mockResolvedValueOnce(ok({ items: [intention()], next_cursor: null }));
    render(<CareLabPanel {...props} />); refresh(); await screen.findByRole('button', { name: `Recover composition ${id(200)}` });
    expect(screen.getByRole('button', { name: `Recover intention ${id(700)}` })).toBeInTheDocument(); expect(screen.queryByRole('form')).toBeNull();
    expect(mocks.list).toHaveBeenLastCalledWith({ ...scope, after: id(1024) }); expect(mocks.intents).toHaveBeenLastCalledWith({ ...scope, after: id(2000) });
    expect(mocks.ready).toHaveBeenLastCalledWith(false);
  });
  it.each(['list', 'intents', 'routing', 'changes'] as const)('fails closed on an unavailable %s tail', async (name) => {
    mocks[name].mockResolvedValueOnce(ok({ items: [], next_cursor: id(1000) })).mockResolvedValueOnce({ data: null, error: 'offline' });
    render(<CareLabPanel {...props} />); refresh(); await screen.findByRole('alert'); expect(screen.queryByRole('form')).toBeNull();
    expect(screen.getByRole('button', { name: 'Save a new exam for this follow-up' })).toBeDisabled();
    if (name === 'list' || name === 'intents') expect(mocks.ready).toHaveBeenLastCalledWith(false);
  });
  it('recovers private applied receipts even when current workflow and source reads are unavailable', async () => {
    mocks.detail.mockResolvedValue({ data: null }); mocks.sources.mockResolvedValue({ data: null }); mocks.routing.mockRejectedValue(new Error('not visible'));
    mocks.list.mockResolvedValue(ok({ items: [saved(input, 'applied')], next_cursor: null })); mocks.recover.mockResolvedValue(ok(saved(input, 'applied')));
    render(<CareLabPanel {...props} workflow={null} />); refresh(); fireEvent.click(await screen.findByRole('button', { name: `Recover composition ${id(200)}` }));
    await screen.findByText(/Association recorded at revision 2/); expect(screen.getByLabelText('Historical associated source values')).toHaveTextContent('4.600'); expect(screen.queryByRole('form')).toBeNull();
  });
  it.each(['step', 'revision', 'owner', 'transfer'] as const)('requires coherent eligible current context: %s', async (reason) => {
    const current = reason === 'revision' ? { ...workflow, revision: '2' } : reason === 'owner' ? { ...workflow, assigned_to: id(99) }
      : reason === 'transfer' ? { ...workflow, transfer_pending_to: id(99) } : workflow;
    render(<CareLabPanel {...props} workflow={current} stepsReady={reason !== 'step'} />); refresh(); await screen.findByText('Last loaded source composition');
    expect(screen.queryByRole('form')).toBeNull(); expect(screen.getByRole('button', { name: 'Save a new exam for this follow-up' })).toBeDisabled();
  });
  it('does not generate an identity for invalid or unexplained initial all-missing composition', async () => {
    await start(); fill(); change('Source for Potassium', ''); const uuid = vi.spyOn(crypto, 'randomUUID'); submit();
    expect(screen.getByRole('alert')).toHaveTextContent('initial all-missing'); expect(uuid).not.toHaveBeenCalled(); expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it('blocks parent readiness while the save boundary is open and invalidates context on return', async () => {
    await start(); fireEvent.click(screen.getByRole('button', { name: 'Save a new exam for this follow-up' }));
    expect(screen.getByText('Fresh save allowed: true')).toBeInTheDocument(); expect(mocks.ready).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByRole('button', { name: 'Close save boundary' })); await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2)); expect(mocks.changed).toHaveBeenCalledOnce();
  });
  it('ignores delayed application after session change without exposing its historical receipt', async () => {
    await prepare(); const gate = deferred(); mocks.apply.mockReturnValueOnce(gate.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm exact source association' }));
    act(() => mocks.subscribe.mock.calls[0][0]('SIGNED_OUT', null)); await act(async () => gate.resolve(ok(saved(input, 'applied'))));
    expect(screen.getByRole('alert')).toHaveTextContent('Your session changed'); expect(screen.queryByLabelText('Frozen source association')).toBeNull(); expect(mocks.changed).not.toHaveBeenCalled();
  });
  it('ignores delayed reads after route scope replacement', async () => {
    const gate = deferred(); mocks.detail.mockReturnValueOnce(gate.promise); const view = render(<CareLabPanel {...props} />); refresh();
    view.rerender(<CareLabPanel {...props} workId={id(999)} workflow={null} />); await act(async () => gate.resolve(ok(detail)));
    expect(screen.queryByText('Last loaded source composition')).toBeNull(); expect(screen.queryByRole('form')).toBeNull(); expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  });
});
describe('real parent/child pending coordination', () => {
  const parent = { actorId: scope.actor_id, patientId: scope.patient_id, organizationId: scope.organization_id, workId: id(100), initial: workflow, scopeKey: 'test' };
  it('keeps laboratory save and association blocked by incomplete human recovery', async () => {
    mocks.humanReady = false; render(<CareWorkflowPanel {...parent} />);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh workflow and check pending steps' }));
    await screen.findByText('Last loaded source composition'); expect(screen.queryByRole('form')).toBeNull();
    expect(screen.getByRole('button', { name: 'Save a new exam for this follow-up' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Simulate complete human recovery' }));
    await screen.findByRole('form', { name: 'New laboratory source composition' });
    expect(screen.getByRole('button', { name: 'Save a new exam for this follow-up' })).toBeEnabled();
  });
  it('preserves an exact association write when a human change invalidates the parent', async () => {
    render(<CareWorkflowPanel {...parent} />); fireEvent.click(screen.getByRole('button', { name: 'Refresh workflow and check pending steps' }));
    await screen.findByRole('form', { name: 'New laboratory source composition' }); fill(); submit();
    await screen.findByText('Prepared and recoverable; no association applied.');
    const pending = deferred(); mocks.apply.mockReturnValueOnce(pending.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm exact source association' }));
    fireEvent.click(screen.getByRole('button', { name: 'Simulate applied human record' }));
    await act(async () => pending.resolve(ok(saved(mocks.prepare.mock.calls[0][0], 'applied'))));
    expect(screen.queryByLabelText('Last loaded workflow snapshot')).toBeNull(); expect(screen.getByText(/Association recorded at revision/)).toBeInTheDocument();
  });
  it('restores the parent step form after repeated immediate child refreshes without granting readiness early', async () => {
    render(<CareWorkflowPanel {...parent} />); fireEvent.click(screen.getByRole('button', { name: 'Refresh workflow and check pending steps' }));
    await screen.findByRole('form', { name: 'New documented step' });
    for (let n = 0; n < 3; n += 1) {
      await act(async () => { refresh(); }); expect(await screen.findByRole('form', { name: 'New documented step' })).toBeInTheDocument();
    }
  });
  it('keeps a step blocked by an intention even when every step receipt is recovered', async () => {
    mocks.intents.mockResolvedValue(ok({ items: [intention('awaiting_save')], next_cursor: null })); render(<CareWorkflowPanel {...parent} />);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh workflow and check pending steps' }));
    await screen.findByRole('button', { name: `Recover intention ${id(700)}` }); await waitFor(() => expect(mocks.steps).toHaveBeenCalledOnce());
    expect(screen.queryByRole('form', { name: 'New documented step' })).toBeNull(); expect(screen.queryByRole('form', { name: 'New laboratory source composition' })).toBeNull();
  });
  it('blocks laboratory preparation until the pending step tail completes', async () => {
    mocks.steps.mockResolvedValueOnce(ok({ items: [], next_cursor: id(999) })).mockResolvedValueOnce(empty()); render(<CareWorkflowPanel {...parent} />);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh workflow and check pending steps' })); await screen.findByRole('button', { name: 'Load more pending steps' });
    expect(screen.queryByRole('form')).toBeNull(); fireEvent.click(screen.getByRole('button', { name: 'Load more pending steps' }));
    await screen.findByRole('form', { name: 'New laboratory source composition' });
    // Parent readiness is delivered by the child's effect, after its own form renders.
    expect(await screen.findByRole('form', { name: 'New documented step' })).toBeInTheDocument();
  });
});
