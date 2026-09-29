import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const mocks = vi.hoisted(() => ({
  actor: '68000000-0000-4000-8000-000000000001', authError: false,
  getUser: vi.fn(), fetch: vi.fn(), createUrl: vi.fn(), revokeUrl: vi.fn(), clicked: vi.fn(),
  listeners: new Set<(event: string, session: { user: { id: string } } | null) => void>(),
}));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: {
  getUser: mocks.getUser,
  onAuthStateChange: (listener: (event: string, session: { user: { id: string } } | null) => void) => {
    mocks.listeners.add(listener); return { data: { subscription: { unsubscribe: () => mocks.listeners.delete(listener) } } };
  },
} }) }));
vi.mock('react-to-print', () => ({ useReactToPrint: () => vi.fn() }));
import { FhirDownloadButton } from '@/app/(provider)/patients/[patientId]/_components/fhir-download-button';

const props = { providerId: '68000000-0000-4000-8000-000000000001',
  patientId: '68000000-0000-4000-8000-000000000002', contextId: 'server-lifetime-1' };
const other = '68000000-0000-4000-8000-000000000099';
let blob: Blob;
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  return { promise: new Promise<T>((done) => { resolve = done; }), resolve: (value: T) => resolve(value) };
}
function authResult(actor = mocks.actor) { return { data: { user: actor ? { id: actor } : null }, error: mocks.authError }; }
function response(patch: Record<string, unknown> = {}) {
  return { ok: true, status: 200, headers: new Headers({
    'Content-Type': 'application/fhir+json; charset=utf-8',
    'X-Heartland-Export-Actor': props.providerId, 'X-Heartland-Export-Patient': props.patientId,
  }), blob: vi.fn(async () => blob), ...patch };
}
function switchActor(actor: string | null) {
  mocks.actor = actor ?? '';
  mocks.listeners.forEach((listener) => listener(actor ? 'SIGNED_IN' : 'SIGNED_OUT', actor ? { user: { id: actor } } : null));
}
async function ready() { await waitFor(() => expect(screen.getByRole('button', { name: 'Export FHIR R4' })).toBeEnabled()); }
function start() { fireEvent.click(screen.getByRole('button', { name: 'Export FHIR R4' })); }
beforeEach(() => {
  vi.clearAllMocks(); mocks.actor = props.providerId; mocks.authError = false;
  mocks.getUser.mockReset().mockImplementation(async () => authResult());
  blob = new Blob(['{"value":4.20000000000000001}'], { type: 'application/fhir+json' });
  mocks.fetch.mockReset().mockResolvedValue(response());
  mocks.createUrl.mockReset().mockReturnValue('blob:synthetic-fhir');
  mocks.revokeUrl.mockReset(); mocks.clicked.mockReset();
  vi.stubGlobal('fetch', mocks.fetch);
  Object.defineProperty(URL, 'createObjectURL', { value: mocks.createUrl, configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: mocks.revokeUrl, configurable: true });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    mocks.clicked({ href: this.href, download: this.download, connected: this.isConnected });
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('FHIR browser download session boundary', () => {
  it('checks identity before enabling export and downloads original Blob bytes with cleanup', async () => {
    const gate = deferred<ReturnType<typeof authResult>>(); mocks.getUser.mockReturnValueOnce(gate.promise);
    render(<FhirDownloadButton {...props} />);
    expect(screen.getByRole('button')).toBeDisabled(); expect(mocks.fetch).not.toHaveBeenCalled();
    await act(async () => gate.resolve(authResult())); await ready(); start();
    await waitFor(() => expect(mocks.clicked).toHaveBeenCalledOnce());
    expect(mocks.getUser).toHaveBeenCalledTimes(3);
    expect(mocks.fetch).toHaveBeenCalledWith('/api/patients/' + props.patientId + '/fhir', expect.objectContaining({
      credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: expect.any(AbortSignal),
      headers: { 'X-Heartland-Expected-Actor': props.providerId },
    }));
    expect(mocks.createUrl).toHaveBeenCalledWith(blob);
    expect(mocks.clicked).toHaveBeenCalledWith({ href: 'blob:synthetic-fhir', download: expect.stringMatching(/heartland-fhir-r4-.*\.json/), connected: true });
    expect(mocks.revokeUrl).toHaveBeenCalledWith('blob:synthetic-fhir');
    expect(document.querySelector('a[download]')).toBeNull(); await ready();
  });
  it('prevents duplicate concurrent requests', async () => {
    const gate = deferred<ReturnType<typeof response>>(); mocks.fetch.mockReturnValue(gate.promise);
    render(<FhirDownloadButton {...props} />); await ready(); start();
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
    await act(async () => gate.resolve(response())); expect(mocks.clicked).toHaveBeenCalledOnce();
  });
  it.each(['logout', 'A-B-A'])('aborts and discards a late request after %s', async (kind) => {
    const gate = deferred<ReturnType<typeof response>>(); mocks.fetch.mockReturnValue(gate.promise);
    render(<FhirDownloadButton {...props} />); await ready(); start();
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
    const signal = mocks.fetch.mock.calls[0][1].signal;
    act(() => { switchActor(kind === 'logout' ? null : other); if (kind === 'A-B-A') switchActor(props.providerId); });
    expect(signal.aborted).toBe(true);
    await act(async () => gate.resolve(response()));
    expect(screen.getByRole('alert')).toHaveTextContent('session changed');
    expect(screen.queryByRole('button')).toBeNull(); expect(mocks.createUrl).not.toHaveBeenCalled();
  });
  it('blocks before fetch when the click-time auth read returns another account', async () => {
    render(<FhirDownloadButton {...props} />); await ready();
    mocks.getUser.mockResolvedValueOnce(authResult(other)); start();
    await screen.findByRole('alert'); expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it('discards a late pre-fetch auth response after A→B→A', async () => {
    render(<FhirDownloadButton {...props} />); await ready();
    const gate = deferred<ReturnType<typeof authResult>>(); mocks.getUser.mockReturnValueOnce(gate.promise); start();
    act(() => { switchActor(other); switchActor(props.providerId); });
    await act(async () => gate.resolve(authResult()));
    expect(mocks.fetch).not.toHaveBeenCalled(); expect(mocks.clicked).not.toHaveBeenCalled();
  });
  it('discards bytes when the session changes during body loading', async () => {
    const gate = deferred<Blob>(); const result = response({ blob: vi.fn(() => gate.promise) });
    mocks.fetch.mockResolvedValue(result); render(<FhirDownloadButton {...props} />); await ready(); start();
    await waitFor(() => expect(result.blob).toHaveBeenCalled());
    act(() => { switchActor(other); switchActor(props.providerId); });
    await act(async () => gate.resolve(blob)); expect(mocks.createUrl).not.toHaveBeenCalled();
  });
  it('requires final account verification after the body, even without an auth event', async () => {
    render(<FhirDownloadButton {...props} />); await ready();
    mocks.getUser.mockResolvedValueOnce(authResult()).mockResolvedValueOnce(authResult(other)); start();
    await screen.findByRole('alert'); expect(mocks.createUrl).not.toHaveBeenCalled();
  });
  it('does not release a Blob while final auth is pending and discards it after account change', async () => {
    render(<FhirDownloadButton {...props} />); await ready();
    const gate = deferred<ReturnType<typeof authResult>>();
    mocks.getUser.mockResolvedValueOnce(authResult()).mockReturnValueOnce(gate.promise); start();
    await waitFor(() => expect(mocks.getUser).toHaveBeenCalledTimes(3));
    expect(mocks.createUrl).not.toHaveBeenCalled();
    act(() => switchActor(other)); await act(async () => gate.resolve(authResult(props.providerId)));
    expect(mocks.clicked).not.toHaveBeenCalled();
  });
  it.each(['patient', 'context', 'unmount'])('discards the old request on %s change and does not affect a newer lifetime', async (kind) => {
    const gate = deferred<ReturnType<typeof response>>(); mocks.fetch.mockReturnValueOnce(gate.promise);
    const view = render(<FhirDownloadButton {...props} />); await ready(); start();
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
    const signal = mocks.fetch.mock.calls[0][1].signal;
    if (kind === 'unmount') view.unmount();
    else view.rerender(<FhirDownloadButton {...props} {...(kind === 'patient' ? { patientId: other } : { contextId: 'server-lifetime-2' })} />);
    expect(signal.aborted).toBe(true); await act(async () => gate.resolve(response()));
    expect(mocks.clicked).not.toHaveBeenCalled(); if (kind !== 'unmount') await ready();
  });
  it.each(['actor', 'patient', 'type', 'server-error', 'oversized', 'network-error'])('rejects %s without releasing data and allows a safe retry', async (kind) => {
    const result = response();
    if (kind === 'actor') result.headers.set('X-Heartland-Export-Actor', other);
    if (kind === 'patient') result.headers.set('X-Heartland-Export-Patient', other);
    if (kind === 'type') result.headers.set('Content-Type', 'text/html');
    if (kind === 'server-error') { result.ok = false; result.status = 500; }
    if (kind === 'oversized') { result.ok = false; result.status = 413; }
    if (kind === 'network-error') mocks.fetch.mockRejectedValueOnce(new Error('Network unavailable'));
    else mocks.fetch.mockResolvedValueOnce(result);
    render(<FhirDownloadButton {...props} />); await ready(); start();
    const alert = await screen.findByRole('alert');
    if (kind === 'oversized') expect(alert).toHaveTextContent('10,000-resource limit');
    expect(mocks.clicked).not.toHaveBeenCalled(); expect(mocks.createUrl).not.toHaveBeenCalled(); await ready();
    start(); await waitFor(() => expect(mocks.clicked).toHaveBeenCalledOnce());
  });
  it('cleans a created URL and anchor even when browser handoff throws', async () => {
    vi.mocked(HTMLAnchorElement.prototype.click).mockImplementationOnce(() => { throw new Error('Browser unavailable'); });
    render(<FhirDownloadButton {...props} />); await ready(); start(); await screen.findByRole('alert');
    expect(mocks.revokeUrl).toHaveBeenCalledWith('blob:synthetic-fhir'); expect(document.querySelector('a[download]')).toBeNull();
  });
  it('ignores the abandoned StrictMode auth response without invalidating the fresh lifetime', async () => {
    const gate = deferred<ReturnType<typeof authResult>>(); mocks.getUser.mockReturnValueOnce(gate.promise);
    render(<StrictMode><FhirDownloadButton {...props} /></StrictMode>); await ready();
    await act(async () => gate.resolve(authResult(other)));
    await ready(); expect(screen.queryByRole('alert')).toBeNull();
    start(); await waitFor(() => expect(mocks.clicked).toHaveBeenCalledOnce());
  });
  it('integrates the session button in the server page instead of an unguarded href', () => {
    const source = readFileSync('app/(provider)/patients/[patientId]/page.tsx', 'utf8');
    expect(source).toContain('<FhirDownloadButton providerId={user.id} patientId={patientId} contextId={randomUUID()} />');
    expect(source).not.toMatch(/href=.*api\/patients/);
  });
});
