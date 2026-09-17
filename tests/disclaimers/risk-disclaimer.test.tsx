import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  RiskScoreDisclaimer,
  RiskTierDisclaimer,
} from '@/components/disclaimers/risk-score-disclaimer';
import { PatientDirectory } from '@/app/(provider)/patients/_components/patient-directory';
import { WorklistTable } from '@/app/(provider)/titration-worklist/_components/worklist-table';

// ==========================================================================
// DISC-02: Risk Score Disclaimer -- Alert component with AlertTriangle
// Verbatim text from reference/app_statement.md Risk Score Disclaimer
// ==========================================================================
describe('RiskScoreDisclaimer (DISC-02)', () => {
  it('renders risk score disclaimer with warning styling', () => {
    render(<RiskScoreDisclaimer />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('disclaimer text includes "pragmatic heuristic"', () => {
    render(<RiskScoreDisclaimer />);
    expect(
      screen.getByText(/pragmatic heuristic/i),
    ).toBeInTheDocument();
  });

  it('disclaimer text includes "not been statistically validated"', () => {
    render(<RiskScoreDisclaimer />);
    expect(
      screen.getByText(/not been statistically validated/i),
    ).toBeInTheDocument();
  });

  it('renders AlertTriangle icon', () => {
    const { container } = render(<RiskScoreDisclaimer />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });
});

// ==========================================================================
// One-line caveat for surfaces that show a stored tier without room for the
// full disclaimer: patient directory, titration worklist, printed summary.
// ==========================================================================
describe('RiskTierDisclaimer', () => {
  it('names the tier as a proposed, non-validated heuristic and not a prediction', () => {
    render(<RiskTierDisclaimer />);
    const note = screen.getByRole('note');
    expect(note).toHaveTextContent(/proposed, non-validated heuristic/i);
    expect(note).toHaveTextContent(/not a prediction of events/i);
  });

  it('stays visible when printed', () => {
    render(<RiskTierDisclaimer />);
    expect(screen.getByRole('note').className).not.toContain('print:hidden');
  });
});

describe('PatientDirectory risk tier caveat', () => {
  const patient = {
    id: 'p1',
    code: 'HL-001',
    full_name: 'Alice Green',
    email: 'a•••@example.com',
    phone: '•••-•••-1234',
    risk_tier: 'high',
    track_assignment: 'A',
    facility_tier: 1,
    linked_at: null,
  };

  it('carries the caveat when a tier chip is shown', () => {
    render(<PatientDirectory patients={[patient]} query="" total={1} page={1} pageSize={25} />);
    expect(screen.getByRole('note')).toHaveTextContent(/proposed, non-validated heuristic/i);
  });

  it('omits the caveat when no listed patient has a tier', () => {
    render(
      <PatientDirectory
        patients={[{ ...patient, risk_tier: null }]}
        query=""
        total={1}
        page={1}
        pageSize={25}
      />
    );
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });
});

describe('WorklistTable risk tier caveat', () => {
  it('carries the caveat under the Risk column', () => {
    render(
      <WorklistTable
        rows={[
          {
            patient_id: 'p1',
            full_name: 'Alice Green',
            risk_tier: 'high',
            last_sbp: 118,
            last_k: 4.2,
            last_cr: 1.1,
            last_labs_at: '2026-09-01T10:00:00Z',
            last_titration_at: null,
            due_this_week: true,
          },
        ]}
      />
    );
    expect(screen.getByRole('note')).toHaveTextContent(/proposed, non-validated heuristic/i);
  });
});
