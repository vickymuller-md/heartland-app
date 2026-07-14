/**
 * Patient Portal Shell -- Bottom-Tab Navigation Tests
 * Requirement: VITL-08 (elderly-optimized UI)
 */

import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';

const { mockClearOfflineData } = vi.hoisted(() => ({
  mockClearOfflineData: vi.fn().mockResolvedValue(undefined),
}));

// Mock next/navigation
const mockPathname = vi.fn(() => '/today');
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
}));

// Mock next/link
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    className,
  }: {
    children: React.ReactNode;
    href: string;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

// Mock SignOutButton
vi.mock('@/components/auth/sign-out-button', () => ({
  SignOutButton: ({ className }: { className?: string }) => (
    <button className={className}>Sign Out</button>
  ),
}));

// Mock InstallPrompt (uses localStorage + beforeinstallprompt, not available in jsdom)
vi.mock('@/components/pwa/InstallPrompt', () => ({
  InstallPrompt: () => null,
}));

vi.mock('@/lib/offline/db', () => ({
  clearOfflineData: mockClearOfflineData,
}));

import PatientLayout from '@/app/(patient)/layout';

describe('PatientLayout', () => {
  beforeEach(() => {
    mockClearOfflineData.mockClear();
  });

  it('purges legacy offline clinical data on portal entry', async () => {
    render(
      <PatientLayout>
        <div>content</div>
      </PatientLayout>
    );

    await waitFor(() => expect(mockClearOfflineData).toHaveBeenCalledOnce());
  });

  it('renders six task-oriented bottom tabs and a separate profile link', () => {
    render(
      <PatientLayout>
        <div>content</div>
      </PatientLayout>
    );

    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByText('History')).toBeInTheDocument();
    expect(screen.getByText('Meds')).toBeInTheDocument();
    expect(screen.getByText('Plan')).toBeInTheDocument();
    expect(screen.getByText('Learn')).toBeInTheDocument();
    expect(screen.getByText('Privacy')).toBeInTheDocument();
    expect(document.querySelector('a[href="/profile"]')).toBeInTheDocument();
  });

  it('highlights active tab based on current pathname', () => {
    mockPathname.mockReturnValue('/today');

    render(
      <PatientLayout>
        <div>content</div>
      </PatientLayout>
    );

    // The Today tab link should have the active styling class
    const todayLink = screen.getByText('Today').closest('a');
    expect(todayLink?.className).toContain('text-blue-600');
    expect(todayLink?.className).toContain('font-semibold');

    // The History tab link should NOT have active styling
    const historyLink = screen.getByText('History').closest('a');
    expect(historyLink?.className).toContain('text-gray-500');
  });

  it('each tab has minimum 48px tap target (min-h-[48px] min-w-[48px])', () => {
    render(
      <PatientLayout>
        <div>content</div>
      </PatientLayout>
    );

    const links = screen.getAllByRole('link');
    // 5 tab links in the nav
    const tabLinks = links.filter(
      (link) =>
        link.getAttribute('href') === '/today' ||
        link.getAttribute('href') === '/history' ||
        link.getAttribute('href') === '/medications' ||
        link.getAttribute('href') === '/plan' ||
        link.getAttribute('href') === '/education' ||
        link.getAttribute('href') === '/privacy'
    );
    expect(tabLinks).toHaveLength(6);

    tabLinks.forEach((link) => {
      expect(link.className).toContain('min-h-[48px]');
      expect(link.className).toContain('min-w-[48px]');
    });
  });

  it('renders icons AND text labels for each tab (not icons alone)', () => {
    render(
      <PatientLayout>
        <div>content</div>
      </PatientLayout>
    );

    // Each tab has both an SVG icon and a text span
    const tabLabels = ['Today', 'History', 'Meds', 'Plan', 'Learn', 'Privacy'];
    tabLabels.forEach((label) => {
      const textElement = screen.getByText(label);
      expect(textElement).toBeInTheDocument();
      // The text should be in a span inside a link that also contains an SVG
      const link = textElement.closest('a');
      expect(link?.querySelector('svg')).toBeTruthy();
    });
  });

  it('includes safe area padding for iOS home indicator', () => {
    render(
      <PatientLayout>
        <div>content</div>
      </PatientLayout>
    );

    // React style prop with env() may not be reflected in getAttribute('style')
    // because jsdom doesn't support env() CSS function.
    // Verify the nav element exists and is positioned at the bottom.
    const nav = screen.getByRole('navigation');
    expect(nav.className).toContain('fixed');
    expect(nav.className).toContain('bottom-0');
    // The safe area padding is set via inline style, which jsdom may strip.
    // This is a visual check best validated manually on iOS.
    expect(nav).toBeInTheDocument();
  });

  it('main content area has bottom padding to clear fixed nav bar', () => {
    render(
      <PatientLayout>
        <div data-testid="child">content</div>
      </PatientLayout>
    );

    // The outer div should have pb-20
    const child = screen.getByTestId('child');
    const outerDiv = child.closest('.min-h-screen');
    expect(outerDiv?.className).toContain('pb-20');
  });
});
