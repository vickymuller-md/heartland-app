import type {
  SandboxPatient,
  SandboxPathway,
  SandboxSectionId,
  SandboxTask,
  SandboxTeamMember,
} from './types';

export const SANDBOX_SECTIONS: Array<{
  id: SandboxSectionId;
  shortLabel: string;
  title: string;
  description: string;
}> = [
  { id: 'command', shortLabel: 'Start', title: 'Command Center', description: 'Product map, synthetic scenario, and guided tour.' },
  { id: 'daily-loop', shortLabel: 'Daily Loop', title: 'Daily Loop', description: 'Prioritized work, signal coalescence, owners, deadlines, and outcomes.' },
  { id: 'patient-360', shortLabel: 'Patient 360', title: 'Patient 360', description: '60-second brief, monitoring, medications, timeline, and care plan.' },
  { id: 'pathways', shortLabel: 'Pathways', title: 'Protocol Pathways', description: 'HEARTLAND tools connected to the current workflow.' },
  { id: 'coordination', shortLabel: 'Coordination', title: 'Care Coordination', description: 'Team workload, discharge follow-up, handoff, and access controls.' },
  { id: 'patient-view', shortLabel: 'Patient View', title: 'Patient Experience', description: 'Today view, check-ins, education, contact, and privacy.' },
  { id: 'impact', shortLabel: 'Impact', title: 'Impact & Reports', description: 'Tour coverage, operational measures, and adoption evidence.' },
];

export const SANDBOX_TASKS: SandboxTask[] = [
  {
    id: 'task-weight', patientId: 'demo-maria', patientName: 'Maria Santos',
    title: 'Review persistent weight and dyspnea signal',
    reason: 'Weight increased 4.2 lb over 3 days while dyspnea moved from mild to moderate.',
    signal: 'Persistent for 3 days · worsened twice', priority: 'now', severity: 'critical',
    dueLabel: 'Due now', occurrences: 4, owner: 'Dr. Sarah Mitchell', source: 'Remote monitoring',
    suggestedAction: 'Open the 60-second brief, verify source data, and document contact outcome.',
  },
  {
    id: 'task-lab', patientId: 'demo-maria', patientName: 'Maria Santos',
    title: 'Reconcile renal safety data before next pathway step',
    reason: 'Potassium is current; creatinine/eGFR source is six days old and needs verification.',
    signal: 'Data-quality gate · one missing result', priority: 'now', severity: 'warning',
    dueLabel: 'Due in 45 minutes', occurrences: 1, owner: 'Lena Ortiz, PharmD', source: 'Lab safety gate',
    suggestedAction: 'Verify the source record before using any titration pathway.',
  },
  {
    id: 'task-medication', patientId: 'demo-james', patientName: 'James Walker',
    title: 'Medication tolerability follow-up',
    reason: 'Scheduled follow-up after a documented therapy change; symptom and BP review are due.',
    signal: 'One scheduled follow-up', priority: 'today', severity: 'warning',
    dueLabel: 'Due today · 2:00 PM', occurrences: 1, owner: 'Lena Ortiz, PharmD', source: 'GDMT follow-up',
    suggestedAction: 'Use the telephone titration checklist and record the next due date.',
  },
  {
    id: 'task-checkin', patientId: 'demo-robert', patientName: 'Robert Lee',
    title: 'Review missing monitoring check-in',
    reason: 'No monitoring entry recorded for 72 hours on the assigned analog track.',
    signal: 'Persistent for 72 hours', priority: 'today', severity: 'warning',
    dueLabel: 'Due today · 4:00 PM', occurrences: 3, owner: 'Maya Chen, RN', source: 'Track B monitoring',
    suggestedAction: 'Confirm the analog workflow and document outreach disposition.',
  },
  {
    id: 'task-discharge', patientId: 'demo-james', patientName: 'James Walker',
    title: 'Complete Day 7 transition follow-up',
    reason: 'Discharge medication reconciliation is complete; teach-back outcome remains open.',
    signal: 'Day 7 milestone', priority: 'today', severity: 'informational',
    dueLabel: 'Due today · 5:00 PM', occurrences: 1, owner: 'Maya Chen, RN', source: 'Discharge pathway',
    suggestedAction: 'Complete teach-back, capture outcome, and schedule Day 14 follow-up.',
  },
  {
    id: 'task-review', patientId: 'demo-maria', patientName: 'Maria Santos',
    title: 'Prepare multidisciplinary review',
    reason: 'Summarize monitoring signals, therapy gaps, barriers, and completed follow-up outcomes.',
    signal: 'Weekly workflow', priority: 'week', severity: 'informational',
    dueLabel: 'Due Friday', occurrences: 1, owner: 'Dr. Sarah Mitchell', source: 'Care coordination',
    suggestedAction: 'Generate a structured SBAR handoff from the current synthetic context.',
  },
  {
    id: 'task-education', patientId: 'demo-robert', patientName: 'Robert Lee',
    title: 'Close education teach-back loop',
    reason: 'Four education modules are complete; red-flag teach-back remains undocumented.',
    signal: 'One open outcome', priority: 'week', severity: 'informational',
    dueLabel: 'Due in 4 days', occurrences: 1, owner: 'Maya Chen, RN', source: 'Patient education',
    suggestedAction: 'Record comprehension outcome and route questions to the clinical owner.',
  },
  {
    id: 'task-watch', patientId: 'demo-james', patientName: 'James Walker',
    title: 'Watch stable post-discharge weight trend',
    reason: 'Weight and symptoms remain stable; no immediate action is due unless trend changes.',
    signal: 'Stable for 5 days', priority: 'watching', severity: 'informational',
    dueLabel: 'Review next week', occurrences: 5, owner: 'Maya Chen, RN', source: 'Remote monitoring',
    suggestedAction: 'Keep in Watching and preserve the scheduled follow-up.',
  },
];

