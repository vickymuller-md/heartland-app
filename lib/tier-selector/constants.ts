/**
 * Implementation Tier Selector -- Clinical Constants
 *
 * ALL data sourced from reference/clinical_content.md Module 8.
 * Every value character-for-character from protocol v3.3.
 */

import type {
  TierLevel,
  CategoryDefinition,
  QualityMetric,
  ASMReadinessItem,
} from './types';

// ==========================================================================
// Tier Labels -- Display names for each tier level
// ==========================================================================
export const TIER_LABELS: Record<TierLevel, string> = {
  1: 'Tier 1 (Minimal)',
  2: 'Tier 2 (Standard)',
  3: 'Tier 3 (Advanced)',
};

// ==========================================================================
// Tier Colors -- Tailwind CSS classes for visual differentiation
// Amber = Tier 1 (caution/minimal), Blue = Tier 2 (standard), Emerald = Tier 3 (advanced)
// ==========================================================================
export const TIER_COLORS: Record<
  TierLevel,
  { badge: string; bg: string; border: string; text: string }
> = {
  1: {
    badge: 'bg-amber-100 text-amber-800 border-amber-300',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    text: 'text-amber-700',
  },
  2: {
    badge: 'bg-blue-100 text-blue-800 border-blue-300',
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    text: 'text-blue-700',
  },
  3: {
    badge: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    text: 'text-emerald-700',
  },
};

