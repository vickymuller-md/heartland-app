import { describe, it, expect } from 'vitest';
import { calculateRiskScore, classifyTier } from '@/lib/risk-score/engine';
import type { RiskInput } from '@/lib/risk-score/types';

const ALL_FALSE: RiskInput = {
  ageOver75: false,
  priorHfHospitalization: false,
  egfrBelow45: false,
  elevatedNatriuretic: false,
  sbpBelow100: false,
  diabetes: false,
  lvefBelow30: false,
  ckmStage3or4: false,
  distanceOver50Miles: false,
  livesAloneOrLimitedSupport: false,
};

const ALL_TRUE: RiskInput = {
  ageOver75: true,
  priorHfHospitalization: true,
  egfrBelow45: true,
  elevatedNatriuretic: true,
  sbpBelow100: true,
  diabetes: true,
  lvefBelow30: true,
  ckmStage3or4: true,
  distanceOver50Miles: true,
  livesAloneOrLimitedSupport: true,
};

// =========================================================================
// classifyTier — tier boundary tests (RISK-02)
// clinical_content.md: 0-4 = Low, 5-8 = Moderate, >=9 = High
// =========================================================================
describe('classifyTier', () => {
  it('returns low for score 0', () => {
    expect(classifyTier(0)).toBe('low');
  });

  it('returns low for score 4 (upper boundary)', () => {
    expect(classifyTier(4)).toBe('low');
  });

  it('returns moderate for score 5 (lower boundary)', () => {
    expect(classifyTier(5)).toBe('moderate');
  });

  it('returns moderate for score 8 (upper boundary)', () => {
    expect(classifyTier(8)).toBe('moderate');
  });

  it('returns high for score 9 (lower boundary)', () => {
    expect(classifyTier(9)).toBe('high');
  });

  it('returns high for score 18 (maximum)', () => {
    expect(classifyTier(18)).toBe('high');
  });
});

// =========================================================================
// calculateRiskScore — individual point values (RISK-01)
// clinical_content.md Table 1: 10 variables, maximum 18 points
// =========================================================================
describe('calculateRiskScore - point values (RISK-01)', () => {
  // clinical_content.md Table 1: Age >= 75 years -> +2
  it('assigns +2 for age >= 75', () => {
    const result = calculateRiskScore({ ...ALL_FALSE, ageOver75: true });
    expect(result.totalScore).toBe(2);
  });

  // clinical_content.md Table 1: Prior HF hospitalization within 6 months -> +3
  it('assigns +3 for prior HF hospitalization within 6 months', () => {
    const result = calculateRiskScore({ ...ALL_FALSE, priorHfHospitalization: true });
    expect(result.totalScore).toBe(3);
  });

  // clinical_content.md Table 1: eGFR < 45 mL/min/1.73m2 -> +2
  it('assigns +2 for eGFR < 45', () => {
    const result = calculateRiskScore({ ...ALL_FALSE, egfrBelow45: true });
    expect(result.totalScore).toBe(2);
  });

  // clinical_content.md Table 1: BNP >= 500 pg/mL or NT-proBNP >= 1500 pg/mL -> +2
  it('assigns +2 for BNP >= 500 / NT-proBNP >= 1500', () => {
    const result = calculateRiskScore({ ...ALL_FALSE, elevatedNatriuretic: true });
    expect(result.totalScore).toBe(2);
  });

  // clinical_content.md Table 1: SBP < 100 mmHg at admission -> +2
  it('assigns +2 for SBP < 100', () => {
    const result = calculateRiskScore({ ...ALL_FALSE, sbpBelow100: true });
    expect(result.totalScore).toBe(2);
  });

  // clinical_content.md Table 1: Diabetes mellitus -> +1
  it('assigns +1 for diabetes', () => {
    const result = calculateRiskScore({ ...ALL_FALSE, diabetes: true });
    expect(result.totalScore).toBe(1);
  });

  // clinical_content.md Table 1: LVEF < 30% -> +2
  it('assigns +2 for LVEF < 30%', () => {
    const result = calculateRiskScore({ ...ALL_FALSE, lvefBelow30: true });
    expect(result.totalScore).toBe(2);
  });

  // clinical_content.md Table 1: CKM Stage 3 or 4 -> +2
  it('assigns +2 for CKM Stage 3 or 4', () => {
    const result = calculateRiskScore({ ...ALL_FALSE, ckmStage3or4: true });
    expect(result.totalScore).toBe(2);
  });

  // clinical_content.md Table 1: Distance to cardiology care > 50 miles -> +1
  it('assigns +1 for distance to cardiology > 50 miles', () => {
    const result = calculateRiskScore({ ...ALL_FALSE, distanceOver50Miles: true });
    expect(result.totalScore).toBe(1);
  });

  // clinical_content.md Table 1: Lives alone or limited social support -> +1
  it('assigns +1 for lives alone or limited social support', () => {
    const result = calculateRiskScore({ ...ALL_FALSE, livesAloneOrLimitedSupport: true });
    expect(result.totalScore).toBe(1);
  });
});

