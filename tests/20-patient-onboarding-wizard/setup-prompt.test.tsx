/**
 * SetupPrompt Component -- Tests
 * Requirements: ONBD-01
 * Source: HEARTLAND Protocol v3.3 -- Phase 20 Patient Onboarding Wizard
 *
 * ONBD-01: After linkage acceptance, provider sees "Complete Setup" CTA
 *          linking to /patients/[patientId]/onboarding.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SetupPrompt } from '@/app/(provider)/patients/[patientId]/_components/setup-prompt';

describe('SetupPrompt (ONBD-01)', () => {
  it('renders a "Complete Setup" link pointing to /patients/[patientId]/onboarding', () => {
    render(<SetupPrompt patientId="p-123" setupComplete={false} />);
    const link = screen.getByRole('link', { name: /complete setup/i });
    expect(link).toHaveAttribute('href', '/patients/p-123/onboarding');
  });

  it('does NOT render when setup_complete is true', () => {
    render(<SetupPrompt patientId="p-123" setupComplete={true} />);
    const link = screen.queryByRole('link', { name: /complete setup/i });
    expect(link).toBeNull();
  });
});