// ==========================================================================
// Category Definitions -- 8 protocol components with 3 tiers each
// Source: reference/clinical_content.md Module 8, Section 8.2 (Table 2)
// ==========================================================================
export const CATEGORY_DEFINITIONS: CategoryDefinition[] = [
  {
    id: 'risk-stratification',
    label: 'Risk Stratification',
    description:
      'How does your facility assess heart failure risk at discharge?',
    protocolComponent: 'Module 1',
    levels: {
      1: {
        label: 'Score at discharge',
        description:
          'Basic risk scoring at discharge using available clinical variables. Minimal additional assessment tools.',
        upgradeAction:
          'Add CKM staging to discharge assessment for comprehensive risk profiling.',
      },
      2: {
        label: 'Full CKM + Score',
        description:
          'Full CKM staging integrated with HEARTLAND risk score. Comprehensive assessment at discharge.',
        upgradeAction:
          'Implement automated scoring within EHR to reduce provider burden.',
      },
      3: {
        label: 'Full CKM + Score',
        description:
          'Full CKM staging integrated with HEARTLAND risk score. Automated calculation and workflow support.',
        upgradeAction: '',
      },
    },
  },
  {
    id: 'gdmt',
    label: 'GDMT',
    description:
      "What is your facility's approach to guideline-directed medical therapy optimization?",
    protocolComponent: 'Module 2',
    levels: {
      1: {
        label: '\u22652 classes, prioritize SGLT2i + BB',
        description:
          'Initiate at least 2 GDMT classes before discharge, prioritizing SGLT2i and beta-blocker.',
        upgradeAction:
          'Target all 4 GDMT classes within 14 days using structured titration protocol.',
      },
      2: {
        label: 'Target all classes in 14 days',
        description:
          'Target initiation of all GDMT classes within 14 days of discharge using structured titration.',
        upgradeAction:
          'Implement rapid-sequence GDMT optimization per STRONG-HF methodology.',
      },
      3: {
        label: 'Rapid sequence per STRONG-HF',
        description:
          'Rapid-sequence GDMT titration based on STRONG-HF trial methodology with intensive monitoring.',
        upgradeAction: '',
      },
    },
  },
  {
    id: 'monitoring',
    label: 'Monitoring',
    description:
      'What remote monitoring capabilities does your facility have?',
    protocolComponent: 'Module 5',
    levels: {
      1: {
        label: 'Track B (Analog)',
        description:
          'Analog monitoring: paper diary, standard devices (scale, BP cuff), telephone check-ins.',
        upgradeAction:
          'Add digital track option for patients with smartphone access (dual-track model).',
      },
      2: {
        label: 'Dual-track (Digital + Analog)',
        description:
          'Dual-track monitoring: digital app-based monitoring for eligible patients, analog track for others.',
        upgradeAction:
          'Implement automated alerts and Track A with continuous remote monitoring.',
      },
      3: {
        label: 'Track A with automated alerts',
        description:
          'Full digital monitoring with automated alert thresholds, remote data transmission, and real-time dashboards.',
        upgradeAction: '',
      },
    },
  },
  {
    id: 'discharge-education',
    label: 'Discharge Education',
    description:
      'How does your facility deliver discharge education to HF patients?',
    protocolComponent: 'Module 4',
    levels: {
      1: {
        label: 'Condensed teach-back (3 domains)',
        description:
          'Condensed teach-back covering 3 essential domains: medications, daily weight, and when to call.',
        upgradeAction:
          'Expand to full 8-domain teach-back protocol with documentation.',
      },
      2: {
        label: 'Full teach-back (8 domains)',
        description:
          'Full teach-back across all 8 educational domains with structured documentation and competency verification.',
        upgradeAction:
          'Add CHW reinforcement for education retention and ongoing support.',
      },
      3: {
        label: 'Full + CHW reinforcement',
        description:
          'Full 8-domain teach-back with CHW reinforcement visits for education retention and behavior change support.',
        upgradeAction: '',
      },
    },
  },
  {
    id: 'follow-up',
    label: 'Follow-up',
    description:
      'What is your post-discharge follow-up schedule for HF patients?',
    protocolComponent: 'Module 3',
    levels: {
      1: {
        label: '48-72h call, 14-day visit',
        description:
          'Initial telephone contact at 48-72 hours post-discharge with follow-up office visit within 14 days.',
        upgradeAction:
          'Shorten to 48h call with 7-day visit and weekly follow-up for 4 weeks.',
      },
      2: {
        label: '48h call, 7-day visit, weekly \u00d74',
        description:
          '48-hour telephone call, 7-day office visit, and weekly follow-up contacts for 4 weeks.',
        upgradeAction:
          'Extend weekly follow-up beyond 4 weeks with flexible scheduling.',
      },
      3: {
        label: '48h call, 7-day visit, weekly \u00d74+',
        description:
          '48-hour telephone call, 7-day office visit, weekly follow-up for 4+ weeks with flexible extension.',
        upgradeAction: '',
      },
    },
  },
  {
    id: 'staffing',
    label: 'Staffing',
    description:
      'What staffing model supports your HF program?',
    protocolComponent: 'Module 8',
    levels: {
      1: {
        label: 'RN/MA + physician (MD)',
        description:
          'Core clinical team: registered nurse or medical assistant partnered with physician for HF management.',
        upgradeAction:
          'Add dedicated RN champion and pharmacist (PharmD) for medication management.',
      },
      2: {
        label: 'RN champion, MA, PharmD',
        description:
          'Dedicated RN champion leading HF program with medical assistant and pharmacist support.',
        upgradeAction:
          'Add RN coordinator role and community health worker to complete the team.',
      },
      3: {
        label: 'RN coordinator, PharmD, CHW',
        description:
          'Full interdisciplinary team: RN coordinator, pharmacist, and community health worker with defined roles.',
        upgradeAction: '',
      },
    },
  },
  {
    id: 'chw',
    label: 'CHW',
    description:
      'How does your facility integrate community health workers into HF care?',
    protocolComponent: 'Module 8',
    levels: {
      1: {
        label: 'Alternative/Family',
        description:
          'CHW role filled by alternative support: family members, volunteers, or existing staff with CHW training.',
        upgradeAction:
          'Engage trained CHW for high-risk patients with identified social barriers.',
      },
      2: {
        label: 'High-risk only',
        description:
          'Trained community health worker assigned to high-risk patients with identified social determinant barriers.',
        upgradeAction:
          'Integrate CHW as full team member across all risk levels.',
      },
      3: {
        label: 'Integrated team member',
        description:
          'CHW fully integrated into the care team with defined responsibilities, training, and documentation access.',
        upgradeAction: '',
      },
    },
  },
  {
    id: 'financial',
    label: 'Financial',
    description:
      'What financial navigation support does your facility provide for HF medications?',
    protocolComponent: 'Module 6',
    levels: {
      1: {
        label: 'Generic Bridge',
        description:
          'Generic Bridge pathway: prioritize generic medications to achieve ~$15/month total GDMT cost.',
        upgradeAction:
          'Add patient assistance program (PAP) pursuit to supplement Generic Bridge.',
      },
      2: {
        label: 'PAP pursuit + Generic Bridge',
        description:
          'Patient assistance programs actively pursued alongside Generic Bridge for maximum cost reduction.',
        upgradeAction:
          'Add full navigation with 340B pricing and comprehensive financial support.',
      },
      3: {
        label: 'Full navigation + 340B + PAP',
        description:
          'Comprehensive financial navigation: 340B pricing (if eligible), patient assistance programs, and Generic Bridge.',
        upgradeAction: '',
      },
    },
  },
];

