import type { CkmInput } from '@/lib/ckm/types';
import type { TrackAssessment } from '@/lib/remote-monitoring/types';
import type { RiskInput } from '@/lib/risk-score/types';
import type { TierLevel } from '@/lib/tier-selector/types';
import type { SymptomSeverity } from '@/lib/vitals/types';

export type SandboxSectionId =
  | 'command'
  | 'copilot'
  | 'daily-loop'
  | 'outreach'
  | 'patient-360'
  | 'pathways'
  | 'coordination'
  | 'patient-view'
  | 'impact';

export type SandboxPriority = 'now' | 'today' | 'week' | 'watching';
export type SandboxSeverity = 'critical' | 'warning' | 'informational';
export type SandboxTaskStatus = 'open' | 'reviewed' | 'actioned' | 'awaiting' | 'closed';

export interface SandboxTask {
  id: string;
  patientId: string;
  patientName: string;
  title: string;
  reason: string;
  signal: string;
  priority: SandboxPriority;
  severity: SandboxSeverity;
  dueLabel: string;
  occurrences: number;
  owner: string;
  source: string;
  suggestedAction: string;
}

export interface SandboxVitalPoint {
  label: string;
  weight: number;
  sbp: number;
  heartRate: number;
  spo2: number;
}

export interface SandboxLab {
  name: string;
  value: string;
  collected: string;
  status: 'within range' | 'watch' | 'missing';
}

export interface SandboxMedication {
  name: string;
  therapyClass: string;
  dose: string;
  status: 'active' | 'titration due' | 'documented gap';
  note: string;
}

export interface SandboxTimelineEvent {
  id: string;
  when: string;
  type: 'signal' | 'contact' | 'medication' | 'lab' | 'education' | 'follow-up';
  title: string;
  detail: string;
  outcome?: string;
}

/** One structured symptom set as reported in a day's check-in. */
export interface SandboxDaySymptoms {
  dyspnea: SymptomSeverity;
  edema: SymptomSeverity;
  orthopnea: boolean;
  fatigue: SymptomSeverity;
  chestPainOrSyncope: boolean;
  adherence: 'yes' | 'missed_some' | 'no';
}

export interface SandboxLabValue {
  value: number;
  collectedDaysAgo: number;
}

/** Labs as known on a given day; collectedDaysAgo encodes carry-forward staleness. */
export interface SandboxDayLabs {
  potassium: SandboxLabValue;
  creatinine: SandboxLabValue;
  egfr: SandboxLabValue | null;
}

/**
 * One pre-authored day of the longitudinal arc. vitals/symptoms are null when
 * no check-in reached the clinic that day (analog-track gaps) — engines must
 * not run on fabricated values.
 */
export interface SandboxDay {
  dayIndex: number;
  dayLabel: string;
  checkInReceived: boolean;
  vitals: SandboxVitalPoint | null;
  symptoms: SandboxDaySymptoms | null;
  labs: SandboxDayLabs;
  narrative: string;
}

/**
 * Raw inputs for the deterministic engines, invariant across the 5-day arc.
 * A consistency test asserts engine(inputs) matches the display fields
 * (riskTier, ckmStage, track, facilityTier) so the two can never drift.
 */
export interface SandboxEngineInputs {
  risk: RiskInput;
  ckm: CkmInput;
  connectivity: TrackAssessment;
  facilityLevels: Record<string, TierLevel>;
  comorbidity: {
    lvef: number;
    lbbb: boolean;
    qrsMs: number;
    gdmtDurationMonths: number;
    hfHospitalizationsLast12m: number;
  };
  creatinineBaselineMgDl: number;
  dischargedDaysAgo: number | null;
}

export interface SandboxPatient {
  id: string;
  name: string;
  age: number;
  pronouns: string;
  region: string;
  distanceToCardiology: string;
  riskTier: 'High' | 'Moderate';
  ckmStage: string;
  track: string;
  facilityTier: string;
  sourceFreshness: string;
  latestSignal: string;
  changeSummary: string;
  symptoms: string[];
  missingData: string[];
  vitals: SandboxVitalPoint[];
  labs: SandboxLab[];
  medications: SandboxMedication[];
  timeline: SandboxTimelineEvent[];
  carePlan: string[];
  education: { completed: number; total: number; next: string };
  access: string[];
  /** Weight points before Day 1, as day offsets from Day 1 (red-flag trend windows). */
  baselineHistory: Array<{ weightLbs: number; daysAgoAtD0: number }>;
  /** Pre-authored 5-day longitudinal arc; index 0 is the legacy "today" snapshot. */
  days: SandboxDay[];
  engineInputs: SandboxEngineInputs;
}

export interface SandboxPathway {
  id: string;
  module: string;
  title: string;
  description: string;
  href: string;
  evidence: 'Established' | 'Emerging' | 'Pragmatic' | 'Proposed';
  scenarioUse: string;
  steps: string[];
}

export interface SandboxTeamMember {
  id: string;
  name: string;
  role: string;
  workload: number;
  overdue: number;
  coverage: string;
}

export interface SandboxTaskState {
  status: SandboxTaskStatus;
  owner: string;
  outcome?: string;
  updatedLabel: string;
}

/** Persisted record of one live simulated outreach call (metadata only; transcripts are session-local). */
export interface AiOutreachRun {
  id: string;
  patientName: string;
  disposition: 'emergency' | 'escalated' | 'routine' | 'no_answer';
  redFlagIds: string[];
  atLabel: string;
  /** Simulation day the run belongs to; day queues filter on it (legacy runs restore as 0). */
  dayIndex: number;
}

/** Summary of one completed simulation day, kept for the multi-day impact metrics. */
export interface SandboxDayLogEntry {
  dayIndex: number;
  escalations: number;
  completedAtLabel: string;
}

export interface SandboxDemoState {
  taskStates: Record<string, SandboxTaskState>;
  selectedPatientId: string;
  selectedSection: SandboxSectionId;
  visitedSections: SandboxSectionId[];
  exploredPathways: string[];
  patientCheckIns: string[];
  documentedActions: string[];
  aiOutreachRuns: AiOutreachRun[];
  dayIndex: number;
  dayLog: SandboxDayLogEntry[];
  /** Size of the synthetic population scene on the Command Center. */
  populationSize: 500 | 2500 | 5000;
  savedAt: number;
}
