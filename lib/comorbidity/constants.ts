// Phase 17: Comorbidity Manager constants
// Source: HEARTLAND Protocol Module 6, Table 3

import type { ComorbidityDetail } from './types';

export const COMORBIDITY_DATA: ComorbidityDetail[] = [
  {
    key: 'afib',
    label: 'Atrial Fibrillation',
    keyConsiderations: 'Rate vs rhythm control decision required',
    whatToDo: 'Rate control, anticoagulation',
    gdmtInteractions: [
      'Beta-blockers (GDMT) provide rate control — do not discontinue',
      'Digoxin may be added for rate control if BB insufficient',
      'Anticoagulation (warfarin/DOAC) required — separate from GDMT',
    ],
  },
  {
    key: 'osa',
    label: 'Obstructive Sleep Apnea',
    keyConsiderations: 'Prevalent in HFpEF; untreated OSA worsens HF',
    whatToDo: 'Screen with STOP-BANG, prescribe CPAP',
    gdmtInteractions: [
      'CPAP compliance may improve HF symptoms independent of GDMT',
      'No direct GDMT interactions; address OSA as parallel therapy',
    ],
  },
  {
    key: 'iron_deficiency',
    label: 'Iron Deficiency',
    keyConsiderations:
      'Worsens HF symptoms; defined as ferritin <100 or ferritin 100-299 with TSAT <20%',
    whatToDo:
      'Check ferritin/TSAT; administer IV iron (ferric carboxymaltose)',
    gdmtInteractions: [
      'IV iron (AFFIRM-AHF evidence) reduces HF hospitalizations independently of GDMT',
      'No contraindications with standard GDMT quadruple therapy',
    ],
  },
  {
    key: 'diabetes',
    label: 'Diabetes',
    keyConsiderations:
      'SGLT2i counts as dual therapy for both HF and diabetes',
    whatToDo:
      'SGLT2i first-line, add metformin, consider GLP-1 RA (liraglutide/semaglutide)',
    gdmtInteractions: [
      'SGLT2i (GDMT for HFrEF/HFpEF) is also first-line diabetes therapy — dual benefit',
      'Avoid TZDs (fluid retention worsens HF)',
      'Avoid sulfonylureas where possible (hypoglycemia risk)',
      'GLP-1 RA: emerging benefit in HFpEF (STEP-HFpEF); neutral in HFrEF',
    ],
  },
  {
    key: 'ckd',
    label: 'Chronic Kidney Disease',
    keyConsiderations:
      'Limits GDMT dosing; hyperkalemia risk with MRA/ARNI',
    whatToDo:
      'Adjust doses per eGFR, monitor K+ closely, and select MRA therapy from current indication, guideline, and patient context',
    gdmtInteractions: [
      'ARNI: use cautiously if eGFR <30; hold if eGFR <20',
      'MRA therapy: apply agent-specific current labeling/guidelines; finerenone is not automatically preferred by eGFR alone',
      'SGLT2i: minimum eGFR 20 for HF indication (not glycemic control)',
      'Beta-blocker: no dose adjustment needed for CKD',
      'Monitor BMP 1-2 weeks after any GDMT change',
    ],
  },
  {
    key: 'copd',
    label: 'COPD',
    keyConsiderations:
      'Beta-blocker concerns are overstated; cardioselective BBs are safe',
    whatToDo:
      'Use cardioselective beta-blocker (metoprolol succinate, bisoprolol); avoid non-selective BBs',
    gdmtInteractions: [
      'Metoprolol succinate and bisoprolol are safe in COPD — do not withhold',
      'Avoid carvedilol (non-selective) if significant COPD/bronchospasm',
      'Inhaled beta-2 agonists (COPD therapy) may cause tachycardia — beta-blocker titration may need to account for this',
    ],
  },
  {
    key: 'depression',
    label: 'Depression',
    keyConsiderations:
      'Affects medication adherence and self-care behaviors',
    whatToDo:
      'Screen with PHQ-9; SSRIs are safe in HF; refer to behavioral health if PHQ-9 >=10',
    gdmtInteractions: [
      'SSRIs (sertraline, escitalopram) are safe with all GDMT classes',
      'Avoid TCAs (QT prolongation risk, anticholinergic effects)',
      'SNRIs acceptable; venlafaxine may increase BP slightly — monitor',
    ],
  },
  {
    key: 'hypertension',
    label: 'Hypertension',
    keyConsiderations:
      'GDMT treats both HF and hypertension — avoid double-counting or over-treating',
    whatToDo:
      'GDMT (ARNI/ACEi/ARB + BB + MRA) effectively lowers BP; adjust non-HF antihypertensives',
    gdmtInteractions: [
      'ARNI/ACEi/ARB and beta-blockers are first-line antihypertensives that overlap with GDMT',
      'May be able to discontinue separate antihypertensive medications as GDMT is optimized',
      'Monitor SBP closely during GDMT uptitration — hold uptitration if SBP <90',
      'Dihydropyridine CCBs (amlodipine) are safe add-on for HTN in HF; non-DHPs (verapamil, diltiazem) are contraindicated in HFrEF',
    ],
  },
];
