/**
 * Quality Metrics Utility Tests -- CKM-02
 * Requirements: CKM-02 (formatRate, evaluateTarget)
 * Source: HEARTLAND Protocol v3.3 Module 8 Quality Metrics
 *
 * Tests formatRate (percentage formatting with null/zero guards)
 * and evaluateTarget (met/approaching/below/no_data classification).
 */

import { formatRate, evaluateTarget } from '@/lib/quality-metrics/utils';

import { describe, it, expect } from 'vitest';

describe('CKM-02 formatRate', () => {
  it('formatRate(9, 12) returns "75.0%"', () => {
    expect(formatRate(9, 12)).toBe('75.0%');
  });

  it('formatRate(null, 12) returns null', () => {
    expect(formatRate(null, 12)).toBeNull();
  });

  it('formatRate(9, 0) returns null (division-by-zero guard)', () => {
    expect(formatRate(9, 0)).toBeNull();
  });

  it('formatRate(9, null) returns null', () => {
    expect(formatRate(9, null)).toBeNull();
  });
});

describe('CKM-02 evaluateTarget (higherIsBetter=true)', () => {
  it('evaluateTarget(80, 70, true) returns "met" (rate >= target)', () => {
    expect(evaluateTarget(80, 70, true)).toBe('met');
  });

  it('evaluateTarget(65, 70, true) returns "approaching" (within 10% margin: 63 <= 65 < 70)', () => {
    expect(evaluateTarget(65, 70, true)).toBe('approaching');
  });

  it('evaluateTarget(50, 70, true) returns "below"', () => {
    expect(evaluateTarget(50, 70, true)).toBe('below');
  });
});

describe('CKM-02 evaluateTarget (higherIsBetter=false)', () => {
  it('evaluateTarget(12, 15, false) returns "met" (lower is better, rate <= target)', () => {
    expect(evaluateTarget(12, 15, false)).toBe('met');
  });

  it('evaluateTarget(16, 15, false) returns "approaching"', () => {
    expect(evaluateTarget(16, 15, false)).toBe('approaching');
  });

  it('evaluateTarget(25, 15, false) returns "below"', () => {
    expect(evaluateTarget(25, 15, false)).toBe('below');
  });
});

describe('CKM-02 evaluateTarget (no_data cases)', () => {
  it('evaluateTarget(null, 70, true) returns "no_data"', () => {
    expect(evaluateTarget(null, 70, true)).toBe('no_data');
  });

  it('evaluateTarget(80, null, true) returns "no_data"', () => {
    expect(evaluateTarget(80, null, true)).toBe('no_data');
  });
});
