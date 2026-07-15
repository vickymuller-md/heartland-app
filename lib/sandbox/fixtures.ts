export type SandboxPriority = 'now' | 'today' | 'week';

export interface SandboxTask {
  id: string;
  patientId: string;
  patientName: string;
  title: string;
  reason: string;
  signal: string;
  priority: SandboxPriority;
  severity: 'critical' | 'warning' | 'informational';
  dueLabel: string;
  occurrences: number;
}

export interface SandboxPatient {
  id: string;
  name: string;
  age: number;
  region: string;
  riskTier: 'High' | 'Moderate';
  latestSignal: string;
  dataAsOf: string;
}

export const SANDBOX_TASKS: SandboxTask[] = [
  {
    id: 'task-1',
    patientId: 'demo-maria',
    patientName: 'Maria Santos',
    title: 'Review persistent weight signal',
    reason: 'Weight increased 4.2 lb over 3 days; symptom check-in reports increased dyspnea.',
    signal: 'Persistent for 3 days · worsened twice',
    priority: 'now',
    severity: 'critical',
    dueLabel: 'Due now',
    occurrences: 4,
  },
  {
    id: 'task-2',
    patientId: 'demo-james',
    patientName: 'James Walker',
    title: 'Medication follow-up',
    reason: 'Scheduled tolerability follow-up after documented therapy change.',
    signal: 'One scheduled follow-up',
    priority: 'today',
    severity: 'warning',
    dueLabel: 'Due today · 2:00 PM',
    occurrences: 1,
  },
  {
    id: 'task-3',
    patientId: 'demo-lee',
    patientName: 'Robert Lee',
    title: 'Review missing check-in',
    reason: 'No monitoring entry recorded for 72 hours on the assigned track.',
    signal: 'Persistent for 72 hours',
    priority: 'today',
    severity: 'warning',
    dueLabel: 'Due today · 4:00 PM',
    occurrences: 3,
  },
  {
    id: 'task-4',
    patientId: 'demo-maria',
    patientName: 'Maria Santos',
    title: 'Prepare weekly care-team review',
    reason: 'Summarize recent monitoring signals and completed follow-up outcomes.',
    signal: 'Weekly workflow',
    priority: 'week',
    severity: 'informational',
    dueLabel: 'Due Friday',
    occurrences: 1,
  },
  {
    id: 'task-5',
    patientId: 'demo-james',
    patientName: 'James Walker',
    title: 'Confirm education teach-back',
    reason: 'Education module is complete; teach-back outcome remains undocumented.',
    signal: 'One open outcome',
    priority: 'week',
    severity: 'informational',
    dueLabel: 'Due in 4 days',
    occurrences: 1,
  },
];
export const SANDBOX_PATIENTS: SandboxPatient[] = [
  {
    id: 'demo-maria',
    name: 'Maria Santos',
    age: 68,
    region: 'Synthetic rural clinic',
    riskTier: 'High',
    latestSignal: 'Weight +4.2 lb / 3 days',
    dataAsOf: 'Synthetic data · refreshed today',
  },
  {
    id: 'demo-james',
    name: 'James Walker',
    age: 72,
    region: 'Synthetic critical access hospital',
    riskTier: 'Moderate',
    latestSignal: 'Follow-up due today',
    dataAsOf: 'Synthetic data · refreshed today',
  },
  {
    id: 'demo-lee',
    name: 'Robert Lee',
    age: 64,
    region: 'Synthetic FQHC',
    riskTier: 'Moderate',
    latestSignal: 'No check-in for 72 hours',
    dataAsOf: 'Synthetic data · refreshed today',
  },
];
