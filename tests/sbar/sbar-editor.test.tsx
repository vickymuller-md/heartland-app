import { act, cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { StrictMode } from 'react';
import { SbarEditor } from '@/app/(provider)/patients/[patientId]/sbar/_components/sbar-editor';

const mocks = vi.hoisted(() => ({
  actor: '65000000-0000-4000-8000-000000000001',
  listeners: new Set<(event: string, session: { user: { id: string } } | null) => void>(),
  printGate: null as Promise<void> | null, cloneGate: null as Promise<void> | null,
  authGate: null as Promise<void> | null, authActors: [] as string[],
  loadGate: null as Promise<void> | null, afterAppend: null as (() => void) | null,
  started: vi.fn(), printed: vi.fn(), beforeClone: vi.fn(),
}));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: {
  getUser: vi.fn(async () => {
    const actor = mocks.authActors.shift() ?? mocks.actor;
    if (mocks.authGate) await mocks.authGate;
    return { data: { user: { id: actor } }, error: null };
  }),
  onAuthStateChange: (listener: (event: string, session: { user: { id: string } } | null) => void) => {
    mocks.listeners.add(listener);
    return { data: { subscription: { unsubscribe: () => mocks.listeners.delete(listener) } } };
  },
} }) }));
vi.mock('react-to-print', () => ({ useReactToPrint: (options: {
  onBeforePrint: () => Promise<void>; print: (frame: HTMLIFrameElement) => Promise<void>;
  onPrintError: (location: string, error: Error) => void;
}) => (getContent: () => HTMLElement | null) => {
  void (async () => {
    let frame: HTMLIFrameElement | null = null;
    try {
      await options.onBeforePrint(); mocks.beforeClone();
      if (mocks.cloneGate) await mocks.cloneGate;
      const root = getContent(); if (!root) return;
      const clone = root.cloneNode(true);
      frame = document.createElement('iframe'); frame.id = 'printWindow'; document.body.append(frame);
      mocks.afterAppend?.();
      if (mocks.loadGate) await mocks.loadGate;
      frame.contentDocument!.body.append(clone);
      Object.defineProperty(frame.contentWindow, 'print', { value: mocks.printed });
      Object.defineProperty(frame.contentWindow, 'focus', { value: vi.fn() });
      frame.dispatchEvent(new Event('load')); mocks.started();
      if (mocks.printGate) await mocks.printGate;
      await options.print(frame);
    } catch (error) { options.onPrintError('print', error as Error); }
    finally { frame?.remove(); }
  })();
} }));
const defaultProps = {
  initialData: {
    situation: 'Synthetic patient at moderate risk.', background: 'Synthetic source values.',
    assessment: 'HEARTLAND Risk Tier: Moderate.', recommendation: '[ Provider to complete ]',
  },
  patientName: 'Synthetic Person', patientId: '65000000-0000-4000-8000-000000000011',
  providerId: '65000000-0000-4000-8000-000000000001', sourceReadAt: '2026-09-29T12:00:00.000Z',
};
function deferred() {
  let resolve!: () => void;
  return { promise: new Promise<void>((r) => { resolve = r; }), resolve: () => resolve() };
}
function switchActor(actor: string | null) {
  mocks.actor = actor ?? '';
  mocks.listeners.forEach((listener) => listener(actor ? 'SIGNED_IN' : 'SIGNED_OUT', actor ? { user: { id: actor } } : null));
}
async function ready() { await screen.findByLabelText(/Situation/); }
function startPrint() { fireEvent.click(screen.getByRole('button', { name: /export pdf/i })); }
function edit() { fireEvent.change(screen.getByLabelText(/Situation/), { target: { value: 'Edited draft' } }); }
beforeEach(() => {
  vi.clearAllMocks(); mocks.actor = defaultProps.providerId;
  mocks.printGate = null; mocks.cloneGate = null; mocks.loadGate = null; mocks.authGate = null;
  mocks.authActors = []; mocks.afterAppend = null;
});
afterEach(cleanup);

