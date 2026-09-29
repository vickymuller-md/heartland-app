import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ prepare: vi.fn(), recover: vi.fn(), apply: vi.fn(), cancel: vi.fn(), ack: vi.fn(),
  detail: vi.fn(), list: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn(), authorize: vi.fn(), directory: vi.fn() }));
vi.mock('@/lib/care-workflow/step-actions', () => ({ prepareCareStep: mocks.prepare, recoverCareStep: mocks.recover,
  applyCareStep: mocks.apply, cancelCareStep: mocks.cancel, acknowledgeCareStep: mocks.ack,
  loadCareWorkflow: mocks.detail, loadPendingCareSteps: mocks.list }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { onAuthStateChange: mocks.subscribe } }) }));
vi.mock('@/lib/auth/authorization', () => ({ authorize: mocks.authorize }));
vi.mock('@/lib/team/queries', () => ({ getTeamDirectory: mocks.directory }));
vi.mock('@/components/disclaimers/provider-page-disclaimer', () => ({ ProviderPageDisclaimer: () => <p>Synthetic boundary</p> }));
import { CareWorkflowPanel } from '@/app/(provider)/patients/[patientId]/_components/care-workflow-panel';
import CareWorkflowPage from '@/app/(provider)/patients/[patientId]/care/[workId]/page';
import { CARE_STEP_UNCONFIRMED, type CareStepInput, type CareStepState, type CareWorkflowDetail } from '@/lib/care-workflow/step-types';
const id = (n: number) => `60000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = '2026-09-29T12:00:00Z'; const due = '2026-10-01T12:00:00Z';
const detail: CareWorkflowDetail = { work_item_id: id(5), patient_id: id(2), organization_id: id(3), assigned_to: id(1), accepted_by: id(1),
  accepted_at: at, transfer_pending_to: null, ownership_revision: '7', due_at: due, kind: 'laboratory_order', stage: 'requested', revision: '1',
  requested_analytes: ['potassium'], request: { kind: 'laboratory_order', source: 'external_documented', purpose: 'Synthetic follow-up', evidence: 'Original source', occurred_at: at, next_review_at: due, analytes: ['potassium'] },
  events: [{ id: id(9), actor_id: id(1), revision: '1', event_type: 'request_recorded', occurred_at: at, recorded_at: at }],
  next_action: 'Review next step', next_review_at: due, work_status: 'new', steps: [], exceptions: [] };
const props = { actorId: id(1), patientId: id(2), organizationId: id(3), workId: id(5), initial: detail, scopeKey: 'snapshot1' };
const input: CareStepInput = { actor_id: id(1), patient_id: id(2), organization_id: id(3), work_item_id: id(5), request_id: id(4),
  expected_revision: '1', expected_ownership_revision: '7', command: 'record_collection',
  payload: { occurred_at: at, evidence: '  Original_collection_reference  ', next_action: 'Check result next', next_review_at: due, details: {} } };
function saved(value = input, state: CareStepState['state'] = 'prepared'): CareStepState {
  return { ...value, state, recorded_at: at, acknowledged_at: null, receipt: state === 'applied' ? {
    request_id: value.request_id, work_item_id: value.work_item_id, event_id: id(6), workflow_revision: String(BigInt(value.expected_revision) + BigInt(1)),
    ownership_revision: value.expected_ownership_revision, stage: value.command === 'record_collection' ? 'collected' : 'requested', exception_id: null,
    due_at: due, recorded_at: at, clinical_review_recorded: false, communication_confirmed: false, care_completed: false,
  } : null };
}
const ok = (data: unknown) => ({ data, error: null });
function deferred() { let resolve!: (value: unknown) => void; let reject!: (error: Error) => void;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeEach(() => {
  vi.resetAllMocks(); vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-29T13:00:00Z'));
  mocks.subscribe.mockReturnValue({ data: { subscription: { unsubscribe: mocks.unsubscribe } } });
  mocks.detail.mockResolvedValue(ok(detail)); mocks.list.mockResolvedValue(ok({ items: [], next_cursor: null }));
  mocks.prepare.mockImplementation(async (value) => ok(saved(value)));
  mocks.recover.mockImplementation(async (value) => ok(saved(value)));
  mocks.apply.mockImplementation(async (value) => ok(saved(value, 'applied')));
  mocks.cancel.mockImplementation(async (value) => ok(saved(value, 'cancelled')));
  mocks.ack.mockImplementation(async (value) => ok({ ...saved(value, 'applied'), acknowledged_at: at }));
  mocks.authorize.mockResolvedValue({ authorized: true, user: { id: id(1) }, supabase: {} });
  mocks.directory.mockResolvedValue({ members: [{ is_self: true, organization_id: id(3), organization_name: 'Clinic A' }] });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function refresh() { fireEvent.click(screen.getByRole('button', { name: 'Refresh workflow and check pending steps' })); }
async function start(initial = detail) { mocks.detail.mockResolvedValue(ok(initial)); render(<CareWorkflowPanel {...props} initial={initial} />); refresh(); await screen.findByRole('form', { name: 'New documented step' }); }
function fill(command = 'record_collection') {
  fireEvent.change(screen.getByLabelText('Step to document'), { target: { value: command } });
  for (const [label, value] of [['Evidence or source reference', input.payload.evidence], ['Occurred at (UTC)', '2026-09-29T12:00'],
    ['Next action', input.payload.next_action], ['Next review at (UTC)', '2026-10-01T12:00']]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
}
function change(label: string, value: string) { fireEvent.change(screen.getByLabelText(label), { target: { value } }); }
function submit() { fireEvent.submit(screen.getByRole('form', { name: 'New documented step' })); }
async function prepare() { await start(); fill(); submit(); await screen.findByText(/Prepared and recoverable/); }
describe('recoverable operational steps', () => {
  it('does not fetch or prepare automatically and requires complete fresh context', async () => {
    render(<CareWorkflowPanel {...props} />); expect(mocks.detail).not.toHaveBeenCalled(); expect(screen.queryByRole('form')).toBeNull();
    refresh(); await screen.findByRole('form'); expect(mocks.detail).toHaveBeenCalledExactlyOnceWith({ actor_id: id(1), patient_id: id(2), work_item_id: id(5) });
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith({ actor_id: id(1), patient_id: id(2), organization_id: id(3), after: null });
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it('freezes exact evidence and both revisions, with separate preparation/application/ACK', async () => {
    await prepare(); const frozen = mocks.prepare.mock.calls[0][0];
    expect(frozen.payload).toEqual(input.payload); expect(frozen.expected_revision).toBe('1'); expect(frozen.expected_ownership_revision).toBe('7');
    expect(mocks.apply).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: 'Confirm documented step' }));
    await screen.findByText(/Step recorded at revision 2/); expect(mocks.apply).toHaveBeenCalledExactlyOnceWith(frozen);
    expect(mocks.ack).not.toHaveBeenCalled(); expect(screen.queryByRole('form')).toBeNull();
    expect(screen.getByText(/snapshot above has not been refreshed/)).toBeInTheDocument();
  });
  it('retains the same identity on lost preparation response and explicit retry', async () => {
    mocks.prepare.mockRejectedValueOnce(new Error('network unavailable')); await start(); fill(); submit();
    await screen.findByText(CARE_STEP_UNCONFIRMED); const frozen = mocks.prepare.mock.calls[0][0];
    fireEvent.click(screen.getByRole('button', { name: 'Retry preparation with same ID' }));
    await screen.findByText(/Prepared and recoverable/); expect(mocks.prepare).toHaveBeenNthCalledWith(2, frozen); expect(mocks.apply).not.toHaveBeenCalled();
  });
  it('recovers an ambiguous apply read-only instead of rebasing or preparing a replacement', async () => {
    await prepare(); mocks.apply.mockResolvedValueOnce({ data: null, error: '40001' });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm documented step' })); await screen.findByText(CARE_STEP_UNCONFIRMED);
    expect(screen.queryByRole('button', { name: 'Confirm documented step' })).toBeNull(); expect(screen.queryByRole('form')).toBeNull();
    mocks.recover.mockImplementationOnce(async (value) => ok(saved(value, 'applied')));
    fireEvent.click(screen.getByRole('button', { name: 'Check saved step' })); await screen.findByText(/Step recorded at revision 2/);
    expect(mocks.prepare).toHaveBeenCalledOnce(); expect(mocks.apply).toHaveBeenCalledOnce();
    expect(mocks.recover).toHaveBeenCalledExactlyOnceWith(mocks.prepare.mock.calls[0][0]);
  });
  it('does not falsely label a late losing cancellation as cancelled', async () => {
    await prepare(); mocks.cancel.mockImplementationOnce(async (value) => ok(saved(value, 'applied')));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel prepared step' })); await screen.findByText(/Step recorded at revision 2/);
    expect(screen.queryByText(/Preparation cancelled/)).toBeNull();
  });
  it('reloads context after ACK and permits a barrier after collection without a remount', async () => {
    await prepare(); fireEvent.click(screen.getByRole('button', { name: 'Confirm documented step' })); await screen.findByText(/Step recorded at revision 2/);
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge step receipt' })); await screen.findByRole('button', { name: 'Reload current workflow' });
    const gate = deferred(); mocks.detail.mockReturnValueOnce(gate.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Reload current workflow' })); expect(screen.queryByRole('form')).toBeNull();
    await act(async () => gate.resolve(ok({ ...detail, stage: 'collected', revision: '2', ownership_revision: '8' })));
    await screen.findByRole('form'); expect(screen.getByLabelText('Step to document')).toHaveValue('record_exception');
    fill('record_exception'); change('Barrier type', 'report_missing'); change('Barrier reason', 'Still waiting on laboratory'); submit();
    await screen.findByText(/Prepared and recoverable/); expect(mocks.prepare.mock.calls[1][0]).toMatchObject({ expected_revision: '2', expected_ownership_revision: '8', command: 'record_exception' });
  });
  it('never uses receipt ACK as authorization for a new command after ownership changed', async () => {
    await prepare(); fireEvent.click(screen.getByRole('button', { name: 'Cancel prepared step' })); await screen.findByText(/Preparation cancelled/);
    mocks.detail.mockResolvedValueOnce(ok({ ...detail, assigned_to: id(99), accepted_by: id(99) }));
    fireEvent.click(screen.getByRole('button', { name: 'Reload current workflow' })); await screen.findByText(/Recording is unavailable/);
    expect(screen.queryByRole('form')).toBeNull();
  });
  it.each([{ assigned_to: id(99) }, { accepted_by: null, accepted_at: null }, { transfer_pending_to: id(99) }, { work_status: 'closed' as const }])('does not offer fresh writes for ineligible ownership/status %#', async (change) => {
    const current = { ...detail, ...change }; mocks.detail.mockResolvedValue(ok(current)); render(<CareWorkflowPanel {...props} initial={current} />); refresh();
    await screen.findByText(/Recording is unavailable/); expect(screen.queryByRole('form')).toBeNull();
  });
  it('recovers its own prior step when workflow detail is unavailable after transfer', async () => {
    mocks.detail.mockResolvedValue({ data: null, error: 'not visible' }); mocks.list.mockResolvedValue(ok({ items: [saved()], next_cursor: null }));
    render(<CareWorkflowPanel {...props} initial={null} />); refresh();
    fireEvent.click(await screen.findByRole('button', { name: `Review step ${input.request_id}` })); await screen.findByText(/Prepared and recoverable/);
    expect(mocks.recover).toHaveBeenCalledExactlyOnceWith(input); expect(screen.queryByRole('form')).toBeNull();
    expect(screen.queryByText(/No barrier was recorded/)).toBeNull(); expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it('does not hide an own pending request on the tail behind other-work requests', async () => {
    const items = Array.from({ length: 25 }, (_, n) => saved({ ...input, request_id: id(n + 20), work_item_id: id(99) }));
    mocks.list.mockResolvedValueOnce(ok({ items, next_cursor: id(44) })).mockResolvedValueOnce(ok({ items: [saved({ ...input, request_id: id(45) })], next_cursor: null }));
    render(<CareWorkflowPanel {...props} />); refresh(); const more = await screen.findByRole('button', { name: 'Load more pending steps' });
    expect(screen.queryByRole('form')).toBeNull(); expect(screen.getAllByRole('link', { name: 'Open other follow-up' })[0]).toHaveAttribute('href', `/patients/${id(2)}/care/${id(99)}?organization=${id(3)}`);
    fireEvent.click(more); await screen.findByRole('button', { name: `Review step ${id(45)}` }); expect(screen.queryByRole('form')).toBeNull();
    expect(mocks.list).toHaveBeenLastCalledWith({ actor_id: id(1), patient_id: id(2), organization_id: id(3), after: id(44) });
  });
  it('does not consider an incomplete or failed tail an empty pending list', async () => {
    mocks.list.mockResolvedValueOnce(ok({ items: [], next_cursor: id(44) })).mockResolvedValueOnce({ data: null, error: 'unavailable' });
    render(<CareWorkflowPanel {...props} />); refresh(); fireEvent.click(await screen.findByRole('button', { name: 'Load more pending steps' }));
    await screen.findByRole('alert'); expect(screen.queryByRole('form')).toBeNull();
  });
  it('does not expose a new form after a failed read', async () => {
    mocks.list.mockRejectedValue(new Error('offline')); render(<CareWorkflowPanel {...props} />); refresh();
    await screen.findByRole('alert'); expect(screen.queryByRole('form')).toBeNull();
  });
  it('validates meaningful evidence before generating a durable ID or preparing', async () => {
    await start(); fill(); change('Evidence or source reference', '   '); const uuid = vi.spyOn(crypto, 'randomUUID'); submit();
    await screen.findByRole('alert'); expect(uuid).not.toHaveBeenCalled(); expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it('renders separate barrier deadlines and retains underscore-containing evidence verbatim', async () => {
    const current: CareWorkflowDetail = { ...detail, next_review_at: '2026-10-03T12:00:00Z', due_at: due, exceptions: [
      { id: id(70), origin_event_id: id(6), code: 'report_missing', reason: 'Original_missing_report', next_action: 'Call_source_A', next_review_at: due, recorded_at: at },
      { id: id(71), origin_event_id: id(7), code: 'no_answer', reason: 'Second independent barrier', next_action: 'Retry contact B', next_review_at: '2026-10-02T12:00:00Z', recorded_at: at },
    ] };
    render(<CareWorkflowPanel {...props} initial={current} />);
    expect(screen.getByRole('heading', { name: 'Unresolved barriers (2)' })).toBeInTheDocument();
    expect(screen.getByText('Original_missing_report')).toBeInTheDocument(); expect(screen.getByText('Next action: Call_source_A')).toBeInTheDocument();
    expect(within(screen.getByLabelText('Last loaded workflow snapshot')).getByText(due)).toBeInTheDocument();
  });
});
describe('forms for each operational fact', () => {
  it.each([
    ['laboratory_order', 'requested', 'record_schedule', [['Appointment date (civil date)', '2026-11-01']], { appointment_date: '2026-11-01', appointment_at: null, appointment_timezone: null }],
    ['referral', 'requested', 'record_destination_acceptance', [['Destination', 'Synthetic clinic']], { destination: 'Synthetic clinic' }],
    ['referral', 'scheduled', 'record_attendance', [], {}],
    ['referral', 'attended', 'record_report', [['Report reference', 'Report_12']], { report_reference: 'Report_12' }],
    ['medication_access', 'requested', 'record_assistance_request', [['Assistance program', 'Synthetic program'], ['Request reference', 'Request_1']], { assistance_program: 'Synthetic program', request_reference: 'Request_1' }],
    ['medication_access', 'assistance_requested', 'record_assistance_response', [['Response outcome', 'denied'], ['Response reference', 'Response_1']], { outcome: 'denied', response_reference: 'Response_1' }],
    ['medication_access', 'response_received', 'record_obtained', [['Acquisition evidence source', 'patient_report']], { source: 'patient_report' }],
  ] as const)('captures %s/%s/%s without fabricating later steps', async (kind, stage, command, fields, details) => {
    await start({ ...detail, kind, stage }); fill(command); fields.forEach(([label, value]) => change(label, value)); submit();
    await screen.findByText(/Prepared and recoverable/); expect(mocks.prepare.mock.calls[0][0]).toMatchObject({ command, payload: { details } });
    expect(mocks.apply).not.toHaveBeenCalled();
  });
  it('rejects an offset that does not match the appointment zone before freezing', async () => {
    await start(); fill('record_schedule'); change('Appointment date (civil date)', '2026-11-01');
    change('Appointment instant (explicit offset)', '2026-11-01T01:30:00-06:00'); change('Appointment time zone (IANA)', 'America/New_York'); submit();
    await screen.findByRole('alert'); expect(mocks.prepare).not.toHaveBeenCalled();
  });
});
describe('live session and scope fencing', () => {
  it.each(['prepare', 'apply', 'ack', 'list', 'detail'] as const)('ignores late %s success after account change', async (operation) => {
    const gate = deferred();
    if (operation === 'list' || operation === 'detail') {
      mocks[operation].mockReturnValueOnce(gate.promise); render(<CareWorkflowPanel {...props} />); refresh();
      if (operation === 'list') await act(async () => {});
    } else {
      if (operation === 'prepare') { await start(); fill(); mocks.prepare.mockReturnValueOnce(gate.promise); submit(); }
      else { await prepare(); if (operation === 'ack') { fireEvent.click(screen.getByRole('button', { name: 'Confirm documented step' })); await screen.findByText(/Step recorded at revision 2/); }
        mocks[operation].mockReturnValueOnce(gate.promise); fireEvent.click(screen.getByRole('button', { name: operation === 'apply' ? 'Confirm documented step' : 'Acknowledge step receipt' })); }
    }
    act(() => mocks.subscribe.mock.calls[0][0]('SIGNED_IN', { user: { id: id(99) } }));
    await act(async () => gate.resolve(ok(operation === 'detail' ? detail : operation === 'list' ? { items: [], next_cursor: null } : saved(input, 'applied'))));
    expect(screen.getByRole('alert')).toHaveTextContent('Your session changed'); expect(screen.queryByRole('form')).toBeNull(); expect(screen.queryByText(/Step recorded at revision/)).toBeNull();
  });
  it('ignores late errors/finalizers after scope replacement and unsubscribes', async () => {
    const gate = deferred(); mocks.detail.mockReturnValueOnce(gate.promise);
    const view = render(<CareWorkflowPanel {...props} />); refresh(); view.rerender(<CareWorkflowPanel {...props} scopeKey="snapshot2" />);
    await act(async () => gate.reject(new Error('old scope failure'))); expect(screen.queryByRole('alert')).toBeNull();
    expect(mocks.unsubscribe).toHaveBeenCalledOnce(); expect(screen.getByRole('button', { name: 'Refresh workflow and check pending steps' })).not.toBeDisabled();
  });
  it.each(['patientId', 'workId', 'organizationId', 'actorId'] as const)('discards an old request when %s changes', async (key) => {
    const gate = deferred(); mocks.detail.mockReturnValueOnce(gate.promise);
    const view = render(<CareWorkflowPanel {...props} />); refresh(); view.rerender(<CareWorkflowPanel {...props} {...{ [key]: id(99) }} initial={null} />);
    await act(async () => gate.resolve(ok(detail))); expect(screen.queryByRole('form')).toBeNull(); expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  });
});
describe('server route authorization and recovery scope', () => {
  const routeProps = (organization?: string) => ({ params: Promise.resolve({ patientId: id(2), workId: id(5) }), searchParams: Promise.resolve({ organization }) });
  it('does not read data when provider authorization fails', async () => {
    mocks.authorize.mockResolvedValue({ authorized: false }); render(await CareWorkflowPage(routeProps()));
    expect(screen.getByRole('alert')).toHaveTextContent('authorized provider session'); expect(mocks.detail).not.toHaveBeenCalled();
  });
  it('rejects invalid route IDs and explicit mismatched organization', async () => {
    render(await CareWorkflowPage({ ...routeProps(), params: Promise.resolve({ patientId: 'bad', workId: id(5) }) }));
    expect(mocks.detail).not.toHaveBeenCalled(); cleanup(); render(await CareWorkflowPage(routeProps(id(99))));
    expect(screen.getByRole('alert')).toHaveTextContent('does not match'); expect(screen.queryByRole('heading')).toBeNull();
  });
  it('offers receipt recovery with explicit organization without granting workflow detail', async () => {
    mocks.detail.mockResolvedValue({ data: null, error: 'unavailable' }); render(await CareWorkflowPage(routeProps(id(3))));
    expect(screen.getByRole('heading', { name: 'Recover your step receipts' })).toBeInTheDocument(); expect(mocks.list).not.toHaveBeenCalled();
  });
  it('offers explicit self-organization choices if no authorized detail or URL scope exists', async () => {
    mocks.detail.mockResolvedValue({ data: null, error: 'unavailable' }); render(await CareWorkflowPage(routeProps()));
    expect(screen.getByRole('link', { name: 'Clinic A' })).toHaveAttribute('href', `/patients/${id(2)}/care/${id(5)}?organization=${id(3)}`);
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
