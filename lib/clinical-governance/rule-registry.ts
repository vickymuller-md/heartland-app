export type ClinicalReviewStatus = 'pending_independent_review' | 'approved' | 'retired';

export interface ClinicalRuleSet {
  id: string;
  name: string;
  version: string;
  source: string;
  implementation: readonly string[];
  ownerRole: string;
  reviewStatus: ClinicalReviewStatus;
  releaseBoundary: string;
}

/**
 * Release-control registry for rule sets that can influence prioritization or
 * care workflow. A human clinical reviewer is the only actor allowed to move a
 * rule set to `approved`; code deployment alone never satisfies this gate.
 */
export const CLINICAL_RULE_REGISTRY: readonly ClinicalRuleSet[] = [
  {
    id: 'heartland-risk-framework',
    name: 'HEARTLAND proposed risk framework',
    version: 'protocol-v3.3-app-2026-07',
    source: 'HEARTLAND Protocol v3.3, Module 1; proposed framework, not externally validated',
    implementation: ['lib/risk-score/constants.ts', 'lib/risk-score/engine.ts'],
    ownerRole: 'Clinical Safety Lead (appointment required)',
    reviewStatus: 'pending_independent_review',
    releaseBoundary: 'Educational/synthetic use only; must not determine care autonomously.',
  },
  {
    id: 'remote-monitoring-alerts',
    name: 'Remote monitoring and proactive alert rules',
    version: 'protocol-v3.3-module-5.2-2026-07',
    source: 'HEARTLAND Protocol v3.3, Module 5.2',
    implementation: [
      'lib/vitals/constants.ts',
      'lib/vitals/red-flags.ts',
      'lib/dashboard/alert-engine.ts',
    ],
    ownerRole: 'Clinical Safety Lead (appointment required)',
    reviewStatus: 'pending_independent_review',
    releaseBoundary: 'Silent-mode validation and escalation testing required before PHI pilot.',
  },
  {
    id: 'gdmt-pathways',
    name: 'GDMT pathway and medication evidence labels',
    version: 'content-review-2026-07',
    source: '2022 AHA/ACC/HFSA guideline plus cited trial/label context in implementation',
    implementation: ['lib/gdmt/constants.ts', 'lib/gdmt/evidence-levels.ts'],
    ownerRole: 'HF Pharmacotherapy Reviewer (appointment required)',
    reviewStatus: 'pending_independent_review',
    releaseBoundary: 'Decision support only; current label, labs, contraindications, and judgment govern.',
  },
  {
    id: 'titration-safety-gates',
    name: 'Telephone titration safety gates',
    version: 'protocol-v3.3-2026-07',
    source: 'HEARTLAND Protocol v3.3, Modules 2–3; guideline context in implementation',
    implementation: ['lib/titration/constants.ts', 'lib/titration/engine.ts'],
    ownerRole: 'Clinical Safety Lead (appointment required)',
    reviewStatus: 'pending_independent_review',
    releaseBoundary: 'No autonomous dose change; provider review and escalation always required.',
  },
  {
    id: 'discharge-followup',
    name: 'Discharge bundle and follow-up cadence',
    version: 'protocol-v3.3-module-4-2026-07',
    source: 'HEARTLAND Protocol v3.3, Module 4',
    implementation: ['lib/discharge/constants.ts', 'lib/discharge/engine.ts'],
    ownerRole: 'Transitions-of-Care Reviewer (appointment required)',
    reviewStatus: 'pending_independent_review',
    releaseBoundary: 'Facility staffing, contact ownership, and degraded workflow must be accepted.',
  },
  {
    id: 'ai-outreach-structuring',
    name: 'AI-assisted check-in conversation structuring',
    version: 'app-2026-08',
    source: 'HEARTLAND Protocol v3.3, Module 5.2; LLM structures conversation only',
    implementation: [
      'lib/sandbox-ai/engine.ts',
      'lib/sandbox-ai/script.ts',
      'lib/sandbox-ai/prompt.ts',
    ],
    ownerRole: 'Clinical Safety Lead (appointment required)',
    reviewStatus: 'pending_independent_review',
    releaseBoundary:
      'Synthetic demonstration only; AI structures conversation and never determines escalation; deterministic red-flag rules govern.',
  },
  {
    id: 'ckm-classification',
    name: 'Cardiovascular-kidney-metabolic stage classification',
    version: 'aha-advisory-app-2026-07',
    source: 'AHA 2023 CKM Health Presidential Advisory as represented in HEARTLAND Protocol v3.3',
    implementation: ['lib/ckm/engine.ts'],
    ownerRole: 'Clinical Safety Lead (appointment required)',
    reviewStatus: 'pending_independent_review',
    releaseBoundary: 'Classification support only; not a diagnosis or substitute for source criteria.',
  },
] as const;

export const unapprovedClinicalRuleSets = CLINICAL_RULE_REGISTRY.filter(
  (ruleSet) => ruleSet.reviewStatus !== 'approved',
);
