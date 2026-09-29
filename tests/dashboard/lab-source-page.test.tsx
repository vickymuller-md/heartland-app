import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
const { authorize, directory, panel } = vi.hoisted(() => ({ authorize: vi.fn(), directory: vi.fn(), panel: vi.fn() }));
vi.mock('@/lib/auth/authorization', () => ({ authorize }));
vi.mock('@/lib/team/queries', () => ({ getTeamDirectory: directory }));
vi.mock('@/components/disclaimers/provider-page-disclaimer', () => ({ ProviderPageDisclaimer: () => <p>Synthetic disclaimer</p> }));
vi.mock('@/app/(provider)/patients/[patientId]/_components/lab-source-panel', () => ({ LabSourcePanel: (props: unknown) => { panel(props); return <p>Source panel</p>; } }));
import Page from '@/app/(provider)/patients/[patientId]/lab-sources/page';
const id = (n: number) => `66000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const client = {}; const params = Promise.resolve({ patientId: id(11) });
beforeEach(() => { vi.clearAllMocks(); authorize.mockResolvedValue({ authorized: true, user: { id: id(1) }, supabase: client });
  directory.mockResolvedValue({ error: null, members: [{ is_self: true, organization_id: id(90), organization_name: 'Synthetic A' },
    { is_self: false, organization_id: id(91), organization_name: 'Not my organization' }, { is_self: true, organization_id: id(92), organization_name: 'Synthetic B' }] }); });
afterEach(cleanup);
describe('explicit source organization route', () => {
  it('requires a provider session before loading any directory or panel', async () => {
    authorize.mockResolvedValue({ authorized: false }); render(await Page({ params, searchParams: Promise.resolve({}) }));
    expect(screen.getByRole('alert')).toHaveTextContent('MFA'); expect(directory).not.toHaveBeenCalled(); expect(panel).not.toHaveBeenCalled();
  });
  it.each(['bad', [id(90)], [id(90), id(91)]])('rejects malformed or ambiguous organization %#', async (organization) => {
    render(await Page({ params, searchParams: Promise.resolve({ organization }) }));
    expect(screen.getByRole('alert')).toHaveTextContent('could not be verified'); expect(directory).not.toHaveBeenCalled(); expect(panel).not.toHaveBeenCalled();
  });
  it('rejects an invalid patient ID', async () => {
    render(await Page({ params: Promise.resolve({ patientId: 'bad' }), searchParams: Promise.resolve({}) })); expect(screen.getByRole('alert')).toBeInTheDocument(); expect(directory).not.toHaveBeenCalled();
  });
  it('never silently chooses a primary organization from directory membership', async () => {
    render(await Page({ params, searchParams: Promise.resolve({}) }));
    expect(screen.getByRole('link', { name: 'Synthetic A' })).toHaveAttribute('href', `/patients/${id(11)}/lab-sources?organization=${id(90)}`);
    expect(screen.getByRole('link', { name: 'Synthetic B' })).toBeInTheDocument(); expect(screen.queryByText('Not my organization')).not.toBeInTheDocument();
    expect(panel).not.toHaveBeenCalled(); expect(screen.getByText(/Membership alone does not authorize/)).toBeInTheDocument();
  });
  it('passes explicitly selected scope and a fresh render fence, without directory-based authority', async () => {
    const props = { params, searchParams: Promise.resolve({ organization: id(90) }) };
    render(await Page(props)); expect(directory).not.toHaveBeenCalled();
    expect(panel).toHaveBeenLastCalledWith(expect.objectContaining({ actorId: id(1), patientId: id(11), organizationId: id(90), scopeKey: expect.any(String) }));
    const previous = panel.mock.calls.at(-1)![0].scopeKey;
    cleanup(); render(await Page(props)); expect(panel.mock.calls.at(-1)![0].scopeKey).not.toBe(previous);
  });
  it.each([{ error: 'Unavailable', members: [] }, { error: null, members: [{ is_self: true, organization_id: 'bad', organization_name: 'Synthetic' }] }])('does not turn directory failure into authorized empty success %#', async (result) => {
    directory.mockResolvedValue(result); render(await Page({ params, searchParams: Promise.resolve({}) }));
    expect(screen.getByRole('alert')).toHaveTextContent('directory unavailable'); expect(panel).not.toHaveBeenCalled();
  });
});
