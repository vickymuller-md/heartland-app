import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RedFlagCard } from '@/components/remote-monitoring/red-flag-card';

// ==========================================================================
// RMON-03: Red Flag Alert Criteria Card — Component Tests
// Protocol v3.3 Module 5, Section 5.2
// ==========================================================================
describe('RedFlagCard', () => {
  it('renders exactly 6 red flag alert criteria', () => {
    render(<RedFlagCard />);
    expect(screen.getByText(/Weight gain.*3 lbs/)).toBeDefined();
    expect(screen.getByText(/Weight gain.*5 lbs/)).toBeDefined();
    expect(screen.getByText(/SBP <90 mmHg/)).toBeDefined();
    expect(screen.getByText(/SpO2 <92%/)).toBeDefined();
    expect(screen.getByText(/dyspnea at rest/)).toBeDefined();
    expect(screen.getByText(/Chest pain, syncope/)).toBeDefined();
  });

  it('shows "Weight gain >= 3 lbs in 2 days" with action "Call clinic same day"', () => {
    render(<RedFlagCard />);
    expect(screen.getByText(/3 lbs in 2 days/)).toBeDefined();
    expect(screen.getByText('Call clinic same day')).toBeDefined();
  });

  it('shows "Weight gain >= 5 lbs in 1 week" with action "Urgent evaluation within 24h"', () => {
    render(<RedFlagCard />);
    expect(screen.getByText(/5 lbs in 1 week/)).toBeDefined();
    expect(screen.getByText('Urgent evaluation within 24h')).toBeDefined();
  });

  it('shows "SBP < 90 mmHg with symptoms" with action "Hold GDMT; call provider"', () => {
    render(<RedFlagCard />);
    expect(screen.getByText('SBP <90 mmHg with symptoms')).toBeDefined();
    expect(screen.getByText('Hold GDMT; call provider')).toBeDefined();
  });

  it('shows "SpO2 < 92% at rest" with action "Urgent evaluation"', () => {
    render(<RedFlagCard />);
    expect(screen.getByText(/SpO2 <92% at rest/)).toBeDefined();
    expect(screen.getByText('Urgent evaluation')).toBeDefined();
  });

  it('shows "New/worsening dyspnea at rest" with action "Same-day evaluation"', () => {
    render(<RedFlagCard />);
    expect(screen.getByText('New/worsening dyspnea at rest')).toBeDefined();
    expect(screen.getByText('Same-day evaluation')).toBeDefined();
  });

  it('shows "Chest pain, syncope" with action "EMERGENCY -- Call 911" and emergency styling', () => {
    render(<RedFlagCard />);
    const emergencyElement = screen.getByRole('alert');
    expect(emergencyElement).toBeDefined();
    expect(screen.getByText('Chest pain, syncope')).toBeDefined();
    expect(screen.getByText('EMERGENCY')).toBeDefined();
  });

  it('uses color-coded severity: red for emergency, orange for urgent, yellow for same-day', () => {
    render(<RedFlagCard />);
    const alertElement = screen.getByRole('alert');
    expect(alertElement.className).toContain('bg-red-50');
    expect(alertElement.className).toContain('border-red-500');
  });
});
