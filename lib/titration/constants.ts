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
  FinerenonePotassiumBand,
} from './types';

// ==========================================================================
// Finerenone potassium table for the heart failure indication (LVEF >=40%).
// Distinct from the steroidal MRA rule and from the finerenone CKD/type 2
// diabetes indication, which uses different bounds and a restart at K+ <=5.0.
// Source: KERENDIA label Table 3 and §2.3, DailyMed SPL
// fc726765-5d5a-4d6e-b037-b847bda9fb7c (rev. 8/2025).
// ==========================================================================
export const FINERENONE_POTASSIUM_BANDS: FinerenonePotassiumBand[] = [
  {
    range: '<5.0',
    minInclusive: null,
    maxExclusive: 5.0,
    action: 'increase',
    instruction: 'Increase toward the target dose; keep the current dose if the eGFR has fallen by more than 30% since the previous measurement',
  },
  {
    range: '5.0 to <5.5',
    minInclusive: 5.0,
    maxExclusive: 5.5,
    action: 'maintain',
    instruction: 'Maintain the current dose',
  },
  {
    range: '5.5 to <6.0',
    minInclusive: 5.5,
    maxExclusive: 6.0,
    action: 'reduce-one-step',
    instruction: 'Decrease one step: 40 mg to 20 mg once daily, 20 mg to 10 mg once daily; withhold if already at 10 mg once daily',
  },
  {
    range: '>=6.0',
    minInclusive: 6.0,
    maxExclusive: null,
    action: 'withhold',
    instruction: 'Withhold at any dose',
  },
];

/** Source: KERENDIA label Table 3, including the note on repeated measurements. */
export const FINERENONE_RESTART_RULE =
  'Restart at 10 mg once daily when serum potassium is <5.5 mEq/L; if potassium is repeatedly >=5.5 mEq/L, restart when it is <5.0 mEq/L (KERENDIA label Table 3).';

/** Returns the finerenone potassium band a value falls into. */
export function finerenonePotassiumBand(potassium: number): FinerenonePotassiumBand {
  return (
    FINERENONE_POTASSIUM_BANDS.find(
      (band) =>
        (band.minInclusive === null || potassium >= band.minInclusive) &&
        (band.maxExclusive === null || potassium < band.maxExclusive),
    ) ?? FINERENONE_POTASSIUM_BANDS[0]
  );
}

