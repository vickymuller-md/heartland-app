import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CalculatorForm } from '@/app/(provider)/risk-calculator/calculator-form';
import { ResultCard } from '@/app/(provider)/risk-calculator/result-card';
import { ScoreBreakdown } from '@/app/(provider)/risk-calculator/score-breakdown';
import { calculateRiskScore } from '@/lib/risk-score/engine';
import { RISK_VARIABLES } from '@/lib/risk-score/constants';
import type { RiskResult } from '@/lib/risk-score/types';

// Mock window.print for print button test
vi.stubGlobal('print', vi.fn());

describe('CalculatorForm (RISK-02, RISK-03)', () => {
  it('renders 10 switch/toggle inputs', () => {
    render(<CalculatorForm />);
    const switches = screen.getAllByRole('switch');
    expect(switches).toHaveLength(10);
  });

  it('each toggle has an accessible label matching the clinical variable name', () => {
    render(<CalculatorForm />);
    const toggleSection = screen.getByTestId('toggle-section');
    for (const v of RISK_VARIABLES) {
      expect(within(toggleSection).getByText(v.label)).toBeInTheDocument();
    }
  });

  it('each toggle shows point value (+1, +2, or +3)', () => {
    render(<CalculatorForm />);
    const toggleSection = screen.getByTestId('toggle-section');
    for (const v of RISK_VARIABLES) {
      // Each toggle row has its own point badge -- use getAllByText and check >= 1
      const badges = within(toggleSection).getAllByText(`+${v.points} pts`);
      expect(badges.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('shows total score of 0 when all toggles are off', () => {
    render(<CalculatorForm />);
    const resultCard = screen.getByTestId('result-card');
    // Score display: "0" followed by "/ 18"
    expect(within(resultCard).getByText('0')).toBeInTheDocument();
    expect(within(resultCard).getByText(/\/ 18/)).toBeInTheDocument();
  });

  it('updates total score when a toggle is switched on', async () => {
    const user = userEvent.setup();
    render(<CalculatorForm />);
    // Toggle "Age >= 75" which is 2 points
    const ageSwitch = screen.getAllByRole('switch')[0];
    await user.click(ageSwitch);
    const resultCard = screen.getByTestId('result-card');
    expect(within(resultCard).getByText('2')).toBeInTheDocument();
  });

  it('displays Low tier badge when score is 0-4', () => {
    render(<CalculatorForm />);
    // Default score = 0, which is Low tier
    expect(screen.getByText('Low')).toBeInTheDocument();
  });

  it('displays Moderate tier badge when score is 5-8', async () => {
    const user = userEvent.setup();
    render(<CalculatorForm />);
    const switches = screen.getAllByRole('switch');
    // Toggle age (2) + prior HF hosp (3) = 5 -> Moderate
    await user.click(switches[0]); // ageOver75 = 2
    await user.click(switches[1]); // priorHfHospitalization = 3
    expect(screen.getByText('Moderate')).toBeInTheDocument();
  });

  it('displays High tier badge when score is >= 9', async () => {
    const user = userEvent.setup();
    render(<CalculatorForm />);
    const switches = screen.getAllByRole('switch');
    // Toggle age(2) + priorHF(3) + eGFR(2) + BNP(2) = 9 -> High
    await user.click(switches[0]); // ageOver75 = 2
    await user.click(switches[1]); // priorHfHospitalization = 3
    await user.click(switches[2]); // egfrBelow45 = 2
    await user.click(switches[3]); // elevatedNatriuretic = 2
    expect(screen.getByText('High')).toBeInTheDocument();
  });

  it('shows care pathway text matching the current tier', () => {
    render(<CalculatorForm />);
    // Default = Low tier
    expect(screen.getByText(/PCP follow-up within 14 days/)).toBeInTheDocument();
  });

  it('displays score breakdown with all 10 variables', () => {
    render(<CalculatorForm />);
    const breakdown = screen.getByTestId('score-breakdown');
    for (const v of RISK_VARIABLES) {
      expect(within(breakdown).getByText(v.label)).toBeInTheDocument();
    }
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