// =========================================================================
// calculateRiskScore — total score and tier (RISK-02)
// =========================================================================
describe('calculateRiskScore - total and tier (RISK-02)', () => {
  it('returns 0 and low tier for all-false input', () => {
    const result = calculateRiskScore(ALL_FALSE);
    expect(result.totalScore).toBe(0);
    expect(result.tier).toBe('low');
    expect(result.tierLabel).toBe('Low');
  });

  it('returns 18 and high tier for all-true input', () => {
    const result = calculateRiskScore(ALL_TRUE);
    expect(result.totalScore).toBe(18);
    expect(result.tier).toBe('high');
    expect(result.tierLabel).toBe('High');
  });

  it('maxScore is always 18', () => {
    expect(calculateRiskScore(ALL_FALSE).maxScore).toBe(18);
    expect(calculateRiskScore(ALL_TRUE).maxScore).toBe(18);
  });

  // age(+2) + diabetes(+1) + distance(+1) + support(+1) = 5 -> moderate
  it('returns moderate tier for typical scenario: age + diabetes + distance + support = 5', () => {
    const result = calculateRiskScore({
      ...ALL_FALSE,
      ageOver75: true,
      diabetes: true,
      distanceOver50Miles: true,
      livesAloneOrLimitedSupport: true,
    });
    expect(result.totalScore).toBe(5);
    expect(result.tier).toBe('moderate');
  });

  // priorHfHosp(+3) + eGFR(+2) + BNP(+2) + LVEF(+2) = 9 -> high
  it('returns high tier for severe scenario: prior HF hosp + eGFR + BNP + LVEF = 9', () => {
    const result = calculateRiskScore({
      ...ALL_FALSE,
      priorHfHospitalization: true,
      egfrBelow45: true,
      elevatedNatriuretic: true,
      lvefBelow30: true,
    });
    expect(result.totalScore).toBe(9);
    expect(result.tier).toBe('high');
  });

  it('provides breakdown array with 10 entries', () => {
    const result = calculateRiskScore(ALL_FALSE);
    expect(result.breakdown).toHaveLength(10);
  });

  it('breakdown entries show present=true and points > 0 for enabled variables', () => {
    const result = calculateRiskScore({ ...ALL_FALSE, diabetes: true });
    const diabetesEntry = result.breakdown.find((b) => b.variable.includes('Diabetes'));
    expect(diabetesEntry).toBeDefined();
    expect(diabetesEntry!.present).toBe(true);
    expect(diabetesEntry!.points).toBe(1);
  });

  it('breakdown entries show present=false and points=0 for disabled variables', () => {
    const result = calculateRiskScore(ALL_FALSE);
    result.breakdown.forEach((entry) => {
      expect(entry.present).toBe(false);
      expect(entry.points).toBe(0);
    });
  });
});

// =========================================================================
// calculateRiskScore — care pathways (RISK-03)
// clinical_content.md: Score interpretation with follow-up timing per tier
// =========================================================================
describe('calculateRiskScore - care pathway (RISK-03)', () => {
  // clinical_content.md: LOW -> Standard discharge; PCP follow-up within 14 days; Basic self-monitoring
  it('low tier provides care pathway with 14-day PCP follow-up', () => {
    const result = calculateRiskScore(ALL_FALSE);
    expect(result.carePathway.tier).toBe('low');
    expect(result.carePathway.followUp).toContain('14 days');
    expect(result.carePathway.monitoring).toContain('self-monitoring');
  });

  // clinical_content.md: MODERATE -> Enhanced bundle; PCP follow-up within 7 days; 72h telehealth check
  it('moderate tier provides care pathway with 7-day PCP follow-up and 72h telehealth', () => {
    const result = calculateRiskScore({
      ...ALL_FALSE,
      ageOver75: true,
      diabetes: true,
      distanceOver50Miles: true,
      livesAloneOrLimitedSupport: true,
    });
    expect(result.carePathway.tier).toBe('moderate');
    expect(result.carePathway.followUp).toContain('7 days');
    expect(result.carePathway.followUp).toContain('72');
  });

  // clinical_content.md: HIGH -> Intensive bundle; Cardiology input before discharge; 48h phone follow-up
  it('high tier provides care pathway with cardiology input and 48h phone follow-up', () => {
    const result = calculateRiskScore(ALL_TRUE);
    expect(result.carePathway.tier).toBe('high');
    expect(result.carePathway.followUp).toContain('Cardiology');
    expect(result.carePathway.followUp).toContain('48');
  });
});

// =========================================================================
// calculateRiskScore — purity (RISK-05)
// =========================================================================
describe('calculateRiskScore - offline purity (RISK-05)', () => {
  it('is a pure function with no async operations', () => {
    // calculateRiskScore is synchronous - returns a value, not a Promise
    const result = calculateRiskScore(ALL_FALSE);
    expect(result).toBeDefined();
    expect(result).not.toBeInstanceOf(Promise);
  });

  it('returns the same result for the same input (deterministic)', () => {
    const result1 = calculateRiskScore(ALL_FALSE);
    const result2 = calculateRiskScore(ALL_FALSE);
    expect(result1).toEqual(result2);
  });
});
