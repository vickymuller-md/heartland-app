// Source: reference/clinical_content.md Module 3
// HEARTLAND Protocol v3.3 — Telephone-Based GDMT Titration
// ALL clinical data character-for-character from the reference.

import type {
  VitalSigns,
  SafetyGateResult,
  SafetyGateDefinition,
  TitrationDecisionEntry,
  DualTrackDefinition,
  HozhoTrialParameter,
  TitrationStepDefinition,
} from './types';

// ==========================================================================
// Safety Gates (Protocol Module 3, Section 3.3 + ACC/AHA 2022)
// 5 gate evaluators: SBP, HR, K+, Cr, eGFR
// Source: reference/clinical_content.md Section 3.3, ACC/AHA 2022 HF Guidelines (eGFR)
// ==========================================================================
export const SAFETY_GATES: SafetyGateDefinition[] = [
  {
    id: 'sbp-critical',
    parameter: 'Systolic Blood Pressure',
    evaluate: (vitals: VitalSigns): SafetyGateResult => {
      if (vitals.sbp < 90) return {
        parameter: 'Systolic Blood Pressure',
        value: vitals.sbp,
        threshold: 'SBP < 90 mmHg',
        status: 'blocked',
        // Source: reference/clinical_content.md Section 3.3 row 3
        action: 'REDUCE dose or hold; consider cardiology input',
        details: 'Symptomatic hypotension risk. Do not uptitrate.',
      };
      if (vitals.sbp < 100) return {
        parameter: 'Systolic Blood Pressure',
        value: vitals.sbp,
        threshold: 'SBP 90-99 mmHg',
        status: 'warning',
        // Source: reference/clinical_content.md Section 3.3 row 2
        action: 'HOLD current dose; reassess in 1 week',
        details: 'Borderline. Safe to maintain current dose but do not increase.',
      };
      return {
        parameter: 'Systolic Blood Pressure',
        value: vitals.sbp,
        threshold: 'SBP \u2265 100 mmHg',
        status: 'pass',
        action: 'Safe to uptitrate',
        details: 'Hemodynamically stable for dose increase.',
      };
    },
  },
  {
    id: 'hr',
    parameter: 'Heart Rate',
    evaluate: (vitals: VitalSigns): SafetyGateResult => {
      if (vitals.hr < 50) return {
        parameter: 'Heart Rate',
        value: vitals.hr,
        threshold: 'HR < 50 bpm',
        status: 'blocked',
        // Source: reference/clinical_content.md Section 3.3 row 4
        action: 'Reduce beta-blocker dose; if symptomatic, hold',
        details: 'Bradycardia. Reduce or hold beta-blocker.',
      };
      return {
        parameter: 'Heart Rate',
        value: vitals.hr,
        threshold: 'HR \u2265 50 bpm',
        status: 'pass',
        action: 'Heart rate acceptable',
        details: 'No beta-blocker dose adjustment needed for HR.',
      };
    },
  },
  {
    id: 'potassium-high',
    parameter: 'Potassium',
    evaluate: (vitals: VitalSigns): SafetyGateResult => {
      if (vitals.potassium > 5.5) return {
        parameter: 'Potassium',
        value: vitals.potassium,
        threshold: 'K+ > 5.5 mEq/L',
        status: 'blocked',
        // Source: reference/clinical_content.md Section 3.3 row 6
        action: 'HOLD MRA/finerenone and ARNI; urgent recheck; dietary counseling',
        details: 'Hyperkalemia. Hold potassium-elevating medications.',
      };
      if (vitals.potassium >= 5.0) return {
        parameter: 'Potassium',
        value: vitals.potassium,
        threshold: 'K+ 5.0-5.5 mEq/L',
        status: 'warning',
        // Source: reference/clinical_content.md Section 3.3 row 5
        action: 'Reduce MRA/finerenone dose; recheck in 1 week',
        details: 'Borderline potassium. Reduce dose and monitor.',
      };
      return {
        parameter: 'Potassium',
        value: vitals.potassium,
        threshold: 'K+ < 5.0 mEq/L',
        status: 'pass',
        action: 'Potassium within safe range',
        details: 'No dose adjustment needed for potassium.',
      };
    },
  },
  {
    id: 'creatinine',
    parameter: 'Creatinine',
    evaluate: (vitals: VitalSigns): SafetyGateResult => {
      if (vitals.creatinineBaseline && vitals.creatinineBaseline > 0) {
        const increase = ((vitals.creatinine - vitals.creatinineBaseline) / vitals.creatinineBaseline) * 100;
        if (increase > 30) return {
          parameter: 'Creatinine',
          value: vitals.creatinine,
          threshold: 'Cr increase > 30% from baseline',
          status: 'blocked',
          // Source: reference/clinical_content.md Section 3.3 row 7
          action: 'HOLD ARNI/MRA; evaluate; cardiology consult',
          details: `Cr increased ${increase.toFixed(0)}% from baseline ${vitals.creatinineBaseline}. Renal function declining.`,
        };
      }
      return {
        parameter: 'Creatinine',
        value: vitals.creatinine,
        threshold: 'Cr stable',
        status: 'pass',
        action: 'Creatinine stable',
        details: 'No dose adjustment needed for renal function.',
      };
    },
  },
  {
    id: 'egfr',
    parameter: 'eGFR (mL/min)',
    evaluate: (vitals: VitalSigns): SafetyGateResult => {
      // Named constants for clinical thresholds (ACC/AHA 2022 HF Guidelines)
      const eGFR_SGLT2I_THRESHOLD = 20;
      const eGFR_FINERENONE_THRESHOLD = 25;
      const eGFR_MRA_THRESHOLD = 30;

      if (vitals.egfr === undefined) {
        return {
          parameter: 'eGFR (mL/min)',
          value: 0,
          threshold: 'eGFR not provided',
          status: 'pass',
          action: 'Enter eGFR for complete renal check',
          details: 'eGFR not entered. Renal safety gates require eGFR value.',
        };
      }

      if (vitals.egfr < eGFR_SGLT2I_THRESHOLD) {
        return {
          parameter: 'eGFR (mL/min)',
          value: vitals.egfr,
          threshold: `eGFR < ${eGFR_SGLT2I_THRESHOLD} mL/min`,
          status: 'blocked',
          action: 'HOLD SGLT2i; hold MRA and finerenone',
          details: 'eGFR below SGLT2i threshold per ACC/AHA 2022 HF guidelines. All renal-sensitive agents contraindicated.',
        };
      }

      if (vitals.egfr < eGFR_FINERENONE_THRESHOLD) {
        return {
          parameter: 'eGFR (mL/min)',
          value: vitals.egfr,
          threshold: `eGFR < ${eGFR_FINERENONE_THRESHOLD} mL/min`,
          status: 'blocked',
          action: 'HOLD finerenone; hold MRA (spironolactone)',
          details: 'eGFR below finerenone threshold per ACC/AHA 2022 HF guidelines.',
        };
      }

      if (vitals.egfr < eGFR_MRA_THRESHOLD) {
        return {
          parameter: 'eGFR (mL/min)',
          value: vitals.egfr,
          threshold: `eGFR < ${eGFR_MRA_THRESHOLD} mL/min`,
          status: 'blocked',
          action: 'HOLD MRA (spironolactone)',
          details: 'eGFR below MRA threshold per ACC/AHA 2022 HF guidelines.',
        };
      }

      return {
        parameter: 'eGFR (mL/min)',
        value: vitals.egfr,
        threshold: `eGFR ≥ ${eGFR_MRA_THRESHOLD} mL/min`,
        status: 'pass',
        action: 'eGFR acceptable',
        details: 'Renal function within acceptable range for all HF medications.',
      };
    },
  },
];

