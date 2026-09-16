import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import SandboxLayout from '@/app/(sandbox)/layout';

const { getUser, signOut, clearSecurity, replace, refresh } = vi.hoisted(() => ({
  getUser: vi.fn(), signOut: vi.fn(), clearSecurity: vi.fn(), replace: vi.fn(), refresh: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => ({ auth: { getUser } })) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { signOut } }) }));
vi.mock('@/lib/offline/db', () => ({ clearClientSecurityState: clearSecurity }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, refresh }) }));

// Render the resolved function result, not a full async Server Component tree.
describe('sandbox layout presentation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: null } });
  });

  it('preserves visitor destinations and provides a unique focusable skip target', async () => {
    render(await SandboxLayout({ children: <p>Synthetic content</p> }));
    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('id', 'main-content');
    expect(main).toHaveAttribute('tabindex', '-1');
    main.focus();
    expect(main).toHaveFocus();
    expect(screen.getByRole('link', { name: 'Skip to main content' })).toHaveAttribute('href', '#main-content');
    expect(screen.getByRole('link', { name: /HEARTLAND/ })).toHaveAttribute('href', '/sandbox');
    const account = within(screen.getByRole('navigation', { name: 'Sandbox account options' }));
    expect(account.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
    expect(account.getByRole('link', { name: 'Create account' })).toHaveAttribute('href', '/register?mode=tester');
    expect(screen.queryByRole('button', { name: 'Sign Out' })).not.toBeInTheDocument();
  });

  it('renders the authenticated action without triggering logout or changing routes', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'synthetic-user' } } });
    render(await SandboxLayout({ children: <p>Synthetic content</p> }));
    expect(screen.getByRole('button', { name: 'Sign Out' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Sandbox account options' })).not.toBeInTheDocument();
    expect(signOut).not.toHaveBeenCalled();
    expect(clearSecurity).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});
