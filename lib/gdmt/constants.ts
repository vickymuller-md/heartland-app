import type { Medication, FinerenoneScenario, SafetyGateRule, GenericBridgeItem, PotassiumBand } from './types';

/**
 * SGLT2i renal rules, stated per agent and per moment.
 * Neither US label carries a class-wide "eGFR >20" floor: that number is the
 * EMPEROR programme enrolment floor, not a labeled threshold.
 * Source: FARXIGA label §2.3 (DailyMed SPL 72ad22ae-efe6-4cd6-a302-98aaee423d69);
 * JARDIANCE label §2 (DailyMed SPL faf3dd6a-9cd0-39c2-0d2e-232cb3f67565).
 */
export const SGLT2I_RENAL_GATES = [
  'Dapagliflozin: do not initiate if eGFR <25; may continue 10 mg daily if eGFR later falls below 25 (FARXIGA label 2.3)',
  'Empagliflozin: no eGFR floor for the HF indication (JARDIANCE label 2); EMPEROR trials did not enrol eGFR <20',
];

// Source: reference/clinical_content.md Section 2.1
export const HFREF_MEDICATIONS: Medication[] = [
  {
    id: 'arni',
    drugClass: 'ARNI',
    agent: 'Sacubitril/valsartan',
    startingDose: '24/26 mg BID',
    targetDose: '97/103 mg BID',
    // ENTRESTO label 2.7: half the usual starting dose if eGFR <30. The label
    // sets no renal floor; suspension follows a clinically significant fall in
    // renal function (5.4).
    safetyGates: ['SBP >100', 'K+ <5.5', 'eGFR <30: start at half the usual dose (ENTRESTO label 2.7); no renal floor'],
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
    agent: 'Spironolactone or eplerenone',
    startingDose: '12.5-25 mg daily',
    targetDose: '25-50 mg daily',
    safetyGates: [
      'eGFR >30',
      'K+ <5.0',
      // ALDACTONE label 2.2; 2022 AHA/ACC/HFSA p. e932
      'eGFR 30-50: half the dose or 25 mg every other day',
      // INSPRA label 4 — creatinine clearance, not eGFR
      'Eplerenone: contraindicated if creatinine clearance <=30 mL/min or K+ >5.5 mEq/L at initiation',
    ],
    evidenceLevel: 'established',
    evidenceContext: '2022 AHA/ACC/HFSA COR 1 A recommends an MRA (spironolactone or eplerenone) if eGFR >30 and K+ <5.0. Eplerenone is the guideline alternative when gynecomastia or breast pain occurs (10% of men on spironolactone vs 1% on placebo in RALES).',
  },
  {
    id: 'sglt2i',
    drugClass: 'SGLT2i',
    agent: 'Dapagliflozin or Empagliflozin',
    startingDose: '10 mg daily',
    targetDose: '10 mg daily (no titration)',
    safetyGates: SGLT2I_RENAL_GATES,
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
    safetyGates: SGLT2I_RENAL_GATES,
    evidenceLevel: 'established',
    evidenceContext: 'Class IIa per 2022 AHA/ACC/HFSA. EMPEROR-Preserved + DELIVER.',
    priority: 1,
  },
  {
    id: 'mra-hfpef',
    drugClass: 'MRA',
    agent: 'Finerenone (LVEF >=40 indication) or guideline-selected spironolactone',
    // KERENDIA label 2.3 and Table 1: the dose depends on the eGFR at
    // initiation, and 10-20 mg is the starting range, not the target.
    startingDose: 'Finerenone 20 mg daily (eGFR >=60) or 10 mg daily (eGFR 25 to <60) / Spironolactone 12.5-25 mg daily',
    targetDose: 'Finerenone 40 mg daily (eGFR >=60 at initiation) or 20 mg daily (eGFR 25 to <60) / Spironolactone 25-50 mg daily',
    safetyGates: ['K+ <5.0', 'eGFR >=25'],
    evidenceLevel: 'established',
    evidenceContext: 'Finerenone: FDA-labeled in adults with HF and LVEF >=40% (July 2025 label), informed by FINEARTS-HF. Apply the current label, including potassium and eGFR monitoring.',
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

/**
 * Finerenone dosing for the heart failure indication (LVEF >=40%).
 * The dose depends on the eGFR at initiation; the 4-week lab is the titration
 * decision point. The CKD/type 2 diabetes indication has a different target
 * dose and different potassium rules -- do not mix them.
 * Source: KERENDIA label §2.3 and Table 1, DailyMed SPL
 * fc726765-5d5a-4d6e-b037-b847bda9fb7c (rev. 8/2025).
 */
export const FINERENONE_DOSING: {
  indication: string;
  bands: {
    label: string;
    minEgfr: number;
    maxEgfr: number | null;
    startingDose: string;
    targetDose: string;
  }[];
  notRecommendedBelowEgfr: number;
  belowThresholdAction: string;
  titrationRule: string;
} = {
  indication: 'Heart failure with LVEF >=40% (KERENDIA label 1)',
  bands: [
    {
      label: 'eGFR >=60 at initiation',
      minEgfr: 60,
      maxEgfr: null,
      startingDose: '20 mg once daily',
      targetDose: '40 mg once daily',
    },
    {
      label: 'eGFR 25 to <60 at initiation',
      minEgfr: 25,
      maxEgfr: 60,
      startingDose: '10 mg once daily',
      targetDose: '20 mg once daily',
    },
  ],
  notRecommendedBelowEgfr: 25,
  belowThresholdAction: 'eGFR <25: initiation is not recommended (KERENDIA label Table 1 and 5.2)',
  titrationRule: 'Increase toward the target dose at the 4-week lab if serum potassium is <5.0 mEq/L; if the eGFR has fallen by more than 30% from the previous measurement, keep the current dose.',
};

/**
 * Finerenone contraindications.
 * Source: KERENDIA label §4 (verbatim list), DailyMed SPL
 * fc726765-5d5a-4d6e-b037-b847bda9fb7c.
 */
export const FINERENONE_CONTRAINDICATIONS = [
  'Hypersensitivity to any component of the product',
  'Concomitant treatment with strong CYP3A4 inhibitors (for example clarithromycin, itraconazole, ritonavir)',
  'Adrenal insufficiency',
];

/**
 * Finerenone interactions and use in hepatic impairment.
 * Source: KERENDIA label §7.1 (grapefruit, CYP3A4 inducers) and §8.6 (Child-Pugh C).
 */
export const FINERENONE_INTERACTIONS = [
  'Avoid grapefruit and grapefruit juice (KERENDIA label 7.1)',
  'Avoid concomitant strong or moderate CYP3A4 inducers (KERENDIA label 7.1)',
  'Avoid use in severe hepatic impairment, Child-Pugh C (KERENDIA label 8.6)',
];

/**
 * Finerenone laboratory monitoring: the label minimum and the protocol's own,
 * more frequent schedule, each with its own source.
 * Source: KERENDIA label §2.1, §2.3 and §5.1; 2022 AHA/ACC/HFSA p. e932;
 * ALDACTONE label §5.1.
 */
export const FINERENONE_MONITORING = {
  labelMinimum:
    'Label minimum (KERENDIA 2.1, 2.3, 5.1): serum potassium and eGFR before initiation, 4 weeks after initiation and 4 weeks after each dose adjustment -- the 4-week lab is the titration decision point -- then periodically; more frequent monitoring may be necessary in patients at risk of hyperkalemia.',
  protocolAddition:
    'HEARTLAND schedule (protocol choice, more frequent): add a potassium and eGFR check 1 week after initiation and after each dose change. Source: the first milestone of the 2022 AHA/ACC/HFSA MRA schedule ("approximately 1 week, then 4 weeks, then every 6 months", p. e932) and the ALDACTONE label 5.1 minimum. The 1-week check is additional to the 4-week label milestone and does not replace it.',
};

/**
 * Eplerenone — the steroidal MRA the toolkit did not list.
 * Source: INSPRA label, DailyMed SPL 1a52bedc-8e2c-4116-a296-a87770676b4a
 * (rev. 6/2025), sections 1.1, 2.1, 2.3, 2.4, 4 and Table 1;
 * 2022 AHA/ACC/HFSA COR 1 A; RALES (PMID 10471456) for gynecomastia.
 */
export const EPLERENONE_GUIDE: {
  agent: string;
  startingDose: string;
  targetDose: string;
  whyListed: string;
  contraindications: string[];
  doseCap: string;
  unitCaution: string;
  potassiumBands: PotassiumBand[];
  monitoring: string;
} = {
  agent: 'Eplerenone',
  startingDose: '25 mg once daily (INSPRA label 2.1)',
  targetDose: '50 mg once daily, preferably within 4 weeks as tolerated (INSPRA label 2.1)',
  whyListed: 'Guideline alternative to spironolactone (2022 AHA/ACC/HFSA COR 1 A), chiefly when gynecomastia or breast pain occurs: 10% of men on spironolactone vs 1% on placebo in RALES.',
  contraindications: [
    'Serum potassium >5.5 mEq/L at initiation (INSPRA label 4)',
    'Creatinine clearance <=30 mL/min (INSPRA label 4)',
    'Concomitant strong CYP3A inhibitors (INSPRA label 4)',
  ],
  doseCap: 'Maximum 25 mg once daily with a moderate CYP3A inhibitor (INSPRA label 2.4)',
  unitCaution: 'The eplerenone renal contraindication is written in creatinine clearance (mL/min); it is not interchangeable with eGFR (mL/min/1.73m2), which is what this app stores.',
  potassiumBands: [
    { range: '<5.0', action: 'Increase dose one step (25 mg every other day to 25 mg daily; 25 mg daily to 50 mg daily)' },
    { range: '5.0-5.4', action: 'No dose adjustment' },
    { range: '5.5-5.9', action: 'Decrease one step (50 mg daily to 25 mg daily; 25 mg daily to 25 mg every other day; 25 mg every other day to withhold)' },
    { range: '>=6.0', action: 'Withhold; restart at 25 mg every other day when potassium falls <5.5 mEq/L' },
  ],
  monitoring: 'Serum potassium before initiation, within the first week, at one month, and periodically thereafter; potassium and creatinine within 3-7 days of starting a moderate CYP3A inhibitor, an ACE inhibitor, an ARB or an NSAID (INSPRA label 2.3).',
};

/**
 * Spironolactone dose reduction in moderate renal impairment.
 * Source: ALDACTONE label 2.2 (DailyMed SPL 0fed2822-3a03-4b64-9857-c682fcd462bc);
 * 2022 AHA/ACC/HFSA p. e932 ("for eGFR 31 to 49 ... dosing should be reduced by half").
 */
export const SPIRONOLACTONE_RENAL_DOSE_RULE =
  'eGFR 30-50 mL/min/1.73m2: half the dose or 25 mg every other day (ALDACTONE label 2.2; 2022 AHA/ACC/HFSA p. e932). eGFR >50: standard daily dose.';

// Source: reference/clinical_content.md Finerenone vs. Spironolactone Decision Guide
export const FINERENONE_SCENARIOS: FinerenoneScenario[] = [
  {
    clinicalScenario: 'HF with LVEF >=40%; label criteria reviewed',
    suggestedApproach: 'Evaluate current finerenone label and patient context',
    rationale: 'FDA-labeled indication added in 2025; verify potassium, eGFR, interactions, dose, and monitoring in the current label',
  },
  {
    clinicalScenario: 'History of hyperkalemia on MRA',
    suggestedApproach: 'No automatic preference; reassess risk and monitoring',
    rationale: 'Finerenone can also cause hyperkalemia; use current labeling and individualized clinical review',
  },
  {
    clinicalScenario: 'Significant cost barrier',
    suggestedApproach: 'Spironolactone',
    rationale: '~$4/month generic vs. ~$500/month',
  },
  {
    clinicalScenario: 'HFrEF',
    suggestedApproach: 'Use guideline-directed HFrEF MRA selection',
    rationale: 'Do not use this tool to substitute finerenone for established steroidal MRA therapy in HFrEF',
  },
  {
    clinicalScenario: 'Uncertain, guideline-adherent approach',
    suggestedApproach: 'Verify current label and heart-failure guideline',
    rationale: 'Indication, phenotype, renal function, potassium, interactions, access, and monitoring all matter',
  },
];

export const FINERENONE_FDA_LABEL_URL =
  'https://www.accessdata.fda.gov/drugsatfda_docs/label/2025/215341s009lbl.pdf';

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