// ==========================================================================
// Titration Decision Algorithm (Protocol Module 3, Section 3.3)
// 7 parameter-action entries, character-for-character from reference
// Source: reference/clinical_content.md Section 3.3
// ==========================================================================
export const TITRATION_DECISIONS: TitrationDecisionEntry[] = [
  // Source: reference/clinical_content.md Section 3.3 row 1
  { parameter: 'SBP \u2265 100 mmHg AND asymptomatic', action: 'UPTITRATE to next dose level' },
  // Source: reference/clinical_content.md Section 3.3 row 2
  { parameter: 'SBP 90-99 mmHg AND asymptomatic', action: 'HOLD current dose; reassess in 1 week' },
  // Source: reference/clinical_content.md Section 3.3 row 3
  { parameter: 'SBP <90 mmHg OR symptomatic hypotension', action: 'REDUCE dose or hold; consider cardiology input' },
  // Source: reference/clinical_content.md Section 3.3 row 4
  { parameter: 'HR <50 (for beta-blockers)', action: 'Reduce dose; if symptomatic, hold' },
  // Source: reference/clinical_content.md Section 3.3 row 5
  { parameter: 'K+ 5.0-5.5', action: 'Reduce MRA/finerenone dose; recheck in 1 week' },
  // Source: reference/clinical_content.md Section 3.3 row 6
  { parameter: 'K+ >5.5', action: 'HOLD MRA/finerenone and ARNI; urgent recheck; dietary counseling' },
  // Source: reference/clinical_content.md Section 3.3 row 7
  { parameter: 'Cr increase >30%', action: 'HOLD ARNI/MRA; evaluate; cardiology consult' },
];

