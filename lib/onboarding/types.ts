/**
 * Patient Onboarding Wizard -- Type Definitions
 * Requirements: ONBD-03, ONBD-04
 * Source: HEARTLAND Protocol v3.3
 */

/** A single onboarding step definition */
export interface OnboardingStep {
  id: number;          // 0-4
  bit: number;         // 1, 2, 4, 8, or 16 -- immutable once deployed
  label: string;
  description: string;
  href: string | null; // null = inline step (Device Setup Guide)
}

/** Current setup state derived from the bitmask column */
export type SetupState = {
  completedSteps: number; // bitmask
  isComplete: boolean;    // completedSteps === ALL_STEPS_COMPLETE
};