// ==========================================================================
// Quality Metrics -- 5 performance targets by tier
// Source: reference/clinical_content.md Module 8, Section 8.1
// ==========================================================================
export const QUALITY_METRICS: QualityMetric[] = [
  {
    // Source: "48-72h post-discharge contact | >70% | >90%"
    name: '48-72h post-discharge contact',
    tier1Target: '>70%',
    tier23Target: '>90%',
  },
  {
    // Source: ">=2 GDMT classes at discharge (HFrEF) | >60% | >80%"
    name: '\u22652 GDMT classes at discharge (HFrEF)',
    tier1Target: '>60%',
    tier23Target: '>80%',
  },
  {
    // Source: "7-day follow-up attendance | >60% | >85%"
    name: '7-day follow-up attendance',
    tier1Target: '>60%',
    tier23Target: '>85%',
  },
  {
    // Source: "30-day readmission rate | Improvement from baseline | <15%"
    name: '30-day readmission rate',
    tier1Target: 'Improvement from baseline',
    tier23Target: '<15%',
  },
  {
    // Source: "Teach-back documentation | >70% | >90%"
    name: 'Teach-back documentation',
    tier1Target: '>70%',
    tier23Target: '>90%',
  },
];

// ==========================================================================
// ASM 2027 Readiness -- 6 preparatory items
// Source: reference/clinical_content.md Module 8, Section 8.3
// ==========================================================================
export const ASM_READINESS_ITEMS: ASMReadinessItem[] = [
  {
    id: 'cms-register',
    label: 'Register for CMS Innovation Center updates',
    description:
      'Sign up for CMS Innovation Center notifications to track ASM 2027 mandatory model timeline, requirements, and participation deadlines.',
  },
  {
    id: 'baseline-metrics',
    label: 'Establish baseline quality metrics',
    description:
      'Document current performance on 5 key HF metrics (post-discharge contact rate, GDMT utilization, follow-up attendance, readmission rate, teach-back completion) to measure improvement.',
  },
  {
    id: 'gdmt-optimization',
    label: 'Implement structured GDMT optimization',
    description:
      'Adopt a standardized protocol for GDMT initiation and titration, tracking the percentage of eligible patients on target doses of all 4 medication classes.',
  },
  {
    id: 'telehealth',
    label: 'Document telehealth capabilities',
    description:
      'Inventory current telehealth infrastructure including video visit platforms, remote monitoring devices, and patient connectivity. Document billing workflows for RPM codes (CPT 99453-99458).',
  },
  {
    id: 'hrrp-review',
    label: 'Review HRRP readmission history',
    description:
      'Analyze Hospital Readmissions Reduction Program (HRRP) data to identify trends, high-risk patient populations, and opportunities for targeted intervention.',
  },
  {
    id: 'teleconsult',
    label: 'Establish specialist teleconsult relationships',
    description:
      'Develop formal or informal teleconsultation agreements with cardiologists and HF specialists for complex case review, bridging the rural specialist access gap.',
  },
];
