import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SafetyGateCard } from '@/components/gdmt/safety-gate-card';
import { SAFETY_GATE_RULES, SAFETY_GATE_SCOPE } from '@/lib/gdmt/constants';

// ==========================================================================
// GDMT-06: Titration Safety Gates Display
// Protocol v3.3 Module 2, Section 2.2 -- Titration Safety Gates Summary
// UPTITRATE IF: SBP >=100, HR >=50, K+ <5.0
// HOLD IF: SBP <90, HR <50, K+ >5.5, Cr increase >30%
// ==========================================================================
describe('GDMT-06: Safety Gates', () => {
  it('qualifies the audience and excludes finerenone from generic renal/potassium holds', () => {
    render(<SafetyGateCard />);
    expect(screen.getByText(SAFETY_GATE_SCOPE)).toBeInTheDocument();
    expect(screen.queryByText('K+ >5.5')).not.toBeInTheDocument();
    expect(screen.getByText(/K\+ >5.5 \(steroidal MRA; not the finerenone rule\)/)).toBeInTheDocument();
  });
  it('renders UPTITRATE IF section with green styling', () => {
    render(<SafetyGateCard />);
    const heading = screen.getByText('UPTITRATE IF');
    expect(heading).toBeInTheDocument();
    expect(heading.className).toContain('green');
  });

  it('renders HOLD IF section with red styling', () => {
    render(<SafetyGateCard />);
    const heading = screen.getByText('HOLD IF');
    expect(heading).toBeInTheDocument();
    expect(heading.className).toContain('red');
  });

  it('UPTITRATE shows: SBP >=100, HR >=50, K+ <5.0', () => {
    render(<SafetyGateCard />);
    const uptitrate = SAFETY_GATE_RULES.filter((r) => r.action === 'uptitrate');
    expect(uptitrate).toHaveLength(3);
    for (const rule of uptitrate) {
      expect(screen.getByText(rule.condition)).toBeInTheDocument();
    }
  });

  it('HOLD shows: SBP <90, HR <50, K+ >5.5, Cr increase >30%', () => {
    render(<SafetyGateCard />);
    const hold = SAFETY_GATE_RULES.filter((r) => r.action === 'hold');
    expect(hold).toHaveLength(4);
    for (const rule of hold) {
      expect(screen.getByText(rule.condition)).toBeInTheDocument();
    }
  });
});
