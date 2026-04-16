import type { Medication, FinerenoneScenario, SafetyGateRule, GenericBridgeItem } from './types';

// Source: reference/clinical_content.md Section 2.1
export const HFREF_MEDICATIONS: Medication[] = [
  {
    id: 'arni',
    drugClass: 'ARNI',
    agent: 'Sacubitril/valsartan',
    startingDose: '24/26 mg BID',
    targetDose: '97/103 mg BID',
    safetyGates: ['SBP >100', 'K+ <5.5'],
    evidenceLevel: 'established',
  },
  {
    id: 'beta-blocker',
    drugClass: 'Beta-blocker',
    agent: 'Carvedilol',
    startingDose: '3.125 mg BID',
    targetDose: '25 mg BID (50 if >85kg)',
    safetyGates: ['HR >50', 'SBP >90'],
    evidenceLevel: 'established',
  },
  {
    id: 'mra',
    drugClass: 'MRA',
    agent: 'Spironolactone',
    startingDose: '12.5-25 mg daily',
    targetDose: '25-50 mg daily',
    safetyGates: ['eGFR >30', 'K+ <5.0'],
    evidenceLevel: 'established',
  },
  {
    id: 'sglt2i',
    drugClass: 'SGLT2i',
    agent: 'Dapagliflozin or Empagliflozin',
    startingDose: '10 mg daily',
    targetDose: '10 mg daily (no titration)',
    safetyGates: ['eGFR >20'],
    evidenceLevel: 'established',
  },
];

// Source: reference/clinical_content.md Section 2.2
export const HFPEF_MEDICATIONS: Medication[] = [
  {
    id: 'sglt2i-hfpef',
    drugClass: 'SGLT2i',
    agent: 'Dapagliflozin or Empagliflozin',
    startingDose: '10 mg daily',
    targetDose: '10 mg daily',
    safetyGates: [],
    evidenceLevel: 'established',
    evidenceContext: 'Class IIa per 2022 AHA/ACC/HFSA. EMPEROR-Preserved + DELIVER.',
    priority: 1,
  },
  {
    id: 'mra-hfpef',
    drugClass: 'MRA',
    agent: 'Finerenone OR Spironolactone',
    startingDose: '10-20 mg / 12.5-25 mg',
    targetDose: '10-20 mg / 12.5-25 mg',
    safetyGates: ['K+ <5.0', 'eGFR >=25'],
    evidenceLevel: 'emerging',
    evidenceContext: 'Finerenone: FINEARTS-HF 16% reduction CV death/HF events. Requires K+ <5.0 and eGFR >=25.',
    priority: 2,
  },
  {
    id: 'glp1-ra',
    drugClass: 'GLP-1 RA',
    agent: 'Semaglutide',
    startingDose: 'Titrate to 2.4 mg weekly',
    targetDose: '2.4 mg weekly',
    safetyGates: [],
    evidenceLevel: 'emerging',
    evidenceContext: 'STEP-HFpEF: Improved symptoms in obesity phenotype (BMI >=30). Obesity therapy with CV benefits.',
    priority: 3,
  },
  {
    id: 'diuretics',
    drugClass: 'Diuretics',
    agent: 'Loop diuretics',
    startingDose: 'PRN',
    targetDose: 'PRN',
    safetyGates: [],
    evidenceLevel: 'pragmatic',
    evidenceContext: 'Symptom/volume control.',
    priority: 4,
  },
];

// Source: reference/clinical_content.md Finerenone vs. Spironolactone Decision Guide
export const FINERENONE_SCENARIOS: FinerenoneScenario[] = [
  {
    clinicalScenario: 'HFpEF with eGFR 25-60, K+ <5.0',
    suggestedApproach: 'Consider finerenone',
    rationale: 'FINEARTS-HF population; requires eGFR >=25 and K+ <5.0',
  },
  {
    clinicalScenario: 'History of hyperkalemia on MRA',
    suggestedApproach: 'Finerenone preferred (monitor K+ closely)',
    rationale: 'Lower hyperkalemia incidence in trials',
  },
  {
    clinicalScenario: 'Significant cost barrier',
    suggestedApproach: 'Spironolactone',
    rationale: '~$4/month generic vs. ~$500/month',
  },
  {
    clinicalScenario: 'HFrEF',
    suggestedApproach: 'Either acceptable',
    rationale: 'Both have supporting evidence',
  },
  {
    clinicalScenario: 'Uncertain, guideline-adherent approach',
    suggestedApproach: 'Spironolactone',
    rationale: 'Established guideline recommendation',
  },
];

// Source: reference/clinical_content.md Titration Safety Gates Summary
export const SAFETY_GATE_RULES: SafetyGateRule[] = [
  { condition: 'SBP >=100', action: 'uptitrate' },
  { condition: 'HR >=50', action: 'uptitrate' },
  { condition: 'K+ <5.0', action: 'uptitrate' },
  { condition: 'SBP <90', action: 'hold' },
  { condition: 'HR <50', action: 'hold' },
  { condition: 'K+ >5.5', action: 'hold' },
  { condition: 'Cr increase >30%', action: 'hold' },
];

// Source: reference/clinical_content.md Section 2.3
export const NON_PHARMACOLOGICAL = {
  sodium: { label: 'Dietary Sodium', target: '<2,000 mg/day' },
  activity: {
    label: 'Physical Activity',
    target: 'Walking 5-10 min daily, gradually increase to 30 min moderate activity most days',
  },
  cardiacRehab: {
    label: 'Cardiac Rehabilitation',
    target: 'Class I recommendation -- refer all eligible patients',
  },
};

// Source: reference/clinical_content.md Section 2.4
export const GENERIC_BRIDGE_ITEMS: GenericBridgeItem[] = [
  { drugClass: 'ACE inhibitor OR ARB', agent: 'Lisinopril or Losartan', monthlyCost: '$4/month' },
  { drugClass: 'Beta-blocker', agent: 'Carvedilol generic', monthlyCost: '$4/month' },
  { drugClass: 'MRA', agent: 'Spironolactone generic', monthlyCost: '$4/month' },
  { drugClass: 'Metformin', agent: 'Metformin', monthlyCost: '$4/month', note: 'if diabetic/prediabetic' },
];

export const GENERIC_BRIDGE_PRINCIPLE =
  'Generic therapy is superior to NO therapy. Never delay treatment while waiting for paperwork.';
