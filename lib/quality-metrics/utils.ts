/**
 * Quality Metrics -- Pure Utility Functions
 *
 * formatRate: percentage formatting with null/zero guards
 * evaluateTarget: target status classification (met/approaching/below/no_data)
 */

export type TargetStatus = 'met' | 'approaching' | 'below' | 'no_data';

/**
 * Format numerator/denominator as a percentage string.
 * Returns null if either value is null or denominator is zero.
 */
export function formatRate(
  numerator: number | null,
  denominator: number | null,
): string | null {
  if (numerator == null || denominator == null || denominator === 0) {
    return null;
  }
  return ((numerator / denominator) * 100).toFixed(1) + '%';
}

/**
 * Evaluate a rate against a target threshold.
 *
 * "approaching" = within 10% margin of target:
 *   - higherIsBetter: rate >= target * 0.9 && rate < target
 *   - !higherIsBetter: rate > target && rate <= target * 1.1
 *
 * Returns 'no_data' if rate or target is null.
 */
export function evaluateTarget(
  rate: number | null,
  target: number | null,
  higherIsBetter: boolean,
): TargetStatus {
  if (rate == null || target == null) return 'no_data';

  if (higherIsBetter) {
    if (rate >= target) return 'met';
    if (rate >= target * 0.9) return 'approaching';
    return 'below';
  } else {
    // Lower is better (e.g., readmission rate)
    if (rate <= target) return 'met';
    if (rate <= target * 1.1) return 'approaching';
    return 'below';
  }
}
