import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RedFlagAlert } from '@/app/(patient)/today/_components/red-flag-alert';
import type { RedFlag } from '@/lib/vitals/types';

// Mock localStorage for useEffect caching
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  get length() { return 0; },
  key: vi.fn(),
};
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

beforeEach(() => {
  localStorageMock.setItem.mockClear();
});

/**
 * SAFE-02: RedFlagAlert -- Emergency tel: links
 *
 * RED state: RedFlagAlert currently only accepts { flags: RedFlag[] }.
 * These tests assert on a providerPhone prop that does not exist yet,
 * and on tel: link rendering that is not implemented.
 */

const criticalFlag: RedFlag = {
  id: 'sbp_low',
  severity: 'critical',
  message: 'Blood pressure critically low',
  action: 'Seek immediate care',
};

const warningFlag: RedFlag = {
  id: 'weight_gain',
  severity: 'warning',
  message: 'Significant weight gain detected',
  action: 'Contact your care team within 24 hours',
};

describe('RedFlagAlert -- SAFE-02', () => {
  it('renders tel:911 link for critical flags', () => {
    // providerPhone prop does not exist on RedFlagAlert yet -- forces RED state
    render(
      <RedFlagAlert
        flags={[criticalFlag]}
        providerPhone="+15551234567"
      />,
    );
    const link = screen.getByRole('link', { name: /call 911/i });
    expect(link).toHaveAttribute('href', 'tel:911');
  });

  it('renders clickable provider phone link for critical flags', () => {
    render(
      <RedFlagAlert
        flags={[criticalFlag]}
        providerPhone="+15551234567"
      />,
    );
    const link = screen.getByRole('link', { name: /call your provider/i });
    expect(link).toHaveAttribute('href', 'tel:+15551234567');
  });

  it('warning flag renders provider phone but not Call 911', () => {
    render(
      <RedFlagAlert
        flags={[warningFlag]}
        providerPhone="+15559876543"
      />,
    );
    // Warning flags should NOT show Call 911
    expect(screen.queryByRole('link', { name: /call 911/i })).toBeNull();
    // But SHOULD show provider phone
    const link = screen.getByRole('link', { name: /call your provider/i });
    expect(link).toHaveAttribute('href', 'tel:+15559876543');
  });

  it('renders fallback text when providerPhone is not provided', () => {
    render(<RedFlagAlert flags={[criticalFlag]} />);
    // Without a provider phone, show fallback guidance
    expect(screen.getByText(/contact your care team/i)).toBeInTheDocument();
    // Should still show Call 911 for critical
    const link = screen.getByRole('link', { name: /call 911/i });
    expect(link).toHaveAttribute('href', 'tel:911');
  });
});
