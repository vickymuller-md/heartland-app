import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { TitrationDecisionTable } from '@/components/titration/titration-decision-table';

// ==========================================================================
// TITR-05: 7-Row Titration Decision Algorithm Table
// Protocol v3.3 Module 3, Section 3.3
// ==========================================================================
describe('TitrationDecisionTable', () => {
  it('renders exactly 7 rows in the decision algorithm table', () => {
    render(<TitrationDecisionTable />);
    const table = screen.getByTestId('titration-decision-table');
    const rows = within(table).getAllByRole('row');
    // 1 header row + 7 data rows = 8
    expect(rows).toHaveLength(8);
  });

  it('row 1: SBP >= 100 AND asymptomatic -> UPTITRATE to next dose level', () => {
    render(<TitrationDecisionTable />);
    expect(screen.getByText('UPTITRATE to next dose level')).toBeInTheDocument();
  });

  it('row 2: SBP 90-99 AND asymptomatic -> HOLD current dose; reassess in 1 week', () => {
    render(<TitrationDecisionTable />);
    expect(screen.getByText('HOLD current dose; reassess in 1 week')).toBeInTheDocument();
  });

  it('row 3: SBP < 90 OR symptomatic hypotension -> REDUCE dose or hold', () => {
    render(<TitrationDecisionTable />);
    expect(screen.getByText('REDUCE dose or hold; consider cardiology input')).toBeInTheDocument();
  });

  it('row 4: HR < 50 for beta-blockers -> Reduce dose; if symptomatic, hold', () => {
    render(<TitrationDecisionTable />);
    expect(screen.getByText('Reduce dose; if symptomatic, hold')).toBeInTheDocument();
  });

  it('row 5: K+ 5.0-5.5 -> Reduce MRA/finerenone dose; recheck in 1 week', () => {
    render(<TitrationDecisionTable />);
    expect(screen.getByText('Reduce MRA/finerenone dose; recheck in 1 week')).toBeInTheDocument();
  });

  it('row 6: K+ > 5.5 -> HOLD MRA/finerenone and ARNI; urgent recheck', () => {
    render(<TitrationDecisionTable />);
    expect(screen.getByText('HOLD MRA/finerenone and ARNI; urgent recheck; dietary counseling')).toBeInTheDocument();
  });

  it('row 7: Cr increase > 30% -> HOLD ARNI/MRA; evaluate; cardiology consult', () => {
    render(<TitrationDecisionTable />);
    expect(screen.getByText('HOLD ARNI/MRA; evaluate; cardiology consult')).toBeInTheDocument();
  });

  it('highlights row matching the provided vitals context', () => {
    const { container } = render(
      <TitrationDecisionTable highlightVitals={{ sbp: 120, hr: 70, potassium: 4.0, creatinine: 1.0 }} />
    );
    // Row 0 (SBP >= 100 AND asymptomatic) should be highlighted
    const highlightedRows = container.querySelectorAll('.bg-yellow-50');
    expect(highlightedRows.length).toBeGreaterThanOrEqual(1);
  });
});
