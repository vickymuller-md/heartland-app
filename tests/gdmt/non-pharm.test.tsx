import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NonPharmacological } from '@/app/(public)/gdmt-pathway/non-pharmacological';

// ==========================================================================
// GDMT-07: Non-Pharmacological Management Display
// Protocol v3.3 Module 2, Section 2.3
// Dietary Sodium: <2,000 mg/day
// Physical Activity: Walking 5-10 min daily, increase to 30 min
// Cardiac Rehabilitation: Class I recommendation
// ==========================================================================
describe('GDMT-07: Non-Pharmacological Management', () => {
  it('renders dietary sodium target: <2,000 mg/day', () => {
    render(<NonPharmacological />);
    expect(screen.getByText('Dietary Sodium')).toBeInTheDocument();
    expect(screen.getByText('<2,000 mg/day')).toBeInTheDocument();
  });

  it('renders physical activity guidance', () => {
    render(<NonPharmacological />);
    expect(screen.getByText('Physical Activity')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Walking 5-10 min daily, gradually increase to 30 min moderate activity most days'
      )
    ).toBeInTheDocument();
  });

  it('renders cardiac rehabilitation as Class I recommendation', () => {
    render(<NonPharmacological />);
    expect(screen.getByText('Cardiac Rehabilitation')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Class I recommendation -- refer all eligible patients'
      )
    ).toBeInTheDocument();
  });
});
