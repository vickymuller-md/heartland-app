/**
 * Bitmask Setup State Helpers -- Tests
 * Requirements: ONBD-03, ONBD-04
 * Source: HEARTLAND Protocol v3.3 -- Phase 20 Patient Onboarding Wizard
 *
 * Tests bitmask utility functions for tracking completed onboarding steps.
 * Each of the 5 wizard steps corresponds to a bit (1, 2, 4, 8, 16).
 * ALL_STEPS_COMPLETE = 31 (binary 11111).
 */

import { describe, it, expect } from 'vitest';
import { markStep, isStepComplete, ALL_STEPS_COMPLETE } from '@/lib/onboarding/constants';

describe('markStep', () => {
  it('sets bit 1 on zero', () => {
    expect(markStep(0, 1)).toBe(1);
  });

  it('sets bit 2 on top of bit 1', () => {
    expect(markStep(1, 2)).toBe(3);
  });

  it('produces ALL_STEPS_COMPLETE when all bits set', () => {
    let result = 0;
    result = markStep(result, 1);
    result = markStep(result, 2);
    result = markStep(result, 4);
    result = markStep(result, 8);
    result = markStep(result, 16);
    expect(result).toBe(ALL_STEPS_COMPLETE);
  });
});

describe('isStepComplete', () => {
  it('returns true when bit 4 is set in 7 (binary 111)', () => {
    expect(isStepComplete(7, 4)).toBe(true);
  });

  it('returns false when bit 2 is not set in 5 (binary 101)', () => {
    expect(isStepComplete(5, 2)).toBe(false);
  });

  it('returns true for bit 16 when ALL_STEPS_COMPLETE', () => {
    expect(isStepComplete(ALL_STEPS_COMPLETE, 16)).toBe(true);
  });
});

describe('ALL_STEPS_COMPLETE', () => {
  it('equals 31 (1+2+4+8+16, all 5 bits set)', () => {
    expect(ALL_STEPS_COMPLETE).toBe(31);
  });
});
