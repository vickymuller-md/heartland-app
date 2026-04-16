/**
 * Discharge Checklist -- Clinical Constants
 * Phase 16: DSCH-01 (bundle), DSCH-02 (task shifting), DSCH-06 (teach-back)
 *
 * Source: HEARTLAND Protocol v3.3 Module 4, Sections 4.1-4.3
 * All content sourced from reference/clinical_content.md
 */

import type { BundleComponent, TaskShiftRow, TeachBackDomain } from './types';

/**
 * Discharge Bundle Components (Protocol Section 4.1)
 * 4 items: case management, teach-back, med reconciliation, follow-up scheduled
 */
export const BUNDLE_COMPONENTS: BundleComponent[] = [
  {
    id: 'case_management',
    label: 'Case Management Assessment',
    timing: 'Within 24h of admission',
    tier1: 'If available',
    tier23: 'Required',
  },
  {
    id: 'teach_back',
    label: 'Teach-Back Education',
    timing: 'Before discharge',
    tier1: '3 core domains',
    tier23: '8 domains',
  },
  {
    id: 'med_reconciliation',
    label: 'Medication Reconciliation',
    timing: 'Before discharge',
    tier1: 'Simplified',
    tier23: 'Full with PharmD',
  },
  {
    id: 'follow_up_scheduled',
    label: 'Follow-Up Scheduled',
    timing: 'Before leaving',
    tier1: '14-day PCP',
    tier23: '7-day visit confirmed',
  },
];

/**
 * Task-Shifting Framework (Protocol Section 4.2)
 * 8 tasks with optimal executor, alternatives, and no-CHW fallback
 */
export const TASK_SHIFTING_ROWS: TaskShiftRow[] = [
  {
    id: 'teach_back_education',
    task: 'Teach-back education',
    optimal: 'RN',
    alternatives: 'LPN (RN supervise), Pharmacist',
    no_chw: 'RN with extended time; video',
  },
  {
    id: 'discharge_checklist',
    task: 'Discharge checklist',
    optimal: 'RN',
    alternatives: 'MA with script, LPN',
    no_chw: 'RN or provider',
  },
  {
    id: 'daily_weight_bp_calls',
    task: 'Daily weight/BP calls',
    optimal: 'RN, Pharmacist',
    alternatives: 'MA, CHW, Automated IVR',
    no_chw: 'MA with script; IVR system',
  },
  {
    id: 'symptom_assessment',
    task: 'Symptom assessment',
    optimal: 'RN',
    alternatives: 'LPN \u2192 RN review',
    no_chw: 'RN via phone',
  },
  {
    id: 'red_flag_triage',
    task: 'Red-flag triage',
    optimal: 'RN/Provider',
    alternatives: 'NO SUBSTITUTION',
    no_chw: 'NO SUBSTITUTION',
  },
  {
    id: 'home_device_setup',
    task: 'Home device setup',
    optimal: 'Home Health RN',
    alternatives: 'CHW, Family caregiver',
    no_chw: 'Family with phone instruction',
  },
  {
    id: 'financial_pap_navigation',
    task: 'Financial/PAP navigation',
    optimal: 'Social Worker',
    alternatives: 'CHW, Financial navigator',
    no_chw: 'SW via phone; self-service resources',
  },
  {
    id: 'dietary_education',
    task: 'Dietary education',
    optimal: 'Dietitian',
    alternatives: 'RN, CHW (with script)',
    no_chw: 'Written materials; phone dietitian',
  },
];

/**
 * Teach-Back Core Domains (Protocol Section 4.3)
 * Tier 1: 3 domains (tier === 'all')
 * Tier 2/3: all 8 domains
 */
export const TEACH_BACK_DOMAINS: TeachBackDomain[] = [
  // Tier 1 (all tiers) -- 3 core domains
  {
    id: 'daily_weight',
    title: 'Daily Weight',
    description: 'Weigh same time daily; call if +3lbs/2 days or +5lbs/week',
    tier: 'all',
  },
  {
    id: 'medications',
    title: 'Medications',
    description: 'Take daily even when well; never stop without calling',
    tier: 'all',
  },
  {
    id: 'warning_signs',
    title: 'Warning Signs',
    description: 'SOB, swelling, waking breathless \u2192 call clinic',
    tier: 'all',
  },
  // Tier 2/3 additional -- 5 more domains
  {
    id: 'what_is_hf',
    title: 'What is HF',
    description: 'Understanding heart failure, how it affects the body, and why treatment matters',
    tier: 'tier23',
  },
  {
    id: 'sodium_restriction',
    title: 'Sodium Restriction',
    description: 'Limit sodium intake to reduce fluid retention and manage symptoms',
    tier: 'tier23',
  },
  {
    id: 'fluid_management',
    title: 'Fluid Management',
    description: 'Monitor fluid intake and output to prevent volume overload',
    tier: 'tier23',
  },
  {
    id: 'when_to_call',
    title: 'When to Call',
    description: 'Detailed criteria for contacting the clinic or seeking emergency care',
    tier: 'tier23',
  },
  {
    id: 'activity_guidance',
    title: 'Activity Guidance',
    description: 'Safe exercise and activity levels during recovery',
    tier: 'tier23',
  },
];
