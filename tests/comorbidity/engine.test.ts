import { describe, it, expect } from 'vitest';
import {
  evaluateReferralCriteria,
  evaluateDeviceCriteria,
} from '@/lib/comorbidity/engine';

describe('evaluateReferralCriteria (COMR-04)', () => {
  it('returns refer when LVEF<=35, gdmtDuration>=3, hospitalizations>=2', () => {
    const result = evaluateReferralCriteria({
      lvef: 30,
      gdmtDurationMonths: 4,
      hfHospitalizationsLast12m: 3,
    });
    expect(result.result).toBe('refer');
    expect(result.gateMet).toBe(true);
  });

  it('returns monitor when LVEF=40 (gate not met)', () => {
    const result = evaluateReferralCriteria({
      lvef: 40,
      gdmtDurationMonths: 6,
      hfHospitalizationsLast12m: 3,
    });
    expect(result.result).toBe('monitor');
    expect(result.gateMet).toBe(false);
  });

  it('returns monitor when LVEF<=35 but gdmtDuration=2 (gate not met)', () => {
    const result = evaluateReferralCriteria({
      lvef: 35,
      gdmtDurationMonths: 2,
      hfHospitalizationsLast12m: 3,
    });
    expect(result.result).toBe('monitor');
    expect(result.gateMet).toBe(false);
  });

  it('returns monitor when LVEF<=35 and gdmtDuration>=3 but hospitalizations=1', () => {
    const result = evaluateReferralCriteria({
      lvef: 30,
      gdmtDurationMonths: 3,
      hfHospitalizationsLast12m: 1,
    });
    expect(result.result).toBe('monitor');
    expect(result.gateMet).toBe(false);
  });

  it('returns insufficient_data when any input is null', () => {
    expect(
      evaluateReferralCriteria({
        lvef: null,
        gdmtDurationMonths: 3,
        hfHospitalizationsLast12m: 2,
      }).result,
    ).toBe('insufficient_data');
    expect(
      evaluateReferralCriteria({
        lvef: 30,
        gdmtDurationMonths: null,
        hfHospitalizationsLast12m: 2,
      }).result,
    ).toBe('insufficient_data');
    expect(
      evaluateReferralCriteria({
        lvef: 30,
        gdmtDurationMonths: 3,
        hfHospitalizationsLast12m: null,
      }).result,
    ).toBe('insufficient_data');
  });

  it('gateMet is true only when all 3 criteria simultaneously met', () => {
    const result = evaluateReferralCriteria({
      lvef: 35,
      gdmtDurationMonths: 3,
      hfHospitalizationsLast12m: 2,
    });
    expect(result.result).toBe('refer');
    expect(result.gateMet).toBe(true);
  });

  it('additionalCriteria array is non-empty even when gate not met', () => {
    const result = evaluateReferralCriteria({
      lvef: 40,
      gdmtDurationMonths: 6,
      hfHospitalizationsLast12m: 3,
    });
    expect(result.additionalCriteria.length).toBeGreaterThan(0);
  });
});

describe('evaluateDeviceCriteria (COMR-05)', () => {
  it('returns crt_candidate when LVEF<=35 + LBBB + QRS>=150 + gdmtDuration>=3', () => {
    const result = evaluateDeviceCriteria({
      lvef: 30,
      lbbb: true,
      qrsMs: 150,
      gdmtDurationMonths: 4,
    });
    expect(result.result).toBe('crt_candidate');
  });

  it('returns possible_crt when LVEF<=35 + QRS 130-149 + gdmtDuration>=3', () => {
    const result = evaluateDeviceCriteria({
      lvef: 30,
      lbbb: false,
      qrsMs: 139,
      gdmtDurationMonths: 4,
    });
    expect(result.result).toBe('possible_crt');
  });

  it('returns icd_only when LVEF<=35 + no LBBB + QRS<130 + gdmtDuration>=3', () => {
    const result = evaluateDeviceCriteria({
      lvef: 30,
      lbbb: false,
      qrsMs: 120,
      gdmtDurationMonths: 4,
    });
    expect(result.result).toBe('icd_only');
  });

  it('returns monitor when LVEF=40 (threshold not met)', () => {
    const result = evaluateDeviceCriteria({
      lvef: 40,
      lbbb: true,
      qrsMs: 160,
      gdmtDurationMonths: 6,
    });
    expect(result.result).toBe('monitor');
  });

  it('returns monitor when LVEF<=35 but gdmtDuration<3', () => {
    const result = evaluateDeviceCriteria({
      lvef: 30,
      lbbb: true,
      qrsMs: 160,
      gdmtDurationMonths: 2,
    });
    expect(result.result).toBe('monitor');
  });

  it('returns insufficient_data when lvef is null', () => {
    const result = evaluateDeviceCriteria({
      lvef: null,
      lbbb: true,
      qrsMs: 150,
      gdmtDurationMonths: 4,
    });
    expect(result.result).toBe('insufficient_data');
  });

  it('returns insufficient_data when qrsMs is null', () => {
    const result = evaluateDeviceCriteria({
      lvef: 30,
      lbbb: true,
      qrsMs: null,
      gdmtDurationMonths: 4,
    });
    expect(result.result).toBe('insufficient_data');
  });

  it('returns insufficient_data when gdmtDurationMonths is null', () => {
    const result = evaluateDeviceCriteria({
      lvef: 30,
      lbbb: true,
      qrsMs: 150,
      gdmtDurationMonths: null,
    });
    expect(result.result).toBe('insufficient_data');
  });
});
