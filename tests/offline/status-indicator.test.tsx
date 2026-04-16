/**
 * OfflineIndicator -- Component Tests
 * Requirements: VITL-10 (offline status indicator with pending count)
 * Source: HEARTLAND Protocol v3.3, Module 5
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock the offline hooks so we can control their return values
const mockUsePendingSyncCount = vi.fn<() => number>().mockReturnValue(0);
const mockUseIsOnline = vi.fn<() => boolean>().mockReturnValue(true);

vi.mock('@/lib/offline/hooks', () => ({
  usePendingSyncCount: () => mockUsePendingSyncCount(),
  useIsOnline: () => mockUseIsOnline(),
}));

import { OfflineIndicator } from '@/app/(patient)/today/_components/OfflineIndicator';

// ==========================================================================
// VITL-10: Offline status indicator -- shows pending count and sync state
// ==========================================================================

describe('OfflineIndicator', () => {
  beforeEach(() => {
    mockUsePendingSyncCount.mockReturnValue(0);
    mockUseIsOnline.mockReturnValue(true);
  });

  it('renders nothing when online and zero pending records', () => {
    const { container } = render(<OfflineIndicator />);
    // role="status" element should not be in the document (null return)
    expect(container.innerHTML).toBe('');
  });

  it('shows "1 record waiting to sync" when 1 pending record', () => {
    mockUsePendingSyncCount.mockReturnValue(1);
    render(<OfflineIndicator />);
    expect(screen.getByText(/1 record waiting to sync/)).toBeInTheDocument();
  });

  it('shows "3 records waiting to sync" with correct plural when 3 pending', () => {
    mockUsePendingSyncCount.mockReturnValue(3);
    render(<OfflineIndicator />);
    expect(screen.getByText(/3 records waiting to sync/)).toBeInTheDocument();
  });

  it('shows "You are offline" banner when navigator.onLine is false', () => {
    mockUseIsOnline.mockReturnValue(false);
    render(<OfflineIndicator />);
    expect(screen.getByText('You are offline.')).toBeInTheDocument();
  });

  it('shows both offline banner and pending count when offline with pending records', () => {
    mockUseIsOnline.mockReturnValue(false);
    mockUsePendingSyncCount.mockReturnValue(2);
    render(<OfflineIndicator />);
    expect(screen.getByText('You are offline.')).toBeInTheDocument();
    expect(screen.getByText(/2 records waiting to sync/)).toBeInTheDocument();
  });

  it('shows "Syncing now..." when online with pending records', () => {
    mockUseIsOnline.mockReturnValue(true);
    mockUsePendingSyncCount.mockReturnValue(2);
    render(<OfflineIndicator />);
    expect(screen.getByText(/Syncing now.../)).toBeInTheDocument();
  });

  it('has role="status" and aria-live="polite" for accessibility', () => {
    mockUseIsOnline.mockReturnValue(false);
    render(<OfflineIndicator />);
    const statusEl = screen.getByRole('status');
    expect(statusEl).toHaveAttribute('aria-live', 'polite');
  });
});
