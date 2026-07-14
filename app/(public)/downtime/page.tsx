import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Downtime playbook · HEARTLAND',
  description: 'Non-PHI degraded workflow for HEARTLAND controlled evaluation.',
};

const STEPS = [
  ['Declare degraded mode', 'Record outage start time, affected service, incident owner, and approved backup communication channel. Do not copy patient data into personal devices or consumer messaging.'],
  ['Use the source record', 'Return to the facility-approved EHR, paper downtime packet, telephone tree, or emergency process. HEARTLAND is not the source of truth during an outage.'],
  ['Triage outside HEARTLAND', 'Follow facility escalation policy for urgent symptoms, critical results, unreachable patients, and emergency services. Do not infer that a missing alert means no risk.'],
  ['Document minimally', 'Use the approved downtime artifact. Record responsible person, time, action, and next deadline; avoid duplicate free-text copies of clinical details.'],
  ['Reconcile after recovery', 'Confirm identity and current source record, then enter only the minimum required outcome. Close duplicate tasks, verify owner/deadline, and record any delivery failure or near miss.'],
  ['Review the incident', 'Assess missed/late work, access exposure, communication failure, and whether notification, security, privacy, or safety escalation is required.'],
] as const;

export default function DowntimePlaybookPage() {
  return (
    <article className="mx-auto max-w-4xl px-6 py-16 print:max-w-none print:px-0 print:py-0">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-alert">Controlled evaluation · non-PHI checklist</p>
      <h1 className="mt-3 text-4xl font-bold tracking-tight text-cool">HEARTLAND downtime playbook</h1>
      <p className="mt-4 max-w-2xl text-base leading-relaxed text-cool/75">
        Safe degraded mode means stopping clinical writes and returning to the facility-approved source record and escalation process. This page contains no patient information and may be printed in advance.
      </p>

      <div className="mt-8 border border-alert/50 bg-alert/10 p-4 text-sm font-medium text-cool">
        This checklist does not create a response service or replace local emergency, downtime, privacy, or incident-response policy. Facility leadership must approve owners, contacts, staffing, RTO/RPO, and escalation thresholds before clinical use.
      </div>

      <ol className="mt-10 space-y-5">
        {STEPS.map(([title, body], index) => (
          <li key={title} className="grid gap-3 border-b border-grid pb-5 sm:grid-cols-[3rem_1fr]">
            <span className="flex size-10 items-center justify-center rounded-full bg-cool font-bold text-terminal">{index + 1}</span>
            <div><h2 className="text-lg font-bold text-cool">{title}</h2><p className="mt-1 text-sm leading-relaxed text-cool/75">{body}</p></div>
          </li>
        ))}
      </ol>

      <section className="mt-10 grid gap-4 border border-grid p-5 sm:grid-cols-2" aria-labelledby="local-details">
        <h2 id="local-details" className="sm:col-span-2 text-lg font-bold text-cool">Facility-approved details · complete before pilot</h2>
        {['Downtime owner', 'Incident commander', 'Clinical escalation contact', 'Approved backup channel', 'Recovery time objective', 'Recovery point objective'].map((label) => (
          <div key={label} className="min-h-16 border-b border-stone/50 pt-2 text-xs font-semibold uppercase tracking-wide text-stone">{label}</div>
        ))}
      </section>
    </article>
  );
}
