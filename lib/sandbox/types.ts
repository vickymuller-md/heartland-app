export type SandboxSectionId =
  | 'command'
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
  savedAt: number;
}