export const SANDBOX_PATIENTS: SandboxPatient[] = [
  {
    id: 'demo-maria', name: 'Maria Santos', age: 68, pronouns: 'she/her', region: 'Synthetic rural clinic · New Mexico',
    distanceToCardiology: '126 miles', riskTier: 'High', ckmStage: 'Stage 4', track: 'Digital Track A',
    facilityTier: 'Tier 2 · Standard', sourceFreshness: 'Latest source 18 minutes ago',
    latestSignal: 'Weight +4.2 lb / 3 days with worsening dyspnea',
    changeSummary: 'Weight, dyspnea, and edema worsened; potassium is current but renal function needs source verification.',
    symptoms: ['Moderate exertional dyspnea', 'New mild ankle edema', 'Two-pillow orthopnea', 'No chest pain reported'],
    missingData: ['Creatinine/eGFR source older than 72 hours', 'Contact outcome not documented'],
    vitals: [
      { label: '5d ago', weight: 171.8, sbp: 118, heartRate: 72, spo2: 96 },
      { label: '4d ago', weight: 172.1, sbp: 116, heartRate: 74, spo2: 96 },
      { label: '3d ago', weight: 173.4, sbp: 114, heartRate: 76, spo2: 95 },
      { label: 'Yesterday', weight: 175.2, sbp: 110, heartRate: 80, spo2: 94 },
      { label: 'Today', weight: 176.0, sbp: 108, heartRate: 82, spo2: 94 },
    ],
    labs: [
      { name: 'Potassium', value: '4.7 mmol/L', collected: 'Yesterday', status: 'within range' },
      { name: 'Creatinine', value: '1.42 mg/dL', collected: '6 days ago', status: 'watch' },
      { name: 'eGFR', value: '41 mL/min/1.73m²', collected: '6 days ago', status: 'watch' },
      { name: 'NT-proBNP', value: 'Not available', collected: '—', status: 'missing' },
    ],
    medications: [
      { name: 'Sacubitril/valsartan', therapyClass: 'ARNI', dose: '49/51 mg twice daily', status: 'active', note: 'Last reconciliation 8 days ago' },
      { name: 'Carvedilol', therapyClass: 'Beta blocker', dose: '12.5 mg twice daily', status: 'active', note: 'Tolerability documented' },
      { name: 'Spironolactone', therapyClass: 'MRA', dose: '25 mg daily', status: 'titration due', note: 'Verify renal source first' },
      { name: 'SGLT2 inhibitor', therapyClass: 'SGLT2i', dose: 'Not documented', status: 'documented gap', note: 'Barrier/reason not yet captured' },
    ],
    timeline: [
      { id: 'm1', when: '18 min ago', type: 'signal', title: 'Weight signal refreshed', detail: 'Fourth related observation coalesced into one active work item.' },
      { id: 'm2', when: 'Today · 8:05 AM', type: 'contact', title: 'Patient check-in submitted', detail: 'Dyspnea moderate, edema mild, no chest pain reported.' },
      { id: 'm3', when: 'Yesterday', type: 'lab', title: 'Potassium reviewed', detail: '4.7 mmol/L; source marked verified.' },
      { id: 'm4', when: '6 days ago', type: 'medication', title: 'Medication reconciliation', detail: 'MRA follow-up gate opened pending current renal source.' },
      { id: 'm5', when: '8 days ago', type: 'education', title: 'Daily weight teach-back', detail: 'Completed with correct escalation description.', outcome: 'Understood' },
    ],
    carePlan: ['Verify source renal results', 'Document symptom contact outcome', 'Review therapy gap with independent judgment', 'Return signal to Watching after outcome'],
    education: { completed: 5, total: 6, next: 'When to call the care team' },
    access: ['Dr. Sarah Mitchell · active provider', 'Maya Chen, RN · care coordinator', 'Patient may revoke access through Privacy'],
  },
  {
    id: 'demo-james', name: 'James Walker', age: 72, pronouns: 'he/him', region: 'Synthetic critical access hospital · Kansas',
    distanceToCardiology: '94 miles', riskTier: 'Moderate', ckmStage: 'Stage 3', track: 'Digital Track A',
    facilityTier: 'Tier 1 · Minimal', sourceFreshness: 'Latest source 2 hours ago',
    latestSignal: 'Day 7 transition and medication follow-up due today',
    changeSummary: 'Weight and symptoms are stable after discharge; tolerability and teach-back outcomes remain due.',
    symptoms: ['Mild exertional fatigue', 'No edema reported', 'No orthopnea reported', 'Appetite improving'],
    missingData: ['Teach-back outcome', 'Next appointment confirmation'],
    vitals: [
      { label: '5d ago', weight: 188.4, sbp: 126, heartRate: 68, spo2: 97 },
      { label: '4d ago', weight: 188.0, sbp: 124, heartRate: 70, spo2: 97 },
      { label: '3d ago', weight: 187.9, sbp: 122, heartRate: 69, spo2: 97 },
      { label: 'Yesterday', weight: 188.1, sbp: 120, heartRate: 70, spo2: 96 },
      { label: 'Today', weight: 188.0, sbp: 121, heartRate: 71, spo2: 97 },
    ],
    labs: [
      { name: 'Potassium', value: '4.2 mmol/L', collected: '3 days ago', status: 'within range' },
      { name: 'Creatinine', value: '1.18 mg/dL', collected: '3 days ago', status: 'within range' },
      { name: 'eGFR', value: '58 mL/min/1.73m²', collected: '3 days ago', status: 'within range' },
    ],
    medications: [
      { name: 'Losartan', therapyClass: 'ARB', dose: '50 mg daily', status: 'active', note: 'Discharge list reconciled' },
      { name: 'Metoprolol succinate', therapyClass: 'Beta blocker', dose: '50 mg daily', status: 'titration due', note: 'Tolerability call due' },
      { name: 'Empagliflozin', therapyClass: 'SGLT2i', dose: '10 mg daily', status: 'active', note: 'Access confirmed' },
    ],
    timeline: [
      { id: 'j1', when: '2 hours ago', type: 'follow-up', title: 'Day 7 follow-up became due', detail: 'Medication and education outcomes remain open.' },
      { id: 'j2', when: 'Yesterday', type: 'education', title: 'Discharge education completed', detail: 'Teach-back disposition not yet captured.' },
      { id: 'j3', when: '3 days ago', type: 'lab', title: 'Safety labs reviewed', detail: 'Source values current and within documented gate.' },
      { id: 'j4', when: '7 days ago', type: 'contact', title: 'Discharged home', detail: '48-hour, Day 7, Day 14, and Day 30 follow-ups scheduled.' },
    ],
    carePlan: ['Complete tolerability call', 'Record teach-back outcome', 'Confirm Day 14 appointment', 'Continue stable monitoring'],
    education: { completed: 4, total: 5, next: 'Medication purpose teach-back' },
    access: ['Dr. Sarah Mitchell · active provider', 'Lena Ortiz, PharmD · delegated follow-up', 'Patient may revoke access through Privacy'],
  },
  {
    id: 'demo-robert', name: 'Robert Lee', age: 64, pronouns: 'he/him', region: 'Synthetic FQHC · West Virginia',
    distanceToCardiology: '143 miles', riskTier: 'Moderate', ckmStage: 'Stage 2', track: 'Analog Track B',
    facilityTier: 'Tier 1 · Minimal', sourceFreshness: 'No monitoring source for 72 hours',
    latestSignal: 'Missing analog diary check-in',
    changeSummary: 'Clinical trend cannot be inferred because the expected paper/telephone check-in is missing.',
    symptoms: ['Last documented status stable', 'Current symptoms unknown'],
    missingData: ['Weight', 'Blood pressure', 'Current symptoms', 'Medication adherence'],
    vitals: [
      { label: '7d ago', weight: 203.2, sbp: 132, heartRate: 76, spo2: 96 },
      { label: '6d ago', weight: 203.0, sbp: 130, heartRate: 74, spo2: 96 },
      { label: '5d ago', weight: 203.4, sbp: 131, heartRate: 75, spo2: 96 },
    ],
    labs: [
      { name: 'Potassium', value: '4.0 mmol/L', collected: '12 days ago', status: 'watch' },
      { name: 'Creatinine', value: '1.01 mg/dL', collected: '12 days ago', status: 'watch' },
    ],
    medications: [
      { name: 'Lisinopril', therapyClass: 'ACE inhibitor', dose: '20 mg daily', status: 'active', note: 'Last confirmed 12 days ago' },
      { name: 'Carvedilol', therapyClass: 'Beta blocker', dose: '6.25 mg twice daily', status: 'active', note: 'Analog adherence entry missing' },
    ],
    timeline: [
      { id: 'r1', when: 'Today', type: 'signal', title: 'Missing-data signal persisted', detail: 'Third scheduled check-in missed; one work item remains active.' },
      { id: 'r2', when: '3 days ago', type: 'follow-up', title: 'Telephone attempt documented', detail: 'No answer; retry routed to assigned coordinator.', outcome: 'Awaiting patient' },
      { id: 'r3', when: '5 days ago', type: 'contact', title: 'Paper diary transcribed', detail: 'Weight and blood pressure stable at last contact.' },
    ],
    carePlan: ['Retry outreach using downtime contact plan', 'Transcribe paper diary', 'Verify medication adherence', 'Escalate only if documented red flags emerge'],
    education: { completed: 4, total: 6, next: 'Analog daily diary review' },
    access: ['Dr. Sarah Mitchell · active provider', 'Maya Chen, RN · assigned coordinator', 'Patient may revoke access through Privacy'],
  },
];