// ==========================================================================
// Dual-Track Definitions (Protocol Module 3, Section 3.2)
// Source: reference/clinical_content.md Section 3.2
// ==========================================================================
export const DUAL_TRACKS: {
  trackA: DualTrackDefinition;
  trackB: DualTrackDefinition;
  note: string;
} = {
  trackA: {
    id: 'track-a',
    name: 'Track A (Digital)',
    // Source: reference/clinical_content.md Section 3.2
    features: [
      'Smartphone with reliable connectivity',
      'Bluetooth devices (BP cuff, scale)',
      'App-based daily entry',
      'Automated alerts',
      'Video visits available',
    ],
  },
  trackB: {
    id: 'track-b',
    name: 'Track B (Analog)',
    // Source: reference/clinical_content.md Section 3.2
    features: [
      'Paper diary for recording',
      'Standard devices (patient reads display)',
      'Voice telephone calls',
      'Verbal report to staff (staff enters manually)',
      'Phone visits only',
    ],
  },
  // Source: reference/clinical_content.md Section 3.2
  note: 'Both tracks follow identical clinical decision algorithms. Track selection based on patient capability, not clinical need.',
};

// ==========================================================================
// Hozho Trial Evidence (Protocol Module 3, Section 3.1)
// Source: reference/clinical_content.md Section 3.1
// ==========================================================================
export const HOZHO_TRIAL: {
  name: string;
  year: number;
  parameters: HozhoTrialParameter[];
} = {
  name: 'Hozho Trial',
  year: 2024,
  parameters: [
    // Source: reference/clinical_content.md Section 3.1, row by row
    { parameter: 'Population', result: '103 American Indians with HF in rural Navajo Nation' },
    { parameter: 'Primary Outcome', result: '66.2% vs 13.1% GDMT class addition at 30 days' },
    { parameter: 'Absolute Increase', result: '53%' },
    { parameter: 'Telehealth Completion', result: '80.5% adherence to phone visits' },
    { parameter: 'Safety', result: 'No increase in adverse events (6.6% vs 5.0%, p=0.51)' },
    { parameter: 'Method', result: 'Voice telephone calls (not smartphone apps)' },
  ],
};

// ==========================================================================
// Step Definitions for the 5-step wizard
// ==========================================================================
export const STEP_DEFINITIONS: TitrationStepDefinition[] = [
  {
    id: 'pre-call-vitals',
    label: 'Pre-Call Vitals',
    description: 'Enter current SBP, HR, K+, Cr, and baseline Cr',
  },
  {
    id: 'medication-review',
    label: 'Medication Review',
    description: 'Current medications with doses',
  },
  {
    id: 'safety-gate-check',
    label: 'Safety Gate Check',
    description: 'Automated evaluation of vital sign thresholds',
  },
  {
    id: 'titration-decision',
    label: 'Titration Decision',
    description: 'Algorithm-guided titration recommendation',
  },
  {
    id: 'plan-followup',
    label: 'Plan & Follow-Up',
    description: 'Next call date, notes, and track reference',
  },
];

// ==========================================================================
// Common HF medications for pre-populating medication review (Step 2)
// ==========================================================================
export const DEFAULT_MEDICATIONS = [
  { name: 'ARNI (Sacubitril/valsartan)', currentDose: '' },
  { name: 'Beta-blocker (Carvedilol)', currentDose: '' },
  { name: 'MRA (Spironolactone)', currentDose: '' },
  { name: 'SGLT2i (Dapagliflozin/Empagliflozin)', currentDose: '' },
  { name: 'Loop diuretic (Furosemide)', currentDose: '' },
];

// ==========================================================================
// Per-Drug eGFR Thresholds for Titration Safety Gates
// Source: ACC/AHA 2022 HF Guidelines, reference/clinical_content.md Module 2
// ==========================================================================
export const EGFR_THRESHOLDS: Record<string, { min: number; operator: 'gt' | 'gte'; label: string }> = {
  MRA:        { min: 30, operator: 'gt',  label: 'eGFR >30' },
  SGLT2i:     { min: 20, operator: 'gt',  label: 'eGFR >20' },
  finerenone: { min: 25, operator: 'gte', label: 'eGFR >=25' },
  ARNI:       { min: 20, operator: 'gt',  label: 'eGFR >20 (use cautiously <30)' },
};

// ==========================================================================
// ACEi Drug Keywords for Washout Detection
// Source: Standard US pharmacology — all marketed ACE inhibitors
// ==========================================================================
export const ACEI_KEYWORDS = [
  'lisinopril', 'enalapril', 'captopril', 'ramipril',
  'quinapril', 'benazepril', 'fosinopril', 'perindopril',
  'trandolapril', 'moexipril',
];
