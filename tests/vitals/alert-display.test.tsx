import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RedFlagAlert } from '@/app/(patient)/today/_components/red-flag-alert';
import type { RedFlag } from '@/lib/vitals/types';

// ==========================================================================
// VITL-06: Red Flag Alert Display
// Patient-facing alert shown after vitals submission when red flags are
// triggered. Severity-coded (amber=warning, red=critical) with action
// guidance matching HEARTLAND Protocol v3.3 Module 5, Section 5.2.
// ==========================================================================

const warningFlag: RedFlag = {
  id: 'weight_gain_3lb_2d',
  severity: 'warning',
  message: 'Weight gain of 3+ lbs in 2 days detected',
  action: 'Call your clinic today',
};

const criticalFlag: RedFlag = {
  id: 'spo2_low',
  severity: 'critical',
  message: 'Low oxygen saturation (<92%)',
  action: 'Seek urgent evaluation',
};

const criticalSbpFlag: RedFlag = {
  id: 'sbp_low_symptomatic',
  severity: 'critical',
  message: 'Low blood pressure with symptoms',
  action: 'Hold GDMT medications and call your provider immediately',
};

describe('RedFlagAlert', () => {
  it('renders warning-level alert with amber styling for weight gain 3lb/2d', () => {
    const { container } = render(<RedFlagAlert flags={[warningFlag]} />);
    // Should find warning text
    expect(screen.getByText('Warning')).toBeInTheDocument();
    expect(screen.getByText(warningFlag.message)).toBeInTheDocument();
    expect(screen.getByText(warningFlag.action)).toBeInTheDocument();
    // Amber styling
    const alertEl = container.querySelector('[role="alert"]');
    expect(alertEl).toBeInTheDocument();
    expect(alertEl?.className).toMatch(/amber/);
  });

  it('renders critical-level alert with red styling for SBP < 90, SpO2 < 92%', () => {
    const { container } = render(<RedFlagAlert flags={[criticalFlag, criticalSbpFlag]} />);
    expect(screen.getByText(criticalFlag.message)).toBeInTheDocument();
    expect(screen.getByText(criticalSbpFlag.message)).toBeInTheDocument();
    // Red styling
    const alerts = container.querySelectorAll('[role="alert"]');
    expect(alerts.length).toBeGreaterThanOrEqual(2);
    alerts.forEach((el) => {
      expect(el.className).toMatch(/red/);
    });
  });

  it("displays patient-facing action guidance text matching protocol (e.g., 'Call your clinic today')", () => {
    render(<RedFlagAlert flags={[warningFlag]} />);
    expect(screen.getByText('Call your clinic today')).toBeInTheDocument();
  });

  it('renders multiple alerts when multiple red flags triggered', () => {
    render(<RedFlagAlert flags={[warningFlag, criticalFlag]} />);
    expect(screen.getByText(warningFlag.message)).toBeInTheDocument();
    expect(screen.getByText(criticalFlag.message)).toBeInTheDocument();
  });

  it('does not render when redFlags array is empty', () => {
    const { container } = render(<RedFlagAlert flags={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('uses proper ARIA alert role', () => {
    const { container } = render(<RedFlagAlert flags={[criticalFlag]} />);
    const alertEls = container.querySelectorAll('[role="alert"]');
    expect(alertEls.length).toBeGreaterThanOrEqual(1);
  });

  it('action guidance text has large font for elderly readability', () => {
    const { container } = render(<RedFlagAlert flags={[warningFlag]} />);
    const actionEl = screen.getByText(warningFlag.action);
    // Should have text-lg or larger + font-bold/font-semibold
    expect(actionEl.className).toMatch(/text-lg|text-xl/);
    expect(actionEl.className).toMatch(/font-bold|font-semibold/);
  });
});
