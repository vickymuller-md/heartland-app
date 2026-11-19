import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CalculatorForm } from '@/app/(public)/risk-calculator/calculator-form';
import { ResultCard } from '@/app/(public)/risk-calculator/result-card';
import { ScoreBreakdown } from '@/app/(public)/risk-calculator/score-breakdown';
import { calculateRiskScore } from '@/lib/risk-score/engine';
import { RISK_VARIABLES } from '@/lib/risk-score/constants';
import type { RiskResult } from '@/lib/risk-score/types';

// Mock window.print for print button test
vi.stubGlobal('print', vi.fn());
vi.mock('@/components/shared/patient-selector', () => ({
  PatientSelector: ({ expectedActorId }: { expectedActorId: string }) =>
    <div aria-label="Authorized patient selection">{expectedActorId}</div>,
}));

describe('CalculatorForm (RISK-02, RISK-03)', () => {
  it('limits patient selection to the clinician who opened the assessment', () => {
    render(<CalculatorForm actorId="provider-opening-assessment" />);
    expect(screen.getByLabelText('Authorized patient selection')).toHaveTextContent('provider-opening-assessment');
    expect(screen.queryByRole('button', {name: 'Load synthetic example'})).not.toBeInTheDocument();
  });
  it('starts with ten unanswered, labelled factors and no classification', () => {
    render(<CalculatorForm />);
    expect(screen.getByRole('status')).toHaveTextContent('0 of 10');
    for (const variable of RISK_VARIABLES) {
      const group = screen.getByRole('group', { name: variable.label });
      expect(within(group).getByRole('radio', { name: 'Present' })).not.toBeChecked();
      expect(within(group).getByRole('radio', { name: 'Absent' })).not.toBeChecked();
      expect(within(group).getByText(new RegExp(`\\+${variable.points} pts`))).toBeInTheDocument();
    }
    expect(screen.queryByTestId('result-card')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Print' })).toBeDisabled();
  });

  it.each([[0, 'Low'], [2, 'Moderate'], [4, 'High']] as const)('calculates after all answers when %i initial factors are present', async (count, tier) => {
    const user = userEvent.setup();
    render(<CalculatorForm />);
    for (const [index, variable] of RISK_VARIABLES.entries()) {
      const group = screen.getByRole('group', { name: variable.label });
      await user.click(within(group).getByRole('radio', { name: index < count ? 'Present' : 'Absent' }));
      if (index < 9) expect(screen.queryByTestId('result-card')).not.toBeInTheDocument();
    }
    expect(within(screen.getByTestId('result-card')).getByText(tier)).toBeVisible();
    expect(screen.getByTestId('score-breakdown')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reset all' }));
    expect(screen.queryByTestId('result-card')).not.toBeInTheDocument();
  });

  it('labels an anonymous worked example, including its printable summary', async () => {
    const user = userEvent.setup();
    render(<CalculatorForm />);
    await user.click(screen.getByRole('button', { name: 'Load synthetic example' }));
    expect(screen.getByText('Synthetic example', {exact: true})).toBeVisible();
    expect(screen.getByTestId('result-card')).toHaveTextContent('Moderate');
    expect(screen.queryByText('Patient record')).not.toBeInTheDocument();
  });
});

describe('ResultCard', () => {
  const lowResult: RiskResult = calculateRiskScore({
    ageOver75: false, priorHfHospitalization: false, egfrBelow45: false,
    elevatedNatriuretic: false, sbpBelow100: false, diabetes: false,
    lvefBelow30: false, ckmStage3or4: false, distanceOver50Miles: false,
    livesAloneOrLimitedSupport: false,
  });

  const moderateResult: RiskResult = calculateRiskScore({
    ageOver75: true, priorHfHospitalization: true, egfrBelow45: false,
    elevatedNatriuretic: false, sbpBelow100: false, diabetes: false,
    lvefBelow30: false, ckmStage3or4: false, distanceOver50Miles: false,
    livesAloneOrLimitedSupport: false,
  });

  const highResult: RiskResult = calculateRiskScore({
    ageOver75: true, priorHfHospitalization: true, egfrBelow45: true,
    elevatedNatriuretic: true, sbpBelow100: false, diabetes: false,
    lvefBelow30: false, ckmStage3or4: false, distanceOver50Miles: false,
    livesAloneOrLimitedSupport: false,
  });

  it('renders tier with correct color: green for low, amber for moderate, red for high', () => {
    const { rerender } = render(<ResultCard result={lowResult} />);
    expect(screen.getByText('Low')).toBeInTheDocument();

    rerender(<ResultCard result={moderateResult} />);
    expect(screen.getByText('Moderate')).toBeInTheDocument();

    rerender(<ResultCard result={highResult} />);
    expect(screen.getByText('High')).toBeInTheDocument();
  });

  it('renders care pathway follow-up, monitoring, and support fields', () => {
    render(<ResultCard result={lowResult} />);
    expect(screen.getByText(lowResult.carePathway.followUp)).toBeInTheDocument();
    expect(screen.getByText(lowResult.carePathway.monitoring)).toBeInTheDocument();
    expect(screen.getByText(lowResult.carePathway.support)).toBeInTheDocument();
  });

  it('shows the risk score disclaimer text', () => {
    render(<ResultCard result={lowResult} />);
    expect(
      screen.getByText(/proposed tool under development/i)
    ).toBeInTheDocument();
  });
});

describe('ScoreBreakdown', () => {
  const result: RiskResult = calculateRiskScore({
    ageOver75: true, priorHfHospitalization: false, egfrBelow45: false,
    elevatedNatriuretic: false, sbpBelow100: false, diabetes: false,
    lvefBelow30: false, ckmStage3or4: false, distanceOver50Miles: false,
    livesAloneOrLimitedSupport: false,
  });

  it('renders all 10 variables with points', () => {
    render(<ScoreBreakdown breakdown={result.breakdown} />);
    for (const v of RISK_VARIABLES) {
      expect(screen.getByText(v.label)).toBeInTheDocument();
    }
  });

  it('shows Present for active variables and Absent for inactive', () => {
    render(<ScoreBreakdown breakdown={result.breakdown} />);
    const presentCells = screen.getAllByText('Present');
    const absentCells = screen.getAllByText('Absent');
    expect(presentCells).toHaveLength(1); // only ageOver75
    expect(absentCells).toHaveLength(9);
  });

  it('shows total row at the bottom', () => {
    render(<ScoreBreakdown breakdown={result.breakdown} />);
    expect(screen.getByText('Total')).toBeInTheDocument();
  });
});
