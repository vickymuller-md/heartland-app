/**
 * Patient Onboarding Wizard -- Constants and Bitmask Helpers
 * Requirements: ONBD-03, ONBD-04
 * Source: HEARTLAND Protocol v3.3
 *
 * Each setup step has a fixed bit value (1, 2, 4, 8, 16).
 * The setup_completed_steps column stores a bitmask of completed steps.
 * ALL_STEPS_COMPLETE = 31 (binary 11111, all 5 bits set).
 */

import type { OnboardingStep } from './types';

/** Ordered onboarding steps matching ONBD-02 wizard sequence */
export const SETUP_STEPS: readonly OnboardingStep[] = [
  {
    id: 0,
    bit: 1,
    label: 'Risk Calculator',
    description: 'Run the HEARTLAND Risk Score for this patient',
    href: '/risk-calculator',
  },
  {
    id: 1,
    bit: 2,
    label: 'Track Assignment',
    description: 'Assign remote monitoring track (Digital or Analog)',
    href: '/remote-monitoring',
  },
  {
    id: 2,
    bit: 4,
    label: 'Add Medications',
    description: 'Enter current heart failure medications',
    href: '/patients/[patientId]/medications',
  },
  {
    id: 3,
    bit: 8,
    label: 'Device Setup Guide',
    description: 'Guide patient on scale, BP cuff, and app setup',
    href: null,
  },
  {
    id: 4,
    bit: 16,
    label: 'Assign Education Modules',
    description: 'Send education modules to patient',
    href: '/patients/[patientId]/education',
  },
] as const;

/** Bitmask value when all 5 steps are complete (1+2+4+8+16 = 31) */
export const ALL_STEPS_COMPLETE = 31;

/**
 * Mark a step as complete by setting its bit.
 * Pure function -- does not mutate.
 */
export function markStep(completedSteps: number, bit: number): number {
  return completedSteps | bit;
}

/**
 * Check if a specific step bit is set in the bitmask.
 * Pure function.
 */
export function isStepComplete(completedSteps: number, bit: number): boolean {
  return (completedSteps & bit) !== 0;
}