// ==========================================================================
// Renal gate thresholds — one declaration shared by the safety-gate panel
// (SAFETY_GATES below) and the per-drug engine (lib/titration/engine.ts).
// Every entry reads "requires eGFR >= MIN", so every comparison is
// `egfr < MIN` and a value exactly equal to MIN passes.
// Source: ACC/AHA 2022 HF Guidelines (MRA); FDA labels per agent.
// ==========================================================================
export const EGFR_GATES = {
  /** Spironolactone/eplerenone: 2022 AHA/ACC/HFSA COR 1 A (eGFR >30, K+ <5.0). */
  spironolactoneMin: 30,
  /**
   * Spironolactone at full daily dose: ALDACTONE §2.2 initiates at 25 mg daily
   * only above this eGFR; between 30 and 50 the label offers 25 mg every other
   * day and 2022 AHA/ACC/HFSA p. e932 halves the dose.
   */
  spironolactoneFullDoseMin: 50,
  /** Finerenone: KERENDIA label Table 1 / §5.2 — initiation not recommended below 25. */
  finerenoneInitiationMin: 25,
  /**
   * Dapagliflozin: FARXIGA §2.3 — initiation not recommended below this eGFR,
   * but 10 mg once daily may continue if the eGFR later falls below it.
   * Empagliflozin has no eGFR floor for the HF indication (JARDIANCE §2), so
   * there is no single "SGLT2i" threshold.
   */
  dapagliflozinInitiationMin: 25,
  /**
   * ARNI: ENTRESTO §2.7 sets no renal floor. Below this eGFR the label halves
   * the starting dose; suspension is driven by a clinically significant fall
   * in renal function (§5.4), not by a fixed cut-off.
   */
  arniHalfDoseMin: 30,
} as const;

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
        // Source: reference/clinical_content.md Section 3.3 row 6 (steroidal MRA
        // and ARNI) + KERENDIA label Table 3 (finerenone)
        action: 'HOLD steroidal MRA and ARNI; urgent recheck; dietary counseling',
        details: `Hyperkalemia. Hold potassium-elevating medications. Finerenone follows its own table: ${finerenonePotassiumBand(vitals.potassium).instruction}.`,
      };
      if (vitals.potassium >= 5.0) return {
        parameter: 'Potassium',
        value: vitals.potassium,
        threshold: 'K+ 5.0-5.5 mEq/L',
        status: 'warning',
        // Source: reference/clinical_content.md Section 3.3 row 5 (steroidal MRA)
        // + KERENDIA label Table 3 (finerenone: maintain, do not reduce)
        action: 'Reduce steroidal MRA dose; recheck in 1 week',
        details: `Borderline potassium. Reduce the steroidal MRA dose and monitor. Finerenone: ${finerenonePotassiumBand(vitals.potassium).instruction.toLowerCase()} (KERENDIA label Table 3).`,
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
      const eGFR_FINERENONE_THRESHOLD = EGFR_GATES.finerenoneInitiationMin;
      const eGFR_MRA_THRESHOLD = EGFR_GATES.spironolactoneMin;
      // SGLT2i: FARXIGA §2.3 (dapagliflozin) restricts initiation, not
      // continuation; JARDIANCE §2 (empagliflozin) has no HF eGFR floor.
      const SGLT2I_RENAL_NOTE =
        'Dapagliflozin: do not initiate below eGFR 25; 10 mg once daily may continue if eGFR falls below it (FARXIGA 2.3). Empagliflozin: no eGFR floor for the HF indication (JARDIANCE 2).';

      if (vitals.egfr === undefined) {
        return {
          parameter: 'eGFR (mL/min)',
          value: 0,
          threshold: 'eGFR not provided',
          status: 'blocked',
          action: 'Enter eGFR for complete renal check',
          details: 'eGFR not entered. A renal-sensitive medication decision must not proceed from an incomplete gate.',
        };
      }

      if (vitals.egfr < eGFR_FINERENONE_THRESHOLD) {
        return {
          parameter: 'eGFR (mL/min)',
          value: vitals.egfr,
          threshold: `eGFR < ${eGFR_FINERENONE_THRESHOLD} mL/min`,
          status: 'blocked',
          action: 'Do not initiate finerenone; hold MRA (spironolactone)',
          details: `eGFR is below the finerenone initiation threshold (KERENDIA Table 1) and below the MRA threshold of the ACC/AHA 2022 HF guidelines. ${SGLT2I_RENAL_NOTE}`,
        };
      }

      if (vitals.egfr < eGFR_MRA_THRESHOLD) {
        return {
          parameter: 'eGFR (mL/min)',
          value: vitals.egfr,
          threshold: `eGFR < ${eGFR_MRA_THRESHOLD} mL/min`,
          status: 'blocked',
          action: 'HOLD MRA (spironolactone)',
          details: `eGFR below MRA threshold per ACC/AHA 2022 HF guidelines. ${SGLT2I_RENAL_NOTE}`,
        };
      }

      if (vitals.egfr < EGFR_GATES.spironolactoneFullDoseMin) {
        return {
          parameter: 'eGFR (mL/min)',
          value: vitals.egfr,
          threshold: `eGFR ${eGFR_MRA_THRESHOLD}-${EGFR_GATES.spironolactoneFullDoseMin} mL/min`,
          status: 'warning',
          // Source: ALDACTONE label 2.2; 2022 AHA/ACC/HFSA p. e932
          action: 'Spironolactone: half the dose or 25 mg every other day',
          details: 'Full daily spironolactone dosing is reserved for eGFR above 50 (ALDACTONE label 2.2); the 2022 AHA/ACC/HFSA guideline halves the dose for eGFR 31-49.',
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
  // Source: reference/clinical_content.md Section 3.3 row 5 (steroidal MRA);
  // KERENDIA label Table 3 for the finerenone clause
  { parameter: 'K+ 5.0-5.5', action: 'Reduce steroidal MRA dose; recheck in 1 week. Finerenone: maintain the current dose' },
  // Source: reference/clinical_content.md Section 3.3 row 6 (steroidal MRA and
  // ARNI); KERENDIA label Table 3 for the finerenone clause
  { parameter: 'K+ >5.5', action: 'HOLD steroidal MRA and ARNI; urgent recheck; dietary counseling. Finerenone: decrease one step, withholding if already at 10 mg, and withhold at any dose if K+ >=6.0' },
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
// ACEi Drug Keywords for Washout Detection
// Source: Standard US pharmacology — all marketed ACE inhibitors
// ==========================================================================
export const ACEI_KEYWORDS = [
  'lisinopril', 'enalapril', 'captopril', 'ramipril',
  'quinapril', 'benazepril', 'fosinopril', 'perindopril',
  'trandolapril', 'moexipril',
];

// ==========================================================================
// Finerenone Keywords — route the non-steroidal MRA to its own titration path
// instead of the steroidal 'MRA' class.
// ==========================================================================
export const FINERENONE_KEYWORDS = ['finerenone', 'kerendia'];
