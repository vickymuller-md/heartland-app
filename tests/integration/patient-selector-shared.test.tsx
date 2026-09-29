import { StrictMode, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SelectedPatientData, PatientMatch } from '@/lib/integration/patient-selection';

const mocks = vi.hoisted(() => ({
  actor: '70000000-0000-4000-8000-000000000001', getUser: vi.fn(), directory: vi.fn(), selection: vi.fn(), selected: vi.fn(), cleared: vi.fn(),
  listeners: new Set<(event: string, session: { user: { id: string } } | null) => void>(),
}));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: {
  getUser: mocks.getUser,
  onAuthStateChange: (listener: (event: string, session: { user: { id: string } } | null) => void) => {
    mocks.listeners.add(listener); return { data: { subscription: { unsubscribe: () => mocks.listeners.delete(listener) } } };
  },
} }) }));
vi.mock('@/lib/integration/patient-selection', async (original) => ({
  ...await original<typeof import('@/lib/integration/patient-selection')>(),
  readPatientDirectory: mocks.directory, readPatientSelection: mocks.selection,
}));
import { PatientSelector } from '@/components/shared/patient-selector';
import { PatientSelectionSessionError } from '@/lib/integration/patient-selection';
const actor = '70000000-0000-4000-8000-000000000001';
const patient: PatientMatch = { id: '70000000-0000-4000-8000-000000000002', full_name: 'Synthetic One', email: null, phone: null, patient_code: 'SYN001', risk_tier: 'low' };
const second = { ...patient, id: '70000000-0000-4000-8000-000000000003', full_name: 'Synthetic Two' };
const selection = (person = patient): SelectedPatientData => ({
  patient: person, actorId: actor, latestVitals: null, laboratorySnapshots: null, sourceReadAt: '2026-09-29T12:00:00Z', medications: [],
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  return { promise: new Promise<T>((done) => { resolve = done; }), resolve: (value: T) => resolve(value) };
}
function authResult(value = mocks.actor) { return { data: { user: { id: value } }, error: null }; }
function switchActor(value: string | null) {
  mocks.actor = value ?? '';
  mocks.listeners.forEach((listener) => listener(value ? 'SIGNED_IN' : 'SIGNED_OUT', value ? { user: { id: value } } : null));
}
function Harness({ includeLaboratories = false, initial = null }: { includeLaboratories?: boolean; initial?: PatientMatch | null }) {
  const [selected, setSelected] = useState<PatientMatch | null>(initial);
  return <PatientSelector selectedPatient={selected} expectedActorId={actor} includeLaboratories={includeLaboratories}
    onSelect={(data) => { mocks.selected(data); setSelected(data.patient); }}
    onClear={() => { mocks.cleared(); setSelected(null); }} />;
}
async function search() {
  await waitFor(() => expect(screen.getByRole('textbox')).toBeEnabled());
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'synthetic' } });
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.actor = actor;
  mocks.getUser.mockReset().mockImplementation(async () => authResult());
  mocks.directory.mockReset().mockResolvedValue([patient, second]);
  mocks.selection.mockReset().mockImplementation(async (_client, person: PatientMatch) => selection(person));
});
afterEach(cleanup);
describe('shared patient selector fenced reads', () => {
  it('retains the public module re-export', async () => {
    expect((await import('@/app/(public)/titration-checklist/patient-selector')).PatientSelector).toBe(PatientSelector);
  });
  it('verifies the directory before displaying a supplied selected patient', async () => {
    const gate = deferred<PatientMatch[]>(); mocks.directory.mockReturnValue(gate.promise);
    render(<Harness initial={patient} />);
    expect(screen.queryByText(patient.full_name)).toBeNull(); expect(screen.getByRole('textbox')).toBeDisabled();
    await act(async () => gate.resolve([patient]));
    expect(screen.getByText(patient.full_name)).toBeInTheDocument();
  });
  it('passes expected actor and explicit laboratory request, clearing before import', async () => {
    render(<Harness includeLaboratories />); await search();
    fireEvent.click(screen.getByRole('button', { name: /Synthetic One/ }));
    await waitFor(() => expect(mocks.selected).toHaveBeenCalledWith(selection()));
    expect(mocks.cleared).toHaveBeenCalledOnce();
    expect(mocks.selection).toHaveBeenCalledWith(expect.anything(), patient, actor, true);
    fireEvent.click(screen.getByRole('button', { name: 'Clear selected patient' }));
    expect(screen.queryByText(patient.full_name)).toBeNull(); expect(mocks.cleared).toHaveBeenCalledTimes(2);
  });
  it('preserves non-laboratory consumers without requesting laboratory data', async () => {
    render(<Harness />); await search(); fireEvent.click(screen.getByRole('button', { name: /Synthetic One/ }));
    await waitFor(() => expect(mocks.selected).toHaveBeenCalled());
    expect(mocks.selection.mock.calls[0][3]).toBe(false);
  });
  it.each(['directory', 'selection'])('shows %s failure rather than an empty panel or selected patient', async (phase) => {
    if (phase === 'directory') mocks.directory.mockRejectedValue(new Error('Private source details'));
    else mocks.selection.mockRejectedValue(new Error('Private source details'));
    render(<Harness />);
    if (phase === 'selection') { await search(); fireEvent.click(screen.getByRole('button', { name: /Synthetic One/ })); }
    expect(await screen.findByRole('alert')).not.toHaveTextContent('Private');
    expect(mocks.selected).not.toHaveBeenCalled();
  });
  it('discards an older selection that completes after a newer selection', async () => {
    const gate = deferred<SelectedPatientData>(); mocks.selection.mockReturnValueOnce(gate.promise);
    render(<Harness />); await search(); fireEvent.click(screen.getByRole('button', { name: /Synthetic One/ }));
    fireEvent.click(screen.getByRole('button', { name: /Synthetic Two/ }));
    await waitFor(() => expect(mocks.selected).toHaveBeenCalledWith(selection(second)));
    await act(async () => gate.resolve(selection()));
    expect(mocks.selected).toHaveBeenCalledOnce(); expect(screen.getByText(second.full_name)).toBeInTheDocument();
  });
  it.each(['cancel', 'search', 'unmount'])('discards a pending selection after %s', async (kind) => {
    const gate = deferred<SelectedPatientData>(); mocks.selection.mockReturnValueOnce(gate.promise);
    const view = render(<Harness />); await search(); fireEvent.click(screen.getByRole('button', { name: /Synthetic One/ }));
    if (kind === 'cancel') fireEvent.click(screen.getByRole('button', { name: 'Cancel selection' }));
    if (kind === 'search') fireEvent.change(screen.getByRole('textbox'), { target: { value: 'changed' } });
    if (kind === 'unmount') view.unmount();
    await act(async () => gate.resolve(selection())); expect(mocks.selected).not.toHaveBeenCalled();
  });
  it.each(['directory', 'selection'])('blocks A→B→A during %s and removes identities', async (phase) => {
    const directoryGate = deferred<PatientMatch[]>(); const selectionGate = deferred<SelectedPatientData>();
    if (phase === 'directory') mocks.directory.mockReturnValueOnce(directoryGate.promise);
    else mocks.selection.mockReturnValueOnce(selectionGate.promise);
    render(<Harness />);
    if (phase === 'selection') { await search(); fireEvent.click(screen.getByRole('button', { name: /Synthetic One/ })); }
    else await waitFor(() => expect(mocks.directory).toHaveBeenCalled());
    act(() => { switchActor(second.id); switchActor(actor); });
    await act(async () => { directoryGate.resolve([patient]); selectionGate.resolve(selection()); });
    expect(screen.getByRole('alert')).toHaveTextContent('session changed');
    expect(screen.queryByText(patient.full_name)).toBeNull(); expect(mocks.selected).not.toHaveBeenCalled();
  });
  it('permanently blocks an observed auth-read mismatch even without an auth event', async () => {
    mocks.selection.mockRejectedValue(new PatientSelectionSessionError('Session changed'));
    render(<Harness />); await search(); fireEvent.click(screen.getByRole('button', { name: /Synthetic One/ }));
    await screen.findByRole('alert'); expect(screen.queryByRole('textbox')).toBeNull();
  });
  it('ignores a stale StrictMode auth result without clearing the newer lifetime', async () => {
    const gate = deferred<ReturnType<typeof authResult>>(); mocks.getUser.mockReturnValueOnce(gate.promise);
    render(<StrictMode><Harness /></StrictMode>); await search();
    await act(async () => gate.resolve(authResult(second.id)));
    expect(screen.queryByRole('alert')).toBeNull(); expect(mocks.cleared).not.toHaveBeenCalled();
  });
});
