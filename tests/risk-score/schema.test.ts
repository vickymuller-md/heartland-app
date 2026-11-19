import { describe, it, expect } from 'vitest';
import { riskInputSchema } from '@/lib/risk-score/schema';

describe('riskInputSchema (RISK-01)', () => {
  // clinical_content.md Table 1: 10 binary clinical variables
  it('accepts object with all 10 boolean fields', () => {
    const input = {
      ageOver75: true,
      priorHfHospitalization: false,
      egfrBelow45: true,
      elevatedNatriuretic: false,
      sbpBelow100: true,
      diabetes: false,
      lvefBelow30: true,
      ckmStage3or4: false,
      distanceOver50Miles: true,
      livesAloneOrLimitedSupport: false,
    };
    const result = riskInputSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('rejects missing factors without assigning a negative answer', () => {
    expect(riskInputSchema.safeParse({}).success).toBe(false);
  });

  it('rejects non-boolean values for each field', () => {
    const invalidInputs = [
      { ageOver75: 'yes' },
      { diabetes: 1 },
      { lvefBelow30: null },
      { distanceOver50Miles: undefined, ageOver75: 'true' },
    ];
    for (const input of invalidInputs) {
      const result = riskInputSchema.safeParse(input);
      expect(result.success).toBe(false);
    }
  });

  it('has exactly 10 fields matching RiskInput interface', () => {
    const expectedKeys = [
      'ageOver75',
      'priorHfHospitalization',
      'egfrBelow45',
      'elevatedNatriuretic',
      'sbpBelow100',
      'diabetes',
      'lvefBelow30',
      'ckmStage3or4',
      'distanceOver50Miles',
      'livesAloneOrLimitedSupport',
    ];
    const schemaKeys = Object.keys(riskInputSchema.shape);
    expect(schemaKeys).toHaveLength(10);
    expect(schemaKeys.sort()).toEqual(expectedKeys.sort());
  });
});
