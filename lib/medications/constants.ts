/**
 * HEARTLAND Medication Tracking -- Constants
 *
 * Frequency options, timing presets, and dose count mapping.
 * Used by forms and adherence calculation.
 */

import type { MedicationFrequency } from './types';

/** Frequency options for medication form select */
export const FREQUENCY_OPTIONS: { value: MedicationFrequency; label: string }[] = [
  { value: 'once_daily', label: 'Once daily' },
  { value: 'twice_daily', label: 'Twice daily' },
  { value: 'three_times_daily', label: 'Three times daily' },
  { value: 'four_times_daily', label: 'Four times daily' },
  { value: 'as_needed', label: 'As needed (PRN)' },
  { value: 'weekly', label: 'Weekly' },
];

/** Timing presets for medication timing checkbox group */
export const TIMING_PRESETS: { value: string; label: string }[] = [
  { value: 'morning', label: 'Morning' },
  { value: 'midday', label: 'Midday' },
  { value: 'afternoon', label: 'Afternoon' },
  { value: 'evening', label: 'Evening' },
  { value: 'bedtime', label: 'Bedtime' },
];

/**
 * Maps medication frequency to number of scheduled doses per day.
 * Used by adherence calculation and dose log grid.
 * as_needed = 0 (no scheduled doses, patient logs when taken)
 */
export const FREQUENCY_DOSES_MAP: Record<MedicationFrequency, number> = {
  once_daily: 1,
  twice_daily: 2,
  three_times_daily: 3,
  four_times_daily: 4,
  as_needed: 0,
  weekly: 1,
};
