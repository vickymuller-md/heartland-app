import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StateField } from '@/app/(patient)/profile/_components/state-field';
import { updateProfileState } from '@/app/(patient)/profile/actions';
import { findUsRegion } from '@/lib/us-regions';

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(), from: vi.fn(), update: vi.fn(), eq: vi.fn(), select: vi.fn(),
  success: vi.fn(), error: vi.fn(), revalidate: vi.fn(),
}));
vi.mock('@/lib/auth/authorization', () => ({ authorize: mocks.authorize }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error } }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({ authorized: true, user: { id: 'synthetic-patient' }, supabase: { from: mocks.from } });
  mocks.from.mockReturnValue({ update: mocks.update });
  mocks.update.mockReturnValue({ eq: mocks.eq });
  mocks.eq.mockReturnValue({ select: mocks.select });
  mocks.select.mockResolvedValue({ data: [{ id: 'synthetic-patient' }], error: null });
});
afterEach(cleanup);

describe('profile geography for the evidence report', () => {
  it('makes a historical name selectable and persists a newly selected territory with its postal code', async () => {
    render(<><label htmlFor="state">State or territory</label><StateField defaultValue="California" /></>);
    const dropdown = screen.getByRole('combobox', { name: 'State or territory' });
    expect(dropdown).toHaveValue('CA');
    fireEvent.change(dropdown, { target: { value: 'PR' } });
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith('Saved'));
    expect(mocks.update).toHaveBeenCalledWith({ state: 'PR' });
    expect(mocks.eq).toHaveBeenCalledWith('id', 'synthetic-patient');
    expect(findUsRegion('PR')?.name).toBe('Puerto Rico');
  });
  it('restores the saved selection if the update fails', async () => {
    mocks.select.mockResolvedValueOnce({ data: null, error: { message: 'Unavailable' } });
    render(<StateField defaultValue="TX" />);
    const dropdown = screen.getByRole('combobox');
    fireEvent.change(dropdown, { target: { value: 'OH' } });
    await waitFor(() => expect(mocks.error).toHaveBeenCalled());
    expect(dropdown).toHaveValue('TX');
  });
  it('accepts previous full-name clients and explicit clearing, and excludes free text from the map', async () => {
    expect(await updateProfileState('  district of columbia ')).toEqual({ success: true });
    expect(mocks.update).toHaveBeenCalledWith({ state: 'DC' });
    expect(await updateProfileState('  ')).toEqual({ success: true });
    expect(mocks.update).toHaveBeenCalledWith({ state: null });
    const requests = mocks.update.mock.calls.length;
    expect(await updateProfileState('ZZ')).toEqual({ error: 'Invalid state or territory' });
    expect(findUsRegion('unexpected private text')).toBeUndefined();
    expect(mocks.update).toHaveBeenCalledTimes(requests);
  });
});