describe('SbarEditor draft and lifetime', () => {
  it('verifies the account before rendering editable or hidden patient data', async () => {
    const gate = deferred(); mocks.authGate = gate.promise;
    const { container } = render(<SbarEditor {...defaultProps} />);
    expect(screen.getByRole('status')).toHaveTextContent('Verifying SBAR');
    expect(container).not.toHaveTextContent(defaultProps.patientName);
    await act(async () => gate.resolve()); await ready();
  });
  it('renders four prefilled, editable sections with fixed non-editable notices', async () => {
    render(<SbarEditor {...defaultProps} />); await ready();
    for (const [section, value] of Object.entries(defaultProps.initialData)) {
      expect(screen.getByLabelText(new RegExp(section, 'i'))).toHaveValue(value);
    }
    edit(); expect(screen.getByLabelText(/Situation/)).toHaveValue('Edited draft');
    expect(screen.getAllByText(/Not sent; clinical review/)).toHaveLength(2);
    expect(screen.getAllByText(/Source read started: 2026-09-29T12:00:00.000Z/)).toHaveLength(2);
    expect(screen.getByRole('link', { name: /back/i })).toHaveAttribute('href', '/patients/' + defaultProps.patientId);
  });
  it('exports the current draft through the final identity fence', async () => {
    render(<SbarEditor {...defaultProps} />); await ready(); edit(); startPrint();
    await waitFor(() => expect(mocks.printed).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: /export pdf/i })).toBeEnabled();
  });
  it('remains blocked after account A→B→A and removes printable content', async () => {
    render(<SbarEditor {...defaultProps} />); await ready();
    act(() => { switchActor('65000000-0000-4000-8000-000000000099'); switchActor(defaultProps.providerId); });
    expect(screen.getByRole('alert')).toHaveTextContent('Reload');
    expect(screen.queryByTestId('sbar-print-layout')).not.toBeInTheDocument();
    expect(screen.queryByText(defaultProps.patientName)).not.toBeInTheDocument();
  });
  it('does not let obsolete StrictMode authentication block the current lifetime', async () => {
    const gate = deferred(); mocks.authGate = gate.promise;
    mocks.authActors = ['old-account', defaultProps.providerId];
    render(<StrictMode><SbarEditor {...defaultProps} /></StrictMode>);
    await act(async () => gate.resolve()); await ready();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it.each(['patient', 'source'] as const)('new %s context resets edits and cancels old printing', async (kind) => {
    const gate = deferred(); mocks.printGate = gate.promise;
    const view = render(<SbarEditor {...defaultProps} />); await ready(); edit(); startPrint();
    await waitFor(() => expect(mocks.started).toHaveBeenCalled());
    view.rerender(<SbarEditor {...defaultProps} {...(kind === 'patient'
      ? { patientId: '65000000-0000-4000-8000-000000000012' } : { sourceReadAt: '2026-09-29T13:00:00.000Z' })} />);
    await ready(); expect(screen.getByLabelText(/Situation/)).toHaveValue(defaultProps.initialData.situation);
    expect(document.getElementById('printWindow')).toBeNull();
    await act(async () => gate.resolve()); expect(mocks.printed).not.toHaveBeenCalled();
  });
  it('unmount removes its pending print clone', async () => {
    const gate = deferred(); mocks.printGate = gate.promise;
    const view = render(<SbarEditor {...defaultProps} />); await ready(); startPrint();
    await waitFor(() => expect(mocks.started).toHaveBeenCalled()); view.unmount();
    expect(document.getElementById('printWindow')).toBeNull();
    await act(async () => gate.resolve()); expect(mocks.printed).not.toHaveBeenCalled();
  });
});

describe('SBAR edit/account print races', () => {
  it('editing while resources load cancels only that clone, then allows a new print', async () => {
    const gate = deferred(); mocks.printGate = gate.promise;
    render(<SbarEditor {...defaultProps} />); await ready(); startPrint();
    await waitFor(() => expect(mocks.started).toHaveBeenCalledTimes(1)); edit();
    expect(document.getElementById('printWindow')).toBeNull();
    expect(screen.getByRole('button', { name: /export pdf/i })).toBeEnabled();
    const next = deferred(); mocks.printGate = next.promise; startPrint();
    await waitFor(() => expect(mocks.started).toHaveBeenCalledTimes(2));
    await act(async () => gate.resolve());
    expect(screen.getByRole('button', { name: /export pdf/i })).toBeDisabled();
    expect(document.getElementById('printWindow')).not.toBeNull();
    await act(async () => next.resolve()); expect(mocks.printed).toHaveBeenCalledTimes(1);
  });
  it('editing in the pre-clone promise gap prevents cloning', async () => {
    const gate = deferred(); mocks.cloneGate = gate.promise;
    render(<SbarEditor {...defaultProps} />); await ready(); startPrint();
    await waitFor(() => expect(mocks.beforeClone).toHaveBeenCalled()); edit();
    await act(async () => gate.resolve());
    expect(mocks.started).not.toHaveBeenCalled(); expect(mocks.printed).not.toHaveBeenCalled();
  });
  it('handles edit immediately after empty iframe append, before observer delivery', async () => {
    const gate = deferred(); mocks.loadGate = gate.promise;
    render(<SbarEditor {...defaultProps} />); await ready();
    mocks.afterAppend = () => edit(); startPrint();
    await waitFor(() => expect(screen.getByLabelText(/Situation/)).toHaveValue('Edited draft'));
    await act(async () => gate.resolve());
    expect(document.getElementById('printWindow')).toBeNull(); expect(mocks.printed).not.toHaveBeenCalled();
  });
  it('checks identity again after print resources load even without an auth event', async () => {
    const gate = deferred(); mocks.printGate = gate.promise;
    render(<SbarEditor {...defaultProps} />); await ready(); startPrint();
    await waitFor(() => expect(mocks.started).toHaveBeenCalled()); mocks.actor = 'other-account';
    await act(async () => gate.resolve()); expect(mocks.printed).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Reload');
  });
  it('removes owned clone immediately on logout, not after resources finish', async () => {
    const gate = deferred(); mocks.printGate = gate.promise;
    render(<SbarEditor {...defaultProps} />); await ready(); startPrint();
    await waitFor(() => expect(mocks.started).toHaveBeenCalled()); act(() => switchActor(null));
    expect(document.getElementById('printWindow')).toBeNull();
    await act(async () => gate.resolve()); expect(mocks.printed).not.toHaveBeenCalled();
  });
});
