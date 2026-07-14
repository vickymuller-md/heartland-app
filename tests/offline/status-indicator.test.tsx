import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockUseIsOnline = vi.fn<() => boolean>().mockReturnValue(true);

vi.mock('@/lib/offline/hooks', () => ({
  useIsOnline: () => mockUseIsOnline(),
}));

import { OfflineIndicator } from '@/app/(patient)/today/_components/OfflineIndicator';

describe('OfflineIndicator', () => {
  beforeEach(() => {
    mockUseIsOnline.mockReturnValue(true);
  });

  it('renders nothing while online', () => {
    const { container } = render(<OfflineIndicator />);
    expect(container.innerHTML).toBe('');
  });

  it('warns that offline clinical data is not saved', () => {
    mockUseIsOnline.mockReturnValue(false);
    render(<OfflineIndicator />);
    expect(screen.getByText(/clinical data is not saved on this device/i)).toBeInTheDocument();
  });

  it('uses a polite accessible status region', () => {
    mockUseIsOnline.mockReturnValue(false);
    render(<OfflineIndicator />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });
});
