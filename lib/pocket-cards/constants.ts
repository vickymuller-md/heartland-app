/**
 * Pocket Card Library -- Constants
 *
 * All 10 HEARTLAND Protocol pocket cards with metadata, organized by
 * the 8 protocol modules. Card-to-module mapping from reference/README.md.
 */

import type { CardModule, PocketCard } from './types';

// ---------------------------------------------------------------------------
// 8 Protocol Modules
// ---------------------------------------------------------------------------

export const MODULES: CardModule[] = [
  {
    number: 1,
    name: 'Risk Stratification',
    description: 'CKM staging and HEARTLAND Risk Score',
  },
  {
    number: 2,
    name: 'GDMT Optimization',
    description: 'Medication pathways and financial navigation',
  },
  {
    number: 3,
    name: 'Telephone Titration',
    description: 'Safety gates and red flag criteria',
  },
  {
    number: 4,
    name: 'Discharge Education',
    description: 'Teach-back checklists and education',
  },
  {
    number: 5,
    name: 'Remote Monitoring',
    description: 'Track assignment and patient diary',
  },
  {
    number: 6,
    name: 'Comorbidity Management',
    description: 'Multi-condition quick reference',
  },
  {
    number: 7,
    name: 'Care Coordination',
    description: 'SBAR handoff and PCP communication',
  },
  {
    number: 8,
    name: 'Implementation',
    description: 'Tier summary and resource requirements',
  },
];

// Helper to look up a module by number
function getModule(num: number): CardModule {
  const mod = MODULES.find((m) => m.number === num);
  if (!mod) throw new Error(`Module ${num} not found`);
  return mod;
}

// ---------------------------------------------------------------------------
// 10 Pocket Cards -- mapped to modules per reference/README.md
// ---------------------------------------------------------------------------

export const POCKET_CARDS: PocketCard[] = [
  {
    id: 'gdmt-pocket-card',
    figureNumber: 1,
    title: 'GDMT Optimization Quick Reference',
    module: getModule(2),
    fileName: '01_Pocket_Card_GDMT.jpg',
    src: '/figures/01_Pocket_Card_GDMT.jpg',
    alt: 'Pocket card summarizing guideline-directed medical therapy (GDMT) optimization for HFrEF and HFpEF, including quadruple therapy agents, starting doses, target doses, and safety gates.',
    width: 800,
    height: 450,
  },
  {
    id: 'red-flags-pocket-card',
    figureNumber: 2,
    title: 'Clinical Red Flags & Safety Gates',
    module: getModule(3),
    fileName: '02_Pocket_Card_Red_Flags.jpg',
    src: '/figures/02_Pocket_Card_Red_Flags.jpg',
    alt: 'Pocket card listing clinical red flags and safety gates for telephone titration, including vital sign thresholds, renal function cutoffs, and potassium monitoring criteria.',
    width: 800,
    height: 450,
  },
  {
    id: 'patient-daily-diary',
    figureNumber: 3,
    title: 'Patient Daily Diary',
    module: getModule(5),
    fileName: '03_Patient_Daily_Diary.jpg',
    src: '/figures/03_Patient_Daily_Diary.jpg',
    alt: 'Patient self-monitoring daily diary for heart failure, including fields for daily weight, blood pressure, heart rate, symptoms, fluid intake, and medication adherence.',
    width: 800,
    height: 450,
  },
  {
    id: 'track-assignment-form',
    figureNumber: 4,
    title: 'Track Assignment Form',
    module: getModule(5),
    fileName: '04_Track_Assignment_Form.jpg',
    src: '/figures/04_Track_Assignment_Form.jpg',
    alt: 'Remote monitoring track assignment form for determining digital vs analog monitoring track based on broadband availability, patient technology literacy, and device access.',
    width: 800,
    height: 450,
  },
  {
    id: 'financial-navigation-tracker',
    figureNumber: 5,
    title: 'Financial Navigation Tracker',
    module: getModule(2),
    fileName: '05_Financial_Navigation_Tracker.jpg',
    src: '/figures/05_Financial_Navigation_Tracker.jpg',
    alt: 'Financial navigation tracker for heart failure medications, including 340B eligibility, patient assistance programs (PAP), generic substitution options, and the Generic Bridge pathway.',
    width: 800,
    height: 450,
  },
  {
    id: 'risk-score-reference',
    figureNumber: 6,
    title: 'Risk Score Reference Card',
    module: getModule(1),
    fileName: '06_Risk_Score_Reference.jpg',
    src: '/figures/06_Risk_Score_Reference.jpg',
    alt: 'HEARTLAND Risk Score reference card showing 10 binary clinical variables, point weights, tier thresholds (Low 0-4, Moderate 5-8, High 9+), and recommended care pathways per tier.',
    width: 800,
    height: 450,
  },
  {
    id: 'implementation-tiers-summary',
    figureNumber: 7,
    title: 'Implementation Tiers Summary',
    module: getModule(8),
    fileName: '07_Implementation_Tiers_Summary.jpg',
    src: '/figures/07_Implementation_Tiers_Summary.jpg',
    alt: 'Implementation tiers summary showing Tier 1 (Minimal), Tier 2 (Standard), and Tier 3 (Advanced) resource requirements across staffing, technology, pharmacy, CHW, and monitoring capabilities.',
    width: 800,
    height: 450,
  },
  {
    id: 'sbar-handoff-template',
    figureNumber: 8,
    title: 'SBAR Handoff Template',
    module: getModule(7),
    fileName: '08_SBAR_Handoff_Template.jpg',
    src: '/figures/08_SBAR_Handoff_Template.jpg',
    alt: 'Structured SBAR (Situation, Background, Assessment, Recommendation) handoff template for primary care communication during heart failure care transitions.',
    width: 800,
    height: 450,
  },
  {
    id: 'teachback-checklist',
    figureNumber: 9,
    title: 'Teach-Back Checklist',
    module: getModule(4),
    fileName: '09_TeachBack_Checklist.jpg',
    src: '/figures/09_TeachBack_Checklist.jpg',
    alt: 'Patient discharge education teach-back checklist covering medication understanding, daily monitoring routine, dietary restrictions, activity guidelines, and when to call the provider.',
    width: 800,
    height: 450,
  },
  {
    id: 'comorbidity-quick-reference',
    figureNumber: 10,
    title: 'Comorbidity Quick Reference',
    module: getModule(6),
    fileName: '10_Comorbidity_Quick_Reference.jpg',
    src: '/figures/10_Comorbidity_Quick_Reference.jpg',
    alt: 'Comorbidity management quick reference for heart failure patients with concurrent diabetes, chronic kidney disease, atrial fibrillation, and depression.',
    width: 800,
    height: 450,
  },
];

// ---------------------------------------------------------------------------
// Cards grouped by module (only modules that have cards)
// ---------------------------------------------------------------------------

export const CARDS_BY_MODULE = MODULES.map((mod) => ({
  module: mod,
  cards: POCKET_CARDS.filter((c) => c.module.number === mod.number),
})).filter((group) => group.cards.length > 0);
