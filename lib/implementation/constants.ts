/** Shared operational explanations; no calculation, prescribing or urgency rules. */
export const RESOURCE_TIER_PRINCIPLE =
  'Clinical indication, severity, tolerability and safe monitoring determine the care plan and timing. Resource tier determines delivery format and support, not a lower treatment goal. Record unmet needs, a named owner and a plan for additional support or referral.';

export const PHARMACY_PARTICIPATION =
  'Community, ambulatory or remote pharmacists may participate at every tier when available. Define responsibility for medication reconciliation, patient/caregiver teach-back, access barriers, monitoring and recommendations. Pharmacy participation is an option across tiers, not a universal staffing prerequisite.';

export const AUTHORITY_BOUNDARY =
  'Any appropriately trained team member may recognize and promptly report a concern. Qualified staff assess it within their scope; medication changes and clinical disposition require documented professional authority and applicable local agreements. A job title, certificate or software permission alone does not confer that authority.';

export const REFERRAL_HANDOFF =
  'A pharmacist or another team member can initiate a concern and contact the named clinical decision-maker. Record the reason, relevant result/version, urgency under local policy, recipient, acceptance and next action. The current owner retains responsibility until an accepted transfer under the local workflow; a sent request is not completed care.';

export const QUALITY_METRIC_LIMIT =
  'Historical tier-specific percentages are illustrative service-planning examples, not validated benchmarks, individual care targets or permission to omit indicated care. Report denominators, contraindications, access barriers and unmet needs. The two-class GDMT measure is incomplete treatment coverage, not the full treatment goal.';

export const REFERRAL_CONTEXTS = [
  {
    id: 'planned',
    title: 'Planned specialist consultation',
    description: 'For a clinically stable person needing specialist input, document the clinical question, responsible clinician, destination and follow-up plan. Confirm acceptance and track attendance, report and communication; do not infer completion from scheduling.',
  },
  {
    id: 'urgent',
    title: 'Urgent or emergency assessment',
    description: 'Acute deterioration follows the locally approved urgent/emergency pathway. Do not wait for a routine referral, software acknowledgment or this form to identify a concern. The three-variable form does not assess acute stability or exclude an emergency.',
  },
  {
    id: 'advanced',
    title: 'Advanced HF / inpatient context',
    description: 'Advanced-HF and device criteria remain in Module 6.2. Continuous or frequent IV inotrope need belongs to an advanced-HF/inpatient specialist context, not a routine outpatient prerequisite. A clinician considers the full presentation; no single form is a comprehensive referral assessment.',
  },
] as const;

export const READINESS_STEPS = [
  { title: 'Map the team and authority', description: 'Name the accountable clinician, task performer and backup; assess competence, workload, coverage, pharmacy access and permitted actions.' },
  { title: 'Make the handoff explicit', description: 'Agree how a concern reaches a decision-maker, how acceptance is confirmed, and which backup and emergency route apply.' },
  { title: 'Rehearse both channels', description: 'Use fictional cases to rehearse paper/telephone and digital records, missing results, failed contact, corrected evidence and uncertain delivery.' },
  { title: 'Record gaps and reassess', description: 'Document observed performance, unresolved gaps, remediation and a repeat exercise. A completed worksheet does not establish clinical readiness.' },
] as const;

export const RESPECTFUL_ESCALATION =
  'Acknowledge concerns respectfully, politely and gratefully, regardless of role or seniority. Confirm who will act and by when under local policy; if acknowledgment fails, use the agreed backup. Raising a concern must not be treated as transferring responsibility without acceptance.';