export const SANDBOX_PATHWAYS: SandboxPathway[] = [
  { id: 'risk', module: 'Module 1', title: 'Risk Stratification', description: 'Explore the proposed HEARTLAND risk framework and transparent score breakdown.', href: '/risk-calculator', evidence: 'Proposed', scenarioUse: 'Reassess Maria’s documented risk context without treating the score as a diagnosis.', steps: ['Enter synthetic variables', 'Review factor-level explanation', 'Apply independent judgment'] },
  { id: 'gdmt', module: 'Module 2', title: 'GDMT Optimization', description: 'Review HFrEF/HFpEF pathways, therapy classes, safety gates, and access barriers.', href: '/gdmt-pathway', evidence: 'Established', scenarioUse: 'Review Maria’s documented SGLT2i gap after source verification.', steps: ['Choose phenotype', 'Review evidence labels', 'Document barrier or next review'] },
  { id: 'titration', module: 'Module 3', title: 'Telephone Titration', description: 'Run a structured pre-call, safety-gate, decision, and follow-up checklist.', href: '/titration-checklist', evidence: 'Pragmatic', scenarioUse: 'Prepare James’s tolerability call and required follow-up.', steps: ['Verify vitals/labs', 'Pass safety gate', 'Record decision and due date'] },
  { id: 'monitoring', module: 'Module 5', title: 'Remote Monitoring', description: 'Assign digital or analog track using resources, access, and patient preference.', href: '/remote-monitoring', evidence: 'Pragmatic', scenarioUse: 'Review Robert’s Track B workflow after a missing paper diary entry.', steps: ['Assess connectivity', 'Choose track', 'Define degraded workflow'] },
  { id: 'tier', module: 'Module 8', title: 'Implementation Tier', description: 'Match workflow scope to staffing, pharmacy, technology, and rural capacity.', href: '/tier-selector', evidence: 'Proposed', scenarioUse: 'Compare Tier 1 and Tier 2 operations for the synthetic clinic.', steps: ['Assess facility resources', 'Review readiness gaps', 'Generate implementation checklist'] },
  { id: 'cards', module: 'Reference', title: 'Pocket Cards', description: 'Open all ten protocol figures, checklists, and printable references.', href: '/pocket-cards', evidence: 'Established', scenarioUse: 'Use a concise reference during the simulated team review.', steps: ['Choose module', 'Open full-size card', 'Print or download reference'] },
];

export const SANDBOX_TEAM: SandboxTeamMember[] = [
  { id: 'sarah', name: 'Dr. Sarah Mitchell', role: 'Clinical owner', workload: 4, overdue: 1, coverage: 'HF review · escalation' },
  { id: 'maya', name: 'Maya Chen, RN', role: 'Care coordinator', workload: 3, overdue: 1, coverage: 'Monitoring · education · discharge' },
  { id: 'lena', name: 'Lena Ortiz, PharmD', role: 'Pharmacist', workload: 2, overdue: 0, coverage: 'Medication reconciliation · access' },
];

export const SANDBOX_DISCHARGE_STEPS = [
  { label: '48 hours', state: 'Complete', detail: 'Medication list reconciled; no urgent symptom reported.' },
  { label: 'Day 7', state: 'Due today', detail: 'Tolerability and teach-back outcomes remain open.' },
  { label: 'Day 14', state: 'Scheduled', detail: 'Clinic appointment and lab review planned.' },
  { label: 'Day 30', state: 'Scheduled', detail: 'Transition outcome and care-plan review.' },
];
