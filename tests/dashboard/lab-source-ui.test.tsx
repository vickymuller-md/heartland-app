import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import type { LabSourceContext } from '@/lib/labs/source-context';
import { observationInputFromState, observationStateSchema, type ObservationInput } from '@/lib/labs/observation-types';
const mocks = vi.hoisted(() => ({ context: vi.fn(), pending: vi.fn(), prepare: vi.fn(), recover: vi.fn(), apply: vi.fn(), cancel: vi.fn(), ack: vi.fn(),
  listeners: new Set<(event: string, session: { user: { id: string } } | null) => void>() }));
vi.mock('@/lib/labs/observation-actions', () => ({ loadSourceContext: mocks.context, loadPendingObservations: mocks.pending,
  prepareObservation: mocks.prepare, recoverObservation: mocks.recover, applyObservation: mocks.apply, cancelObservation: mocks.cancel, acknowledgeObservation: mocks.ack }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { onAuthStateChange: (cb: (event: string, session: { user: { id: string } } | null) => void) => {
  mocks.listeners.add(cb); return { data: { subscription: { unsubscribe: () => mocks.listeners.delete(cb) } } };
} } }) }));
import { LabSourcePanel } from '@/app/(provider)/patients/[patientId]/_components/lab-source-panel';
const id = (n: number) => `66000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = '2026-09-01T09:30:00.123456-04:00';
const props = { actorId: id(1), patientId: id(11), organizationId: id(90), scopeKey: 'initial' };
const scope = { actor_id: props.actorId, patient_id: props.patientId, organization_id: props.organizationId };
function context(registered = false): LabSourceContext {
  return { ...scope, can_mutate: true, items: [{ source_authority_organization_id: registered ? id(90) : null, observation: {
    id: `${id(100)}:potassium`, original_lab_result_id: id(100), patient_id: id(11), analyte: 'potassium', root_id: registered ? id(2100) : null,
    version_id: registered ? id(3100) : null, revision: registered ? '1' : null, status: 'original', value: '4.6', collected_at: at,
    effective_lab_result_id: id(100), evaluation_status: 'recorded', notes: null, lab_facility: null } }] };
}
function prepared(input?: ObservationInput) {
  return observationStateSchema.parse({ ...(input ?? { ...scope, request_id: id(1100), root_id: id(2100), original_lab_result_id: id(100), analyte: 'potassium',
    command: 'register_source', expected_revision: '0', payload: { evidence: '  Source document  ', occurred_at: at } }),
    state: 'prepared', source_snapshot: input?.command && input.command !== 'register_source'
      ? { value: '4.6', collected_at: at, version_id: id(3100), revision: '1', status: 'original', effective_lab_result_id: id(100) }
      : { value: '4.6', collected_at: at }, recorded_at: at, acknowledged_at: null, receipt: null });
}
function applied(input?: ObservationInput) {
  const state = prepared(input); const common = { request_id: state.request_id, root_id: state.root_id, original_lab_result_id: id(100), analyte: 'potassium',
    version_id: id(3101), recorded_at: at, order_authorship_confirmed: false, clinical_review_recorded: false, care_completed: false };
  return observationStateSchema.parse({ ...state, state: 'applied', receipt: state.command === 'register_source'
    ? { ...common, revision: '1', source_authority_registered: true }
    : { ...common, revision: '2', previous_version_id: id(3100), status: 'corrected', effective_lab_result_id: id(4000), stored_source: { value: '4.2', collected_at: at },
      evaluation_status: 'pending', source_change_recorded: true, work_invalidation_recorded: false } });
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { resolve, promise }; }
const result = <T,>(data: T) => ({ data, error: null });
async function load() { fireEvent.click(screen.getByRole('button', { name: 'Load sources and recover pending requests' })); await waitFor(() => expect(mocks.pending).toHaveBeenCalled()); }
async function select() { await load(); fireEvent.change(await screen.findByLabelText('Source to inspect'), { target: { value: `${id(100)}:potassium` } }); }
function fill(correction = false) {
  if (correction) {
    fireEvent.change(screen.getByLabelText('Corrected value (exact decimal)'), { target: { value: '04.2000' } });
    fireEvent.change(screen.getByLabelText('Collection time (explicit offset)'), { target: { value: at } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: '  Corrected report  ' } });
  }
  fireEvent.change(screen.getByLabelText('Evidence or source reference'), { target: { value: '  Source document  ' } });
  fireEvent.change(screen.getByLabelText('Source event time (explicit offset)'), { target: { value: at } });
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.listeners.clear(); mocks.context.mockResolvedValue(result(context())); mocks.pending.mockResolvedValue(result({ items: [], next_cursor: null }));
  mocks.prepare.mockImplementation(async (input) => result(prepared(input))); mocks.recover.mockResolvedValue(result(prepared()));
  mocks.apply.mockImplementation(async (input) => result(applied(input))); mocks.cancel.mockImplementation(async (input) => result({ ...prepared(input), state: 'cancelled' }));
  mocks.ack.mockImplementation(async (input) => result({ ...applied(input), acknowledged_at: at }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('recoverable source command panel', () => {
  it('does not load or prepare automatically, including StrictMode remount effects', () => {
    render(<StrictMode><LabSourcePanel {...props} /></StrictMode>);
    expect(mocks.context).not.toHaveBeenCalled(); expect(mocks.prepare).not.toHaveBeenCalled(); expect(screen.queryByRole('form')).not.toBeInTheDocument();
  });
  it('shows the actual frozen registration source before explicit application, even if changed since the loaded context', async () => {
    mocks.prepare.mockImplementation(async (input) => result({ ...prepared(input), source_snapshot: { value: '4.9', collected_at: '2026-08-31T00:00:00.999999Z' } }));
    render(<LabSourcePanel {...props} />); await select(); fill(); fireEvent.submit(screen.getByRole('form'));
    const snapshot = await screen.findByLabelText('Frozen source snapshot'); expect(snapshot).toHaveTextContent('4.9'); expect(snapshot).toHaveTextContent('2026-08-31T00:00:00.999999Z');
    expect(mocks.apply).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Apply reviewed source command' })).toBeEnabled();
  });
  it.each(['returned-error', 'transport-throw'])('recovers prepared state and its frozen source despite context %s', async (kind) => {
    if (kind === 'transport-throw') mocks.context.mockRejectedValue(new Error('Lost transport')); else mocks.context.mockResolvedValue({ data: null, error: 'Unavailable' });
    mocks.pending.mockResolvedValue(result({ items: [prepared()], next_cursor: null }));
    render(<LabSourcePanel {...props} />); await load();
    expect(await screen.findByText(/Recovery-only mode/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: `Recover ${id(1100)}` }));
    expect(await screen.findByLabelText('Frozen source snapshot')).toHaveTextContent(at); expect(mocks.recover).toHaveBeenCalledWith(observationInputFromState(prepared()));
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it('discards all pending rows after a late-page failure and prevents a new command', async () => {
    const first = Array.from({ length: 25 }, (_, n) => ({ ...prepared(), request_id: id(1100 + n) }));
    mocks.pending.mockResolvedValueOnce(result({ items: first, next_cursor: id(1124) })).mockResolvedValueOnce({ data: null, error: 'Lost page' });
    render(<LabSourcePanel {...props} />); await load();
    await waitFor(() => expect(mocks.pending).toHaveBeenCalledTimes(2)); expect(await screen.findByRole('alert')).toHaveTextContent('complete pending');
    expect(screen.queryByLabelText('Pending source requests')).not.toBeInTheDocument(); expect(screen.queryByRole('form')).not.toBeInTheDocument();
  });
  it('loads all25+tail requests before displaying recovery controls, with no preparation while any remains', async () => {
    const rows = Array.from({ length: 26 }, (_, n) => ({ ...prepared(), request_id: id(1100 + n) }));
    mocks.pending.mockResolvedValueOnce(result({ items: rows.slice(0, 25), next_cursor: id(1124) })).mockResolvedValueOnce(result({ items: rows.slice(25), next_cursor: null }));
    render(<LabSourcePanel {...props} />); await load();
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^Recover / })).toHaveLength(26));
    fireEvent.change(screen.getByLabelText('Source to inspect'), { target: { value: `${id(100)}:potassium` } }); expect(screen.queryByRole('form')).not.toBeInTheDocument();
  });
  it.each(['monitor-only', 'other-organization'])('does not present a new mutation form for %s context', async (kind) => {
    const data = context(true); if (kind === 'monitor-only') data.can_mutate = false; else data.items[0].source_authority_organization_id = id(91);
    mocks.context.mockResolvedValue(result(data)); render(<LabSourcePanel {...props} />); await select();
    expect(screen.queryByRole('form')).not.toBeInTheDocument(); expect(screen.getByText(/Viewing it does not transfer/)).toBeInTheDocument();
  });
  it('refuses a future original collection before freezing or allocating request IDs', async () => {
    const data = context(); data.items[0].observation.collected_at = '9999-01-01T00:00:00Z'; mocks.context.mockResolvedValue(result(data));
    const uuid = vi.spyOn(crypto, 'randomUUID'); render(<LabSourcePanel {...props} />); await select(); fill(); fireEvent.submit(screen.getByRole('form'));
    expect(screen.getByRole('alert')).toHaveTextContent('original source'); expect(mocks.prepare).not.toHaveBeenCalled(); expect(uuid).not.toHaveBeenCalled(); expect(screen.getByRole('form')).toBeInTheDocument();
  });
  it('validates precision before UUIDs, then preserves correction decimal text and timestamp microseconds', async () => {
    mocks.context.mockResolvedValue(result(context(true))); const uuid = vi.spyOn(crypto, 'randomUUID');
    render(<LabSourcePanel {...props} />); await select(); fill(true);
    fireEvent.change(screen.getByLabelText('Corrected value (exact decimal)'), { target: { value: '4.21' } }); fireEvent.submit(screen.getByRole('form'));
    expect(uuid).not.toHaveBeenCalled(); expect(mocks.prepare).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Corrected value (exact decimal)'), { target: { value: '04.2000' } }); fireEvent.submit(screen.getByRole('form'));
    await screen.findByLabelText('Frozen source snapshot'); expect(mocks.prepare).toHaveBeenCalledWith(expect.objectContaining({ root_id: id(2100), expected_revision: '1',
      payload: { evidence: '  Source document  ', occurred_at: at, reason: '  Corrected report  ', value: '04.2000', collected_at: at } }));
    expect(uuid).toHaveBeenCalledTimes(1);
  });
  it('retries lost preparation with exactly the frozen ID/payload and never auto-applies', async () => {
    mocks.prepare.mockRejectedValueOnce(new Error('Lost reply')); render(<LabSourcePanel {...props} />); await select(); fill(); fireEvent.submit(screen.getByRole('form'));
    await screen.findByRole('button', { name: 'Retry preparation with same ID' }); const frozen = mocks.prepare.mock.calls[0][0];
    fireEvent.click(screen.getByRole('button', { name: 'Retry preparation with same ID' })); await screen.findByRole('button', { name: 'Apply reviewed source command' });
    expect(mocks.prepare).toHaveBeenNthCalledWith(2, frozen); expect(mocks.apply).not.toHaveBeenCalled(); expect(screen.queryByRole('form')).not.toBeInTheDocument();
  });
  it('recovers a lost apply, separates frozen evaluation status from live status, then recovers a lost acknowledgment', async () => {
    mocks.context.mockResolvedValue(result(context(true))); mocks.apply.mockRejectedValueOnce(new Error('Lost apply'));
    render(<LabSourcePanel {...props} />); await select(); fill(true); fireEvent.submit(screen.getByRole('form'));
    fireEvent.click(await screen.findByRole('button', { name: 'Apply reviewed source command' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Check saved source request' })).toBeEnabled());
    const frozen = mocks.prepare.mock.calls[0][0]; mocks.recover.mockResolvedValueOnce(result(applied(frozen)));
    fireEvent.click(screen.getByRole('button', { name: 'Check saved source request' }));
    expect(await screen.findByText(/Evaluation status in the frozen creation receipt: pending/)).toBeInTheDocument();
    mocks.ack.mockRejectedValueOnce(new Error('Lost acknowledgment')); fireEvent.click(screen.getByRole('button', { name: 'Acknowledge source receipt' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Check saved source request' })).toBeEnabled());
    mocks.recover.mockResolvedValueOnce(result({ ...applied(frozen), acknowledged_at: at })); fireEvent.click(screen.getByRole('button', { name: 'Check saved source request' }));
    await screen.findByText(/Receipt acknowledged/); expect(mocks.apply).toHaveBeenCalledTimes(1); expect(mocks.ack).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Reload source context' })); await waitFor(() => expect(mocks.context).toHaveBeenCalledTimes(2));
    fireEvent.change(screen.getByLabelText('Source to inspect'), { target: { value: `${id(100)}:potassium` } }); expect(screen.getByText(/Current alert processing: recorded/)).toBeInTheDocument();
  });
  it('does not claim cancellation undid an already applied source', async () => {
    mocks.cancel.mockImplementation(async (input) => result(applied(input))); render(<LabSourcePanel {...props} />); await select(); fill(); fireEvent.submit(screen.getByRole('form'));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel preparation' }));
    await screen.findByText(/Source command applied/); expect(screen.queryByText(/Preparation cancelled/)).not.toBeInTheDocument();
  });
  it('does not offer repeat cancellation or automatic restoration for a cancelled source', async () => {
    const data = context(true); Object.assign(data.items[0].observation, { revision: '3', status: 'cancelled', value: null, effective_lab_result_id: null, evaluation_status: null });
    mocks.context.mockResolvedValue(result(data)); render(<LabSourcePanel {...props} />); await select();
    const command = screen.getByLabelText('Command'); expect(within(command).getAllByRole('option')).toHaveLength(1);
    expect(screen.getByText(/Restoration requires an explicit new corrected value/)).toBeInTheDocument(); expect(screen.getByLabelText('Corrected value (exact decimal)')).toHaveValue('');
  });
  it.each(['account', 'patient', 'organization'])('fences a late source reply after a %s change', async (kind) => {
    const pending = deferred<ReturnType<typeof result<LabSourceContext>>>(); mocks.context.mockReturnValueOnce(pending.promise);
    const view = render(<LabSourcePanel {...props} />); fireEvent.click(screen.getByRole('button', { name: 'Load sources and recover pending requests' }));
    if (kind === 'account') act(() => mocks.listeners.forEach((cb) => cb('SIGNED_IN', { user: { id: id(2) } })));
    else view.rerender(<LabSourcePanel {...props} {...(kind === 'patient' ? { patientId: id(12) } : { organizationId: id(91) })} />);
    await act(async () => pending.resolve(result(context()))); expect(mocks.pending).not.toHaveBeenCalled(); expect(screen.queryByLabelText('Current source context')).not.toBeInTheDocument();
    if (kind === 'account') expect(screen.getByRole('alert')).toHaveTextContent('session changed');
  });
  it('clears a late prepared reply on logout and never offers apply in the changed session', async () => {
    const pending = deferred<ReturnType<typeof result<ReturnType<typeof prepared>>>>(); mocks.prepare.mockReturnValueOnce(pending.promise);
    render(<LabSourcePanel {...props} />); await select(); fill(); fireEvent.submit(screen.getByRole('form'));
    act(() => mocks.listeners.forEach((cb) => cb('SIGNED_OUT', null))); await act(async () => pending.resolve(result(prepared())));
    expect(screen.getByRole('alert')).toHaveTextContent('session changed'); expect(screen.queryByLabelText('Frozen source request')).not.toBeInTheDocument();
  });
});
