/**
 * CKM Stage Engine Tests -- CKM-01
 * Requirements: CKM-01 (CKM Stage calculator 0-4)
 * Source: reference/clinical_content.md 1.1 -- AHA 2023 Presidential Advisory
 *
 * Tests classifyCkmStage() pure function with all input combinations.
 */

import { classifyCkmStage } from '@/lib/ckm/engine';

import { describe, it, expect } from 'vitest';

describe('CKM-01 classifyCkmStage', () => {
  it('Stage 0: all inputs false -> returns 0', () => {
    expect(
      classifyCkmStage({
        excessAdiposity: false,
        metabolicRisk: false,
        subclinicalCvd: false,
        clinicalCvd: false,
      })
    ).toBe(0);
  });

  it('Stage 1: excessAdiposity true, rest false -> returns 1', () => {
    expect(
      classifyCkmStage({
        excessAdiposity: true,
        metabolicRisk: false,
        subclinicalCvd: false,
        clinicalCvd: false,
      })
    ).toBe(1);
  });

  it('Stage 2: metabolicRisk true, rest false -> returns 2', () => {
    expect(
      classifyCkmStage({
        excessAdiposity: false,
        metabolicRisk: true,
        subclinicalCvd: false,
        clinicalCvd: false,
      })
    ).toBe(2);
  });

  it('Stage 3: subclinicalCvd true, clinicalCvd false -> returns 3', () => {
    expect(
      classifyCkmStage({
        excessAdiposity: false,
        metabolicRisk: false,
        subclinicalCvd: true,
        clinicalCvd: false,
      })
    ).toBe(3);
  });

  it('Stage 4: clinicalCvd true -> returns 4 regardless of other inputs', () => {
    expect(
      classifyCkmStage({
        excessAdiposity: true,
        metabolicRisk: true,
        subclinicalCvd: true,
        clinicalCvd: true,
      })
    ).toBe(4);
  });

  it('Priority: clinicalCvd=true overrides subclinicalCvd=true -> returns 4', () => {
    expect(
      classifyCkmStage({
        excessAdiposity: false,
        metabolicRisk: false,
        subclinicalCvd: true,
        clinicalCvd: true,
      })
    ).toBe(4);
  });
});
