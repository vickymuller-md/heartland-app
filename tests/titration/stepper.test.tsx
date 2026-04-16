import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Stepper } from '@/components/titration/stepper';
import { STEP_DEFINITIONS } from '@/lib/titration/constants';

// ==========================================================================
// TITR-01: Multi-Step Wizard (stepper visual indicator)
// ==========================================================================
describe('Stepper component', () => {
  it('renders 5 step indicators', () => {
    render(<Stepper steps={STEP_DEFINITIONS} currentStep={0} />);
    // Should show numbers 1-5
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('shows step labels', () => {
    render(<Stepper steps={STEP_DEFINITIONS} currentStep={0} />);
    expect(screen.getByText('Pre-Call Vitals')).toBeInTheDocument();
  });

  it('marks current step with aria-current="step"', () => {
    render(<Stepper steps={STEP_DEFINITIONS} currentStep={2} />);
    const items = screen.getAllByRole('listitem');
    expect(items[2]).toHaveAttribute('aria-current', 'step');
    expect(items[0]).not.toHaveAttribute('aria-current');
  });

  it('has navigation landmark', () => {
    render(<Stepper steps={STEP_DEFINITIONS} currentStep={0} />);
    expect(screen.getByRole('navigation', { name: /progress/i })).toBeInTheDocument();
  });
});
