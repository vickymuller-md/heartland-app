import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ prepare: vi.fn(), recover: vi.fn(), apply: vi.fn(), cancel: vi.fn(), ack: vi.fn(), context: vi.fn(),
  list: vi.fn(), sourceContext: vi.fn(), closureContext: vi.fn(), changes: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn(), ready: vi.fn(), changed: vi.fn() }));
vi.mock('@/lib/care-workflow/human-actions', () => ({ prepareHuman: mocks.prepare, recoverHuman: mocks.recover,
  applyHuman: mocks.apply, cancelHuman: mocks.cancel, acknowledgeHuman: mocks.ack, loadHumanContext: mocks.context, loadSourceResolutionContext: mocks.sourceContext, loadClosureContext: mocks.closureContext, loadPendingHuman: mocks.list }));
vi.mock('@/lib/care-workflow/composition-actions', () => ({ loadCompositionInvalidations: mocks.changes }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { onAuthStateChange: mocks.subscribe } }) }));
import { CareHumanPanel } from '@/app/(provider)/patients/[patientId]/_components/care-human-panel';
import { humanCommandSchema, humanStateSchema, type HumanContext, type HumanInput, type HumanState } from '@/lib/care-workflow/human-types';
import type { CareWorkflowDetail } from '@/lib/care-workflow/step-types';
const id = (n: number) => `ac000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = '2026-09-29T12:00:00Z', due = '2026-10-01T12:00:00Z';
const scope = { actor_id: id(1), organization_id: id(3), patient_id: id(2) };
const common = { occurred_at: at, evidence: 'Synthetic professional evidence', next_action: 'Review remaining evidence', next_review_at: due };
const context: HumanContext = { ...scope, work_item_id: id(5), workflow_revision: '3', ownership_revision: '1', kind: 'laboratory_order',
  stage: 'result_received', command: 'record_review', basis_signature: 'a'.repeat(64), latest_review: null,
  basis: { kind: 'laboratory_order', composition_event_id: id(40), operational_event: null,
    sources: [{ analyte: 'potassium', entry_id: id(41), root_id: id(42), authority_organization_id: id(3), original_lab_result_id: id(43),
      observed_version_id: id(44), head: { version_id: id(44), revision: '1', status: 'original', effective_lab_result_id: id(43), value: '4.60', collected_at: at },
      evaluation_status: 'pending', quality: 'available' }],
    processing: [{ lab_result_id: id(43), evaluation: { event_id: id(45), status: 'pending', completed_at: null, source_assessment: null } }] } };
const latest: NonNullable<HumanContext['latest_review']> = { event_id: id(100), actor_id: id(1), revision: '3', occurred_at: at, recorded_at: at,
  basis_signature: context.basis_signature, is_current: true, decision: 'Latest synthetic decision' };
function workflow(current: HumanContext = context): CareWorkflowDetail {
  const analytes: CareWorkflowDetail['requested_analytes'] = current.kind === 'laboratory_order' ? ['potassium'] : [];
  return { ...scope, work_item_id: id(5), assigned_to: id(1), accepted_by: id(1), accepted_at: at, transfer_pending_to: null,
    ownership_revision: current.ownership_revision, due_at: due, kind: current.kind, stage: current.stage, revision: current.workflow_revision,
    requested_analytes: analytes, request: { kind: current.kind, source: 'external_documented', purpose: 'Synthetic follow-up',
      evidence: 'Original source', occurred_at: at, next_review_at: due, analytes },
    events: [{ id: id(9), actor_id: id(1), revision: '1', event_type: 'request_recorded', occurred_at: at, recorded_at: at }],
    next_action: 'Review next step', next_review_at: due, work_status: 'new', steps: [], compositions: [], humans: [], exceptions: [] };
}
const input: HumanInput = { ...scope, request_id: id(10), work_item_id: id(5), expected_revision: '3', expected_ownership_revision: '1',
  command: 'record_review', basis: context.basis, basis_signature: context.basis_signature,
  payload: { ...common, details: { decision: 'Synthetic decision', limitations: 'Partial evidence remains' } } };
function saved(value = input, state: HumanState['state'] = 'prepared'): HumanState {
  const command = humanCommandSchema.parse({ command: value.command, payload: value.payload });
  if (command.command === 'close_success' || command.command === 'close_without_completion') return humanStateSchema.parse({ ...value,
    state, recorded_at: '2026-09-29T13:00:00Z', acknowledged_at: null, receipt: state === 'applied' ? {
      request_id: value.request_id, work_item_id: value.work_item_id, event_id: id(20), command: command.command,
      workflow_revision: String(BigInt(value.expected_revision) + BigInt(1)), ownership_revision: value.expected_ownership_revision,
      stage: 'result_received', recorded_at: '2026-09-29T13:00:00Z', closed_at: '2026-09-29T13:00:00Z', basis: value.basis,
      basis_signature: value.basis_signature, work_closed: true, clinical_review_recorded: false, addresses_current_review: false, communication_confirmed: false,
      care_completed: command.command === 'close_success', completion_outcome: command.command === 'close_success' ? 'documented_workflow_completion' : command.payload.details.disposition,
    } : null });
  return humanStateSchema.parse({ ...value, state, recorded_at: at, acknowledged_at: null, receipt: state === 'applied' ? {
    request_id: value.request_id, work_item_id: value.work_item_id, event_id: id(20), command: value.command,
    workflow_revision: String(BigInt(value.expected_revision) + BigInt(1)), ownership_revision: value.expected_ownership_revision,
    stage: value.basis.kind === 'laboratory_order' ? 'result_received' : value.basis.kind === 'referral' ? 'report_received' : 'obtained',
    recorded_at: at, basis: value.basis, basis_signature: value.basis_signature, due_at: due,
    exception_id: command.command === 'record_contact' ? command.payload.details.exception_id : null,
    clinical_review_recorded: value.command === 'record_review', addresses_current_review: command.command === 'record_contact' && command.payload.details.review_addressed,
    communication_confirmed: false, care_completed: false,
    ...(command.command === 'resolve_exception' ? { resolved_exception_id: command.payload.details.exception.exception_id, resolution_event_id: id(20) } : {}),
    ...(command.command === 'resolve_source_invalidation' ? { resolved_invalidation_id: command.payload.details.invalidation.invalidation_id,
      resolution_event_id: id(20), source_review_attested: true, source_contact_attested: true } : {}),
  } : null });
}
const props = { scope, workId: id(5), workflow: workflow(), peersReady: true, refreshToken: 0, onReadiness: mocks.ready, onChanged: mocks.changed };
const ok = (data: unknown) => ({ data, error: null }), empty = () => ok({ items: [], next_cursor: null });
function deferred() { let resolve!: (value: unknown) => void; let reject!: (error: Error) => void;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeEach(() => {
  vi.resetAllMocks(); vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-29T13:00:00Z'));
  mocks.subscribe.mockReturnValue({ data: { subscription: { unsubscribe: mocks.unsubscribe } } });
  mocks.list.mockResolvedValue(empty()); mocks.context.mockImplementation(async (value) => ok({ ...context, command: value.command }));
  mocks.prepare.mockImplementation(async (value) => ok(saved(value))); mocks.recover.mockImplementation(async (value) => ok(saved(value)));
  mocks.apply.mockImplementation(async (value) => ok(saved(value, 'applied'))); mocks.cancel.mockImplementation(async (value) => ok(saved(value, 'cancelled')));
  mocks.ack.mockImplementation(async (value) => ok({ ...saved(value, 'applied'), acknowledged_at: at }));
});

function closureContext(success = true): Extract<HumanContext, { command: 'close_success' | 'close_without_completion' }> {
  const source = sourceContext(), basis = structuredClone(source.basis);
  basis.sources[0].evaluation_status = 'not_required';
  basis.processing[0].evaluation = { ...basis.processing[0].evaluation!, status: 'not_required', completed_at: at };
  return { ...context, command: success ? 'close_success' : 'close_without_completion', workflow_revision: '4', basis,
    latest_review: latest, contact: source.contact,
    snapshot: { exceptions: [], invalidations: [], known_invalidation_ids: [], prepared_intents: [] } };
}
async function startClosure(c = closureContext()) {
  mocks.closureContext.mockResolvedValue(ok(c)); const view = render(<CareHumanPanel {...props} workflow={workflow(c)} />);
  refresh(); await waitFor(() => expect(mocks.ready).toHaveBeenLastCalledWith(true));
  change('Human record type', c.command); evidence(); await screen.findByLabelText('Exact closure obligations'); return view;
}
function fillClosure(success = true) {
  if (success) {
    fireEvent.click(screen.getByRole('checkbox', { name: 'I explicitly attest that this workflow was completed' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'I accept the exact displayed current review and documented contact for this closure' }));
  } else { change('Non-completion disposition', 'not_performed'); change('Non-completion rationale', 'Service not delivered in this workflow'); }
  change('Documented closure outcome', 'Explicit documented synthetic outcome'); change('Human record evidence', 'Explicit synthetic closure evidence');
  change('Human occurrence at (UTC)', '2026-09-29T12:10');
}
describe('explicit closure UI', () => {
  it('requires two unselected completion attestations and creates no future deadline', async () => {
    await startClosure(); expect(mocks.closureContext).toHaveBeenCalledWith({ ...scope, work_item_id: id(5), command: 'close_success' });
    for (const checkbox of screen.getAllByRole('checkbox')) expect(checkbox).not.toBeChecked();
    expect(screen.queryByLabelText('Human next review at (UTC)')).toBeNull(); expect(screen.queryByLabelText('Human follow-up next action')).toBeNull();
    fillClosure(); submit(); await screen.findByText('Frozen documented workflow completion');
    const sent = mocks.prepare.mock.calls[0][0]; expect(Object.keys(sent.payload).sort()).toEqual(['details', 'evidence', 'occurred_at']);
    expect(sent.payload.details).toMatchObject({ workflow_completed: true, review_contact_accepted: true, review_event_id: id(100), contact_event_id: id(101) });
    expect(mocks.apply).not.toHaveBeenCalled(); click('Confirm human record'); await screen.findByText(/Work closed at/);
    expect(screen.queryByText(/Queue deadline at recording/)).toBeNull(); expect(mocks.ack).not.toHaveBeenCalled();
    click('Acknowledge human receipt'); await screen.findByRole('button', { name: 'Return to human recovery' });
  });
  it('rejects an unchecked completion declaration', async () => {
    await startClosure(); fillClosure(); fireEvent.click(screen.getByRole('checkbox', { name: 'I explicitly attest that this workflow was completed' }));
    submit(); expect(mocks.prepare).not.toHaveBeenCalled(); expect(screen.getByRole('alert')).toHaveTextContent('explicit closure declarations');
  });
  it('requires a separate unchecked declaration and rationale for every unresolved target', async () => {
    const c = closureContext(false), target = sourceContext().invalidation;
    c.snapshot.invalidations = [target]; c.snapshot.known_invalidation_ids = [target.invalidation_id];
    c.snapshot.exceptions = [{ exception_id: id(55), origin_event_id: id(54), human_origin_event_id: null, origin_revision: '2', origin_occurred_at: at,
      code: 'report_missing', reason: 'Original missing report', next_action: 'Old action retained', next_review_at: due, recorded_at: at }];
    await startClosure(c); expect(screen.getByLabelText('Non-completion disposition')).toHaveValue('');
    expect(screen.queryByLabelText('Non-completion rationale')).toBeNull(); fillClosure(false);
    expect(screen.getAllByRole('checkbox')).toHaveLength(2); for (const checkbox of screen.getAllByRole('checkbox')) expect(checkbox).not.toBeChecked();
    submit(); expect(mocks.prepare).not.toHaveBeenCalled();
    for (const checkbox of screen.getAllByRole('checkbox')) fireEvent.click(checkbox);
    change(`Target-specific rationale for ${id(50)}`, 'Source change not delivered'); change(`Target-specific rationale for ${id(55)}`, 'Report missing and not delivered');
    submit(); await screen.findByText('Frozen closure without completed care');
    const sent = mocks.prepare.mock.calls[0][0]; expect(sent.payload.details.declarations).toHaveLength(2);
    expect(sent.payload.details.snapshot).toEqual(c.snapshot); click('Confirm human record'); await screen.findByText(/No completed care recorded/);
    expect(sent.payload).not.toHaveProperty('next_action');
  });
  it('clears unsaved non-completion declarations when disposition changes', async () => {
    await startClosure(closureContext(false)); fillClosure(false); change('Non-completion disposition', 'transferred');
    expect(screen.getByLabelText('Non-completion rationale')).toHaveValue(''); expect(screen.getByLabelText('Documented closure outcome')).toHaveValue('');
    expect(screen.getByText(/Transfer does not confirm acceptance/)).toBeInTheDocument();
  });
  it.each(['contact', 'review', 'processing', 'intent', 'barrier'] as const)('shows %s prerequisite failure and keeps private recovery accessible', async (kind) => {
    const c = closureContext(); if (kind === 'contact') c.contact = null;
    if (kind === 'review') { c.latest_review = null; c.contact = null; }
    if (kind === 'processing') { c.basis.processing[0].evaluation!.status = 'pending'; c.basis.processing[0].evaluation!.completed_at = null; c.basis.sources[0].evaluation_status = 'pending'; }
    if (kind === 'intent') c.snapshot.prepared_intents = [{ intent_id: id(88), state: 'prepared', recorded_at: at }];
    if (kind === 'barrier') c.snapshot.exceptions = [{ exception_id: id(55), origin_event_id: id(54), human_origin_event_id: null, origin_revision: '2', origin_occurred_at: at,
      code: 'report_missing', reason: 'Report absent', next_action: 'Original action', next_review_at: due, recorded_at: at }];
    await startClosure(c); expect(screen.queryByRole('form')).toBeNull(); expect(screen.getByText(/Closure prerequisites are incomplete/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check human pending records' })).toBeEnabled();
  });
  it('preserves a lost-response closure through owner, peer and workflow changes', async () => {
    const c = closureContext(), view = await startClosure(c), pending = deferred(); mocks.prepare.mockReturnValueOnce(pending.promise);
    fillClosure(); submit(); const sent = mocks.prepare.mock.calls[0][0];
    view.rerender(<CareHumanPanel {...props} workflow={null} peersReady={false} refreshToken={1} />);
    await act(async () => pending.resolve({ data: null, error: 'Unconfirmed' })); expect(screen.getByText('Frozen documented workflow completion')).toBeInTheDocument();
    click('Check saved human request'); await screen.findByText('Human record prepared and recoverable; not yet recorded.'); expect(mocks.recover).toHaveBeenCalledWith(sent);
    click('Cancel human preparation'); await screen.findByText('Human preparation cancelled; this request recorded no human event.'); expect(mocks.cancel).toHaveBeenCalledWith(sent);
  });
  it.each(['session', 'route'] as const)('fences a late closure context after %s replacement', async (kind) => {
    const view = await startClosure(), pending = deferred(); mocks.closureContext.mockReturnValueOnce(pending.promise); evidence();
    if (kind === 'session') { const listener = mocks.subscribe.mock.calls[0][0]; act(() => { listener('SIGNED_IN', { user: { id: id(99) } }); listener('SIGNED_IN', { user: { id: id(1) } }); }); }
    else view.rerender(<CareHumanPanel {...props} workId={id(99)} workflow={null} />);
    await act(async () => pending.resolve(ok(closureContext()))); expect(screen.queryByRole('form')).toBeNull(); expect(mocks.prepare).not.toHaveBeenCalled();
  });
});

function sourceContext(): Extract<HumanContext, { command: 'resolve_source_invalidation' }> {
  const basis = structuredClone(context.basis), head = { ...basis.sources[0].head!, revision: '2', version_id: id(46), status: 'corrected' as const, effective_lab_result_id: id(47), value: '4.20' };
  basis.sources[0].head = head; basis.processing[0].lab_result_id = id(47);
  return { ...context, command: 'resolve_source_invalidation', kind: 'laboratory_order', workflow_revision: '4', basis,
    latest_review: latest, contact: { event_id: id(101), revision: '4', actor_id: id(1), occurred_at: at, recorded_at: at, review_event_id: latest.event_id,
      basis_signature: context.basis_signature, channel: 'phone', recipient_type: 'patient', recipient_reference: 'Synthetic source recipient' },
    invalidation: { invalidation_id: id(50), entry_id: id(41), composition_event_id: id(40), composition_revision: '2', analyte: 'potassium',
      root_id: id(42), observed_version_id: id(44), change_version_id: id(46), change_revision: '2', change_status: 'corrected',
      change_recorded_at: at, recorded_at: at, head, head_recorded_at: at } };
}
function sourceRow(current = sourceContext()) { const t = current.invalidation; return { id: t.invalidation_id, entry_id: t.entry_id,
  change_version_id: t.change_version_id, recorded_at: t.recorded_at, analyte: t.analyte, root_id: t.root_id, event_id: t.composition_event_id, resolution: null }; }
async function startSource(current = sourceContext()) {
  mocks.sourceContext.mockResolvedValue(ok(current)); mocks.changes.mockResolvedValue(ok({ work_item_id: id(5), items: [sourceRow(current), { ...sourceRow(current), id: id(51) }], next_cursor: null }));
  const view = render(<CareHumanPanel {...props} workflow={workflow(current)} />); refresh(); await waitFor(() => expect(mocks.ready).toHaveBeenLastCalledWith(true));
  change('Human record type', 'resolve_source_invalidation'); click('Load source-change history'); await screen.findByLabelText('Source change to reconcile');
  expect(screen.getByLabelText('Source change to reconcile')).toHaveValue(''); change('Source change to reconcile', current.invalidation.invalidation_id); evidence();
  await screen.findByLabelText('Exact changed-source origin'); return view;
}
function fillSource() {
  change('Source resolution disposition', 'retained_in_current_composition'); change('Source resolution reason', 'Reconciled corrected potassium');
  fireEvent.click(screen.getByRole('checkbox', { name: 'I explicitly attest that this exact source change was reviewed' }));
  change('Evidence of this source-specific review', 'Explicit review of corrected potassium');
  fireEvent.click(screen.getByRole('checkbox', { name: 'I explicitly attest that this exact source change was addressed in the referenced contact' }));
  change('Evidence of this source-specific contact', 'Explicit discussion of corrected potassium');
  change('Human record evidence', 'Synthetic source reconciliation'); change('Human occurrence at (UTC)', '2026-09-29T12:10');
  change('Human follow-up next action', 'Review remaining evidence'); change('Human next review at (UTC)', '2026-10-01T12:00');
}
describe('explicit recoverable source-change reconciliation UI', () => {
  it('requires an exact target, disposition and two unselected attestations, then freezes and acknowledges separately', async () => {
    await startSource(); expect(mocks.sourceContext).toHaveBeenCalledWith({ ...scope, work_item_id: id(5), invalidation_id: id(50) });
    expect(screen.getByLabelText('Source resolution disposition')).toHaveValue(''); expect(screen.queryByLabelText('Source resolution reason')).toBeNull();
    change('Source resolution disposition', 'retained_in_current_composition'); for (const checkbox of screen.getAllByRole('checkbox')) expect(checkbox).not.toBeChecked();
    fillSource(); submit(); await screen.findByText('Frozen source-change resolution');
    const sent = mocks.prepare.mock.calls[0][0]; expect(sent.payload.details).toMatchObject({ invalidation: sourceContext().invalidation,
      review_event_id: id(100), contact_event_id: id(101), source_reviewed: true, change_addressed_in_contact: true });
    expect(mocks.apply).not.toHaveBeenCalled(); click('Confirm human record'); await screen.findByText(/Human record saved at revision/);
    expect(mocks.apply).toHaveBeenCalledWith(sent); expect(mocks.ack).not.toHaveBeenCalled();
    click('Acknowledge human receipt'); await screen.findByRole('button', { name: 'Return to human recovery' });
  });
  it.each(['review', 'contact', 'later-head'] as const)('shows %s prerequisite failure and blocks new preparation', async (kind) => {
    const c = sourceContext(); if (kind === 'review') { c.latest_review = null; c.contact = null; }
    if (kind === 'contact') c.contact = null; if (kind === 'later-head') c.invalidation.head_recorded_at = '2026-09-29T12:01:00Z';
    await startSource(c); expect(screen.queryByRole('form')).toBeNull(); expect(screen.getByText(/Record those first, then reload/)).toBeInTheDocument(); expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it('does not treat missing attestation or a wrong disposition as a valid preparation', async () => {
    await startSource(); fillSource(); fireEvent.click(screen.getByRole('checkbox', { name: 'I explicitly attest that this exact source change was reviewed' }));
    submit(); expect(mocks.prepare).not.toHaveBeenCalled(); expect(screen.getByRole('alert')).toBeInTheDocument();
    change('Source resolution disposition', 'no_longer_used'); expect(screen.getByLabelText('Source resolution reason')).toHaveValue('');
    for (const checkbox of screen.getAllByRole('checkbox')) expect(checkbox).not.toBeChecked();
  });
  it('clears unsaved evidence on target switch and ignores an A to B to A stale context', async () => {
    await startSource(); fillSource(); const read = deferred(); mocks.sourceContext.mockReturnValueOnce(read.promise); evidence();
    change('Source change to reconcile', id(51)); change('Source change to reconcile', id(50));
    await act(async () => read.resolve(ok(sourceContext()))); expect(screen.queryByRole('form')).toBeNull();
    evidence(); await screen.findByLabelText('Source resolution disposition'); expect(screen.getByLabelText('Source resolution disposition')).toHaveValue('');
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it('preserves the exact lost-response request across workflow and peer changes', async () => {
    const c = sourceContext(), view = await startSource(c), pending = deferred(); mocks.prepare.mockReturnValueOnce(pending.promise); fillSource(); submit();
    const sent = mocks.prepare.mock.calls[0][0]; view.rerender(<CareHumanPanel {...props} workflow={{ ...workflow(c), assigned_to: id(99) }} peersReady={false} refreshToken={1} />);
    await act(async () => pending.resolve({ data: null, error: 'Unconfirmed' })); expect(screen.getByText('Frozen source-change resolution')).toBeInTheDocument();
    click('Check saved human request'); await screen.findByText('Human record prepared and recoverable; not yet recorded.'); expect(mocks.recover).toHaveBeenCalledWith(sent);
    click('Cancel human preparation'); await screen.findByText('Human preparation cancelled; this request recorded no human event.'); expect(mocks.cancel).toHaveBeenCalledWith(sent);
  });
  it('fences the selected-source response after a session change', async () => {
    await startSource(); const read = deferred(); mocks.sourceContext.mockReturnValueOnce(read.promise); evidence();
    const listener = mocks.subscribe.mock.calls[0][0]; act(() => { listener('SIGNED_IN', { user: { id: id(99) } }); listener('SIGNED_IN', { user: { id: id(1) } }); });
    await act(async () => read.resolve(ok(sourceContext()))); expect(screen.getByRole('alert')).toHaveTextContent('Your session changed'); expect(screen.queryByRole('form')).toBeNull();
  });
  it('retains cancellation and removed-root evidence without declaring usable results or complete care', async () => {
    const c = sourceContext(); c.basis.sources[0].root_id = id(99); c.basis.composition_event_id = id(98);
    c.invalidation.head = { ...c.invalidation.head, status: 'cancelled', value: null, effective_lab_result_id: null }; c.invalidation.change_status = 'cancelled';
    await startSource(c); expect(screen.getByText('Cancelled source; no usable value')).toBeInTheDocument(); expect(screen.getByText(/source was removed/)).toBeInTheDocument();
    fillSource(); change('Source resolution disposition', 'no_longer_used'); expect(screen.getByLabelText('Source resolution reason')).toHaveValue('');
  });
  it('does not start a source context after a failed list or with only resolved targets', async () => {
    render(<CareHumanPanel {...props} />); change('Human record type', 'resolve_source_invalidation');
    mocks.changes.mockResolvedValueOnce({ data: null, error: 'Unavailable' }); click('Load source-change history'); await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Load evidence for this human record' })).toBeDisabled(); expect(mocks.sourceContext).not.toHaveBeenCalled();
    mocks.changes.mockResolvedValueOnce(ok({ work_item_id: id(5), items: [{ ...sourceRow(), resolution: { event_id: id(90), revision: '5', recorded_at: at, disposition: 'no_longer_used' } }], next_cursor: null }));
    click('Load source-change history'); await screen.findByText(/No unresolved change appeared/); expect(screen.queryByRole('form')).toBeNull();
    expect(screen.getByText(/Recorded source resolutions/)).toBeInTheDocument();
  });
  it.each(['empty', 'failed'] as const)('requires the source list tail after 25 records: %s', async (tail) => {
    render(<CareHumanPanel {...props} />); change('Human record type', 'resolve_source_invalidation');
    const rows = Array.from({ length: 25 }, (_, n) => ({ ...sourceRow(), id: id(500 + n) })), last = deferred();
    mocks.changes.mockResolvedValueOnce(ok({ work_item_id: id(5), items: rows, next_cursor: id(524) })).mockReturnValueOnce(last.promise);
    click('Load source-change history'); await waitFor(() => expect(mocks.changes).toHaveBeenCalledTimes(2));
    expect(mocks.changes).toHaveBeenLastCalledWith({ ...scope, work_item_id: id(5), after: id(524) });
    expect(screen.queryByLabelText('Source change to reconcile')).toBeNull();
    await act(async () => last.resolve(tail === 'empty' ? ok({ work_item_id: id(5), items: [], next_cursor: null }) : { data: null, error: 'Unavailable' }));
    if (tail === 'empty') expect(screen.getByLabelText('Source change to reconcile')).toHaveValue(''); else expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(mocks.sourceContext).not.toHaveBeenCalled(); expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it('recovers an expired applied source request without a current workflow or source context', async () => {
    await startSource(); fillSource(); submit(); await screen.findByText('Frozen source-change resolution');
    const sent = mocks.prepare.mock.calls[0][0] as HumanInput; cleanup(); mocks.prepare.mockClear(); mocks.sourceContext.mockClear(); mocks.changes.mockClear();
    const old = { ...sent, payload: { ...sent.payload, next_review_at: '2020-01-01T00:00:00Z' } };
    mocks.list.mockResolvedValue(ok({ items: [saved(old, 'applied')], next_cursor: null })); mocks.recover.mockResolvedValue(ok(saved(old, 'applied')));
    render(<CareHumanPanel {...props} workflow={null} peersReady={false} />); refresh();
    fireEvent.click(await screen.findByRole('button', { name: 'Recover human request ' + old.request_id }));
    await screen.findByText(/Human record saved at revision/); expect(mocks.recover).toHaveBeenCalledWith(old);
    expect(screen.getByText('Frozen source-change resolution')).toBeInTheDocument(); click('Acknowledge human receipt');
    await screen.findByRole('button', { name: 'Return to human recovery' }); expect(mocks.ack).toHaveBeenCalledWith(old);
    expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.sourceContext).not.toHaveBeenCalled(); expect(mocks.changes).not.toHaveBeenCalled();
  });
});

const barrier = { exception_id: id(300), origin_event_id: id(301), human_origin_event_id: null, origin_revision: '2', origin_occurred_at: at,
  code: 'report_missing' as const, reason: 'Missing synthetic report', next_action: 'Locate missing report', next_review_at: due, recorded_at: at };
const resolutionContext: HumanContext = { ...context, command: 'resolve_exception', exceptions: [barrier, { ...barrier, exception_id: id(302), reason: 'Second missing report' }] };
async function startResolution(current: HumanContext = resolutionContext) {
  mocks.context.mockResolvedValue(ok(current)); const view = render(<CareHumanPanel {...props} workflow={workflow(current)} />);
  refresh(); await waitFor(() => expect(mocks.ready).toHaveBeenLastCalledWith(true)); change('Human record type', 'resolve_exception'); evidence();
  await screen.findByRole('form', { name: 'New human record' }); return view;
}
function fillResolution() {
  change('Barrier to resolve', barrier.exception_id); change('Resolution disposition', 'barrier_addressed');
  change('Resolution reason', 'Report location verified'); change('Human record evidence', 'Synthetic resolution evidence');
  change('Human occurrence at (UTC)', '2026-09-29T12:00'); change('Human follow-up next action', 'Review remaining evidence');
  change('Human next review at (UTC)', '2026-10-01T12:00');
}
describe('explicit recoverable barrier resolution UI', () => {
  it.each(['laboratory_order', 'referral', 'medication_access'] as const)('supports %s without a clinical review default', async (kind) => {
    const current: HumanContext = kind === 'laboratory_order' ? resolutionContext : { ...resolutionContext, kind, stage: 'requested',
      basis: { kind, sources: [], processing: [], operational_event: null, composition_event_id: null } };
    await startResolution(current); expect(screen.getByLabelText('Barrier to resolve')).toHaveValue('');
    expect(screen.queryByLabelText('Resolution reason')).toBeNull(); expect(screen.queryByRole('button', { name: 'Prepare human record for review' })).toBeNull();
    fillResolution(); expect(screen.getByLabelText('Exact barrier origin')).toHaveTextContent(barrier.origin_event_id);
    submit(); await screen.findByText('Frozen barrier resolution');
    expect(mocks.prepare.mock.calls[0][0]).toMatchObject({ command: 'resolve_exception', basis: current.basis,
      payload: { details: { exception: barrier, disposition: 'barrier_addressed', resolution_reason: 'Report location verified' } } });
    expect(mocks.apply).not.toHaveBeenCalled();
  });
  it('clears unsaved facts and disposition on target change, including returning to the first target', async () => {
    await startResolution(); fillResolution(); change('Barrier to resolve', id(302));
    expect(screen.getByLabelText('Resolution disposition')).toHaveValue(''); expect(screen.queryByLabelText('Resolution reason')).toBeNull();
    change('Resolution disposition', 'barrier_addressed'); expect(screen.getByLabelText('Resolution reason')).toHaveValue('');
    expect(screen.getByLabelText('Human record evidence')).toHaveValue(''); expect(screen.getByLabelText('Human next review at (UTC)')).toHaveValue('');
    change('Barrier to resolve', barrier.exception_id); change('Resolution disposition', 'clinical_non_delivery');
    expect(screen.getByLabelText('Resolution reason')).toHaveValue(''); expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it('clears evidence when changing disposition instead of carrying operational evidence into a clinical declaration', async () => {
    await startResolution(); fillResolution(); change('Resolution disposition', 'clinical_non_delivery');
    expect(screen.getByLabelText('Resolution reason')).toHaveValue(''); expect(screen.getByLabelText('Human record evidence')).toHaveValue('');
    expect(screen.getByText(/Clinical permission is rechecked/)).toBeInTheDocument();
  });
  it('clears selection and form when evidence is reloaded', async () => {
    await startResolution(); fillResolution(); evidence(); await screen.findByLabelText('Barrier to resolve');
    expect(screen.getByLabelText('Barrier to resolve')).toHaveValue(''); expect(screen.queryByLabelText('Resolution reason')).toBeNull();
  });
  it('never offers new preparation with no open targets', async () => {
    mocks.context.mockResolvedValue(ok({ ...resolutionContext, exceptions: [] })); render(<CareHumanPanel {...props} />);
    refresh(); await waitFor(() => expect(mocks.ready).toHaveBeenLastCalledWith(true)); change('Human record type', 'resolve_exception'); evidence();
    await screen.findByText(/No open barrier was returned/); expect(screen.queryByRole('form')).toBeNull();
  });
  it('rejects an occurrence before the exact origin without allocating a request', async () => {
    await startResolution(); fillResolution(); change('Human occurrence at (UTC)', '2026-09-29T11:59'); submit();
    expect(screen.getByRole('alert')).toHaveTextContent('nonfuture occurrence'); expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it('keeps frozen target during lost apply response, peer invalidation and ownership loss', async () => {
    const view = await startResolution(); fillResolution(); submit(); await screen.findByText(/Human record prepared and recoverable/);
    const exact = mocks.prepare.mock.calls[0][0], pending = deferred(); mocks.apply.mockReturnValueOnce(pending.promise); click('Confirm human record');
    view.rerender(<CareHumanPanel {...props} workflow={null} peersReady={false} refreshToken={1} />);
    await act(async () => pending.resolve({ data: null, error: 'lost response' })); await screen.findByText(/Human record state is unconfirmed/);
    expect(screen.getByLabelText('Frozen human request')).toHaveTextContent(barrier.exception_id);
    mocks.recover.mockResolvedValueOnce(ok(saved(exact, 'applied'))); click('Check saved human request');
    await screen.findByText(/Human record saved at revision 4/); expect(mocks.recover).toHaveBeenCalledExactlyOnceWith(exact);
    expect(screen.getByLabelText('Frozen human request')).not.toHaveTextContent('Human contact');
    click('Acknowledge human receipt'); await screen.findByRole('button', { name: 'Return to human recovery' });
  });
  it('recovers an expired prepared resolution when context is unavailable and current owner changed', async () => {
    const exact: HumanInput = { ...input, command: 'resolve_exception', payload: { ...common, next_review_at: '2020-01-01T00:00:00Z',
      details: { exception: barrier, disposition: 'clinical_non_delivery', resolution_reason: 'Documented non-delivery' } } };
    mocks.list.mockResolvedValue(ok({ items: [saved(exact)], next_cursor: null })); mocks.context.mockResolvedValue({ data: null, error: 'denied' });
    render(<CareHumanPanel {...props} workflow={{ ...props.workflow, assigned_to: id(99), ownership_revision: '2' }} peersReady={false} />);
    refresh(); await screen.findByLabelText('Pending human requests'); evidence(); await screen.findByText(/Current human evidence is unavailable/);
    click(`Recover human request ${exact.request_id}`); await screen.findByText('Frozen barrier resolution');
    click('Cancel human preparation'); await screen.findByText(/Human preparation cancelled/); expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith(exact);
  });
  it.each(['session', 'route'])('fences a late resolution response after %s change', async (kind) => {
    const view = await startResolution(); fillResolution(); const pending = deferred(); mocks.prepare.mockReturnValueOnce(pending.promise); submit();
    const exact = mocks.prepare.mock.calls[0][0];
    if (kind === 'session') { const listener = mocks.subscribe.mock.calls[0][0]; act(() => {
      listener('SIGNED_IN', { user: { id: id(999) } }); listener('SIGNED_IN', { user: { id: id(1) } });
    }); } else view.rerender(<CareHumanPanel {...props} workId={id(999)} workflow={null} />);
    await act(async () => pending.resolve(ok(saved(exact, 'applied'))));
    expect(screen.queryByLabelText('Frozen human request')).toBeNull(); expect(mocks.changed).not.toHaveBeenCalled();
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function click(name: string) { fireEvent.click(screen.getByRole('button', { name })); }
function change(name: string, value: string) { fireEvent.change(screen.getByLabelText(name), { target: { value } }); }
function refresh() { click('Check human pending records'); }
function evidence() { click('Load evidence for this human record'); }
async function start(current = props) {
  const view = render(<CareHumanPanel {...current} />); refresh(); await waitFor(() => expect(mocks.ready).toHaveBeenLastCalledWith(true));
  evidence(); await screen.findByRole('form', { name: 'New human record' }); return view;
}
function fill() {
  change('Human record evidence', common.evidence); change('Human occurrence at (UTC)', '2026-09-29T12:00');
  change('Human follow-up next action', common.next_action); change('Human next review at (UTC)', '2026-10-01T12:00');
  if (screen.queryByLabelText('Professional decision')) { change('Professional decision', 'Synthetic decision'); change('Evidence limitations', 'Partial evidence remains'); }
  else { change('Contact channel', 'phone'); change('Recipient type', 'patient'); change('Recipient reference (synthetic only)', 'Synthetic recipient'); change('Contact outcome', 'human_reached'); }
}
function submit() { fireEvent.submit(screen.getByRole('form', { name: 'New human record' })); }
async function prepare() { const view = await start(); fill(); submit(); await screen.findByText('Human record prepared and recoverable; not yet recorded.'); return view; }
async function contact(current = { ...context, command: 'record_contact' as const, latest_review: latest }) {
  mocks.context.mockResolvedValue(ok(current)); render(<CareHumanPanel {...props} workflow={workflow(current)} />);
  refresh(); await waitFor(() => expect(mocks.ready).toHaveBeenLastCalledWith(true)); change('Human record type', 'record_contact'); evidence();
  await screen.findByRole('form', { name: 'New human record' }); fill();
}

describe('human review and contact entry', () => {
  it('requires explicit recovery and evidence reads; never prepares or applies automatically', async () => {
    render(<CareHumanPanel {...props} />); expect(screen.queryByRole('form')).toBeNull(); expect(mocks.list).not.toHaveBeenCalled();
    evidence(); await screen.findByLabelText('Evidence before human preparation'); expect(screen.queryByRole('form')).toBeNull();
    refresh(); await waitFor(() => expect(mocks.ready).toHaveBeenLastCalledWith(true)); expect(screen.queryByRole('form')).toBeNull();
    evidence(); await screen.findByRole('form'); expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.apply).not.toHaveBeenCalled();
  });
  it('shows exact sources before freezing review and separately confirms and acknowledges', async () => {
    await start(); expect(within(screen.getByLabelText('Evidence before human preparation')).getByText('Potassium: 4.60 mEq/L')).toBeInTheDocument();
    fill(); submit(); await screen.findByText('Human record prepared and recoverable; not yet recorded.');
    const exact = mocks.prepare.mock.calls[0][0]; expect(exact).toMatchObject({ ...input, request_id: expect.any(String) }); expect(mocks.apply).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Frozen human request')).toHaveTextContent('Partial evidence remains');
    click('Confirm human record'); await screen.findByText(/Human record saved at revision 4/);
    expect(mocks.apply).toHaveBeenCalledExactlyOnceWith(exact); expect(mocks.ack).not.toHaveBeenCalled(); expect(mocks.changed).toHaveBeenCalledTimes(1);
    click('Acknowledge human receipt'); await screen.findByRole('button', { name: 'Return to human recovery' });
    expect(mocks.ack).toHaveBeenCalledExactlyOnceWith(exact);
  });
  it.each(['referral', 'medication_access'] as const)('permits documented %s review with its displayed operational evidence', async (kind) => {
    const current: HumanContext = { ...context, kind, stage: kind === 'referral' ? 'report_received' : 'obtained', basis: {
      kind, composition_event_id: null, sources: [], processing: [], operational_event: { event_id: id(50), revision: '2', occurred_at: at, recorded_at: at,
        command: kind === 'referral' ? 'record_report' : 'record_obtained', payload: { ...common, details: kind === 'referral' ? { report_reference: 'Synthetic referral report' } : { source: 'patient_report' } } } } };
    mocks.context.mockResolvedValue(ok(current)); await start({ ...props, workflow: workflow(current) }); fill(); submit();
    await screen.findByLabelText('Frozen human request'); expect(mocks.prepare.mock.calls[0][0].basis).toEqual(current.basis);
  });
  it.each(['laboratory_order', 'referral', 'medication_access'] as const)('documents early %s contact without inventing a review', async (kind) => {
    const current: HumanContext = { ...context, kind, stage: 'requested', command: 'record_contact', latest_review: null, basis: kind === 'laboratory_order'
      ? { ...context.basis, composition_event_id: null, sources: [{ ...context.basis.sources[0], entry_id: null, root_id: null,
        authority_organization_id: null, original_lab_result_id: null, observed_version_id: null, head: null, quality: 'missing', evaluation_status: null }], processing: [] }
      : { kind, composition_event_id: null, sources: [], processing: [], operational_event: null } };
    await contact(current); submit(); await screen.findByLabelText('Frozen human request');
    expect(mocks.prepare.mock.calls[0][0].payload.details).toMatchObject({ review_event_id: null, review_addressed: false });
  });
  it('requires explicit current review selection, and clears addressed on outcome change', async () => {
    await contact(); const checkbox = screen.getByRole('checkbox'); expect(checkbox).toBeDisabled();
    change('Review reference', 'latest'); expect(checkbox).toBeEnabled(); fireEvent.click(checkbox); expect(checkbox).toBeChecked();
    change('Contact outcome', 'no_answer'); expect(checkbox).not.toBeChecked(); expect(checkbox).toBeDisabled();
    change('Contact barrier reason', 'No answer at documented time'); submit(); await screen.findByLabelText('Frozen human request');
    const exact = mocks.prepare.mock.calls[0][0]; expect(exact.payload.details).toMatchObject({ outcome: 'no_answer', review_addressed: false,
      review_event_id: latest.event_id, reason: 'No answer at documented time', exception_id: expect.any(String) });
    expect(exact.payload.details.exception_id).not.toBe(exact.request_id);
  });
  it('rejects addressed occurrence before the displayed review before allocating UUIDs', async () => {
    await contact(); const uuid = vi.spyOn(crypto, 'randomUUID'); change('Review reference', 'latest'); fireEvent.click(screen.getByRole('checkbox'));
    change('Human occurrence at (UTC)', '2026-09-29T11:59'); submit(); expect(await screen.findByRole('alert')).toHaveTextContent('occurrence not before');
    expect(uuid).not.toHaveBeenCalled(); expect(mocks.prepare).not.toHaveBeenCalled();
    change('Human occurrence at (UTC)', '2026-09-29T12:00'); submit(); await screen.findByLabelText('Frozen human request');
    expect(mocks.prepare.mock.calls[0][0].payload.details.review_addressed).toBe(true);
    expect(screen.getByLabelText('Frozen human request')).toHaveTextContent('Declared as addressing the referenced review. Application state is shown separately.');
    expect(screen.queryByText('Recorded as addressing the referenced review at that time.')).toBeNull();
  });
  it('does not qualify a stale referenced review', async () => {
    await contact({ ...context, command: 'record_contact', latest_review: { ...latest, is_current: false, basis_signature: 'b'.repeat(64) } });
    change('Review reference', 'latest'); expect(screen.getByRole('checkbox')).toBeDisabled(); submit(); await screen.findByLabelText('Frozen human request');
    expect(mocks.prepare.mock.calls[0][0].payload.details.review_addressed).toBe(false);
  });
  it('validates content and dates before generating durable identities', async () => {
    await start(); const uuid = vi.spyOn(crypto, 'randomUUID'); fill(); change('Evidence limitations', ' '); submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('Verify evidence'); expect(uuid).not.toHaveBeenCalled(); expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it.each([{ revision: '4' }, { ownership_revision: '2' }, { transfer_pending_to: id(99) }, { accepted_by: null }, { work_status: 'closed' as const }])('prevents new writing from incompatible workflow %#', async (change) => {
    render(<CareHumanPanel {...props} workflow={{ ...props.workflow, ...change }} />); refresh(); await waitFor(() => expect(mocks.ready).toHaveBeenLastCalledWith(true));
    evidence(); await screen.findByLabelText('Evidence before human preparation'); expect(screen.queryByRole('form')).toBeNull();
  });
  it('keeps own readiness independent of peers without enabling a new write', async () => {
    const view = render(<CareHumanPanel {...props} peersReady={false} />); refresh(); await waitFor(() => expect(mocks.ready).toHaveBeenLastCalledWith(true));
    evidence(); await screen.findByLabelText('Evidence before human preparation'); expect(screen.queryByRole('form')).toBeNull();
    view.rerender(<CareHumanPanel {...props} />); await screen.findByRole('form');
  });
});

describe('human recovery and stale response fences', () => {
  it.each(['empty', 'failed'] as const)('waits for 25 rows plus the %s tail before readiness', async (outcome) => {
    const rows = Array.from({ length: 25 }, (_, n) => saved({ ...input, request_id: id(200 + n), work_item_id: id(999) }));
    const tail = deferred(); mocks.list.mockResolvedValueOnce(ok({ items: rows, next_cursor: id(224) })).mockReturnValueOnce(tail.promise);
    render(<CareHumanPanel {...props} />); refresh(); await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
    expect(mocks.ready).toHaveBeenLastCalledWith(false); expect(screen.queryByRole('form')).toBeNull();
    await act(async () => tail.resolve(outcome === 'empty' ? empty() : { data: null, error: 'failed' }));
    expect(mocks.ready).toHaveBeenLastCalledWith(outcome === 'empty'); expect(screen.getAllByRole('link', { name: 'Open other follow-up' })).toHaveLength(25);
  });
  it('restores readiness after a fully batched immediate refresh', async () => {
    await start(); mocks.ready.mockClear(); await act(async () => refresh()); expect(mocks.ready).toHaveBeenLastCalledWith(true);
    expect(screen.queryByRole('form')).toBeNull();
  });
  it('recovers and cancels expired prepared evidence without current context, ownership or peer readiness', async () => {
    const expired = { ...input, payload: { ...input.payload, next_review_at: '2020-01-01T00:00:00Z' } };
    mocks.list.mockResolvedValue(ok({ items: [saved(expired)], next_cursor: null })); mocks.context.mockResolvedValue({ data: null, error: 'denied' });
    render(<CareHumanPanel {...props} workflow={null} peersReady={false} />); refresh(); await screen.findByRole('button', { name: `Recover human request ${id(10)}` });
    click(`Recover human request ${id(10)}`); await screen.findByText('Human record prepared and recoverable; not yet recorded.');
    click('Cancel human preparation'); await screen.findByText('Human preparation cancelled; this request recorded no human event.');
    expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith(expired); expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.context).not.toHaveBeenCalled();
  });
  it.each(['apply', 'cancel'] as const)('preserves an exact unknown %s outcome and recovers applied state', async (action) => {
    await prepare(); const exact = mocks.prepare.mock.calls[0][0]; mocks[action].mockRejectedValueOnce(new Error('response lost'));
    click(action === 'apply' ? 'Confirm human record' : 'Cancel human preparation'); await screen.findByText(/Human record state is unconfirmed/);
    expect(screen.queryByRole('form')).toBeNull(); expect(mocks.prepare).toHaveBeenCalledTimes(1);
    mocks.recover.mockResolvedValue(ok(saved(exact, 'applied'))); click('Check saved human request'); await screen.findByText(/Human record saved at revision 4/);
    expect(mocks.recover).toHaveBeenLastCalledWith(exact); expect(mocks.apply).toHaveBeenCalledTimes(action === 'apply' ? 1 : 0);
  });
  it('reports applied when cancel loses instead of claiming cancellation', async () => {
    await prepare(); mocks.cancel.mockImplementation(async (value) => ok(saved(value, 'applied'))); click('Cancel human preparation');
    await screen.findByText(/Human record saved at revision 4/); expect(screen.queryByText(/preparation cancelled;/)).toBeNull();
  });
  it('retries unknown preparation with identical UUID and payload', async () => {
    mocks.prepare.mockRejectedValueOnce(new Error('response lost')); await start(); fill(); submit(); await screen.findByText(/Human record state is unconfirmed/);
    const exact = mocks.prepare.mock.calls[0][0]; click('Retry human preparation with same ID'); await screen.findByText('Human record prepared and recoverable; not yet recorded.');
    expect(mocks.prepare).toHaveBeenLastCalledWith(exact); expect(mocks.apply).not.toHaveBeenCalled();
  });
  it('keeps exact private write when sibling workflow and refresh token change', async () => {
    const view = await prepare(), pending = deferred(); mocks.apply.mockReturnValueOnce(pending.promise); click('Confirm human record');
    const exact = mocks.prepare.mock.calls[0][0]; view.rerender(<CareHumanPanel {...props} workflow={null} peersReady={false} refreshToken={1} />);
    await act(async () => pending.resolve(ok(saved(exact, 'applied')))); expect(screen.getByText(/Human record saved at revision 4/)).toBeInTheDocument();
    expect(screen.getByLabelText('Frozen human request')).toHaveTextContent(exact.request_id);
  });
  it('cannot reuse a decision for corrected evidence loaded on the same workflow revision', async () => {
    await start(); fill(); const corrected = structuredClone(context); corrected.basis_signature = 'b'.repeat(64);
    corrected.basis.sources[0].head!.value = '9.90'; corrected.basis.sources[0].head!.revision = '2'; corrected.basis.sources[0].head!.version_id = id(999);
    mocks.context.mockResolvedValue(ok(corrected)); evidence(); await screen.findByText('Potassium: 9.90 mEq/L');
    expect(screen.getByLabelText('Professional decision')).toHaveValue(''); expect(screen.getByLabelText('Evidence limitations')).toHaveValue(''); expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it('clears contact attestation when latest review changes with the same basis', async () => {
    await contact(); change('Review reference', 'latest'); fireEvent.click(screen.getByRole('checkbox'));
    mocks.context.mockResolvedValue(ok({ ...context, command: 'record_contact', latest_review: { ...latest, event_id: id(101) } }));
    evidence(); await screen.findByText(`Review event: ${id(101)}`);
    expect(screen.getByRole('checkbox')).not.toBeChecked(); expect(screen.getByLabelText('Review reference')).toHaveValue('');
    expect(screen.getByLabelText('Recipient reference (synthetic only)')).toHaveValue('');
  });
  it('ignores late context after command change', async () => {
    await start(); const pending = deferred(); mocks.context.mockReturnValueOnce(pending.promise); evidence(); change('Human record type', 'record_contact');
    await act(async () => pending.resolve(ok(context))); expect(screen.queryByRole('form')).toBeNull();
    expect(screen.queryByLabelText('Evidence before human preparation')).toBeNull(); evidence(); await screen.findByLabelText('Contact channel');
  });
  it('restores readiness when a context read is cancelled in the same render batch', async () => {
    await start(); const pending = deferred(); mocks.context.mockReturnValueOnce(pending.promise); mocks.ready.mockClear();
    await act(async () => { evidence(); change('Human record type', 'record_contact'); });
    expect(mocks.ready).toHaveBeenLastCalledWith(true);
    await act(async () => pending.resolve(ok(context))); expect(screen.queryByRole('form')).toBeNull();
  });
  it('does not silently rebase a request after ownership changes between preparation and apply', async () => {
    const view = await prepare(); const exact = mocks.prepare.mock.calls[0][0];
    view.rerender(<CareHumanPanel {...props} workflow={{ ...props.workflow, ownership_revision: '2', assigned_to: id(999) }} />);
    mocks.apply.mockResolvedValueOnce({ data: null, error: 'stale revision' }); click('Confirm human record');
    await screen.findByText(/Human record state is unconfirmed/); expect(mocks.apply).toHaveBeenCalledExactlyOnceWith(exact);
    click('Check saved human request'); await screen.findByText('Human record prepared and recoverable; not yet recorded.');
    click('Cancel human preparation'); await screen.findByText('Human preparation cancelled; this request recorded no human event.');
    expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith(exact);
  });
  it('ignores an older recovery after a newer parent refresh', async () => {
    const pending = deferred(); mocks.list.mockReturnValueOnce(pending.promise);
    const view = render(<CareHumanPanel {...props} refreshToken={1} />); await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1));
    view.rerender(<CareHumanPanel {...props} refreshToken={2} />); await waitFor(() => expect(mocks.ready).toHaveBeenLastCalledWith(true));
    await act(async () => pending.resolve(ok({ items: [saved()], next_cursor: null })));
    expect(screen.queryByLabelText('Pending human requests')).toBeNull(); expect(mocks.ready).toHaveBeenLastCalledWith(true);
  });
  it('permanently fences A to B to A and ignores a late write', async () => {
    await prepare(); const pending = deferred(); mocks.apply.mockReturnValueOnce(pending.promise); click('Confirm human record');
    const listener = mocks.subscribe.mock.calls[0][0];
    act(() => { listener('SIGNED_IN', { user: { id: id(999) } }); listener('SIGNED_IN', { user: { id: id(1) } }); });
    await act(async () => pending.resolve(ok(saved(input, 'applied')))); expect(screen.getByRole('alert')).toHaveTextContent('session changed');
    expect(screen.queryByLabelText('Frozen human request')).toBeNull(); expect(mocks.changed).not.toHaveBeenCalled();
  });
  it('fences a route change and does not deliver old writes to the next work item', async () => {
    const view = await prepare(), pending = deferred(); mocks.apply.mockReturnValueOnce(pending.promise); click('Confirm human record');
    view.rerender(<CareHumanPanel {...props} workId={id(999)} workflow={null} />);
    await act(async () => pending.resolve(ok(saved(input, 'applied')))); expect(screen.queryByLabelText('Frozen human request')).toBeNull(); expect(mocks.changed).not.toHaveBeenCalled();
  });
});
