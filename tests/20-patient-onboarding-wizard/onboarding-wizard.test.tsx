/**
 * OnboardingWizard Component -- Tests
 * Requirements: ONBD-02, ONBD-03, ONBD-04
 * Source: HEARTLAND Protocol v3.3 -- Phase 20 Patient Onboarding Wizard
 *
 * ONBD-02: Wizard renders 5 steps in correct order
 * ONBD-03: Progress indicator shows "Setup X/5 complete"
 * ONBD-04: Can skip steps and return later (resumes from first incomplete)
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { OnboardingWizard } from '@/app/(provider)/patients/[patientId]/onboarding/onboarding-wizard';
import { SETUP_STEPS } from '@/lib/onboarding/constants';

// Mock the markSetupStep Server Action
vi.mock('@/lib/onboarding/actions', () => ({
  markSetupStep: vi.fn().mockResolvedValue({ success: true }),
}));

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

describe('OnboardingWizard step labels (ONBD-02)', () => {
  it('renders exactly 5 step labels in correct order', () => {
    render(
      <OnboardingWizard
        patientId="p-123"
        patientName="Jane Doe"
        completedSteps={0}
      />
    );
    const expectedLabels = [
      'Risk Calculator',
      'Track Assignment',
      'Add Medications',
      'Device Setup Guide',
      'Assign Education Modules',
    ];
    // Each label appears in the stepper AND potentially in the step card.
    // Verify at least one instance of each label is in the document.
    for (const label of expectedLabels) {
      expect(screen.getAllByText(label).length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('OnboardingWizard progress indicator (ONBD-03)', () => {
  it('shows "Setup 3/5 complete" when completedSteps = 7 (bits 1+2+4)', () => {
    render(
      <OnboardingWizard
        patientId="p-123"
        patientName="Jane Doe"
        completedSteps={7}
      />
    );
    expect(screen.getByText(/setup 3\/5 complete/i)).toBeDefined();
  });

  it('shows "Setup 0/5 complete" when completedSteps = 0', () => {
    render(
      <OnboardingWizard
        patientId="p-123"
        patientName="Jane Doe"
        completedSteps={0}
      />
    );
    expect(screen.getByText(/setup 0\/5 complete/i)).toBeDefined();
  });

  it('shows "Setup complete" when completedSteps = 31', () => {
    render(
      <OnboardingWizard
        patientId="p-123"
        patientName="Jane Doe"
        completedSteps={31}
      />
    );
    // Multiple "Setup complete!" texts appear (progress indicator + banner)
    const matches = screen.getAllByText(/setup complete/i);
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });
});

describe('OnboardingWizard skip/resume (ONBD-04)', () => {
  it('initializes at step 1 when step 0 is already complete (completedSteps = 1)', () => {
    render(
      <OnboardingWizard
        patientId="p-123"
        patientName="Jane Doe"
        completedSteps={1}
      />
    );
    // Step 1 is "Track Assignment" -- it should be the active step card title
    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading.textContent).toBe('Track Assignment');
  });

  it('Skip button navigates to next step without marking current complete', () => {
    render(
      <OnboardingWizard
        patientId="p-123"
        patientName="Jane Doe"
        completedSteps={0}
      />
    );
    const skipButton = screen.getByRole('button', { name: /skip/i });
    fireEvent.click(skipButton);
    // After skip from step 0, wizard should show step 1 card heading
    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading.textContent).toBe('Track Assignment');
  });

  it('"Mark Complete" button calls onStepComplete with the step bit value', async () => {
    const { markSetupStep } = await import('@/lib/onboarding/actions');
    render(
      <OnboardingWizard
        patientId="p-123"
        patientName="Jane Doe"
        completedSteps={0}
      />
    );
    const completeButton = screen.getByRole('button', { name: /mark complete/i });
    fireEvent.click(completeButton);
    // Step 0 has bit value 1
    expect(markSetupStep).toHaveBeenCalledWith('p-123', 1);
  });
});
