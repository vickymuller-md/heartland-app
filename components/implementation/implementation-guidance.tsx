import {
  AUTHORITY_BOUNDARY,
  PHARMACY_PARTICIPATION,
  READINESS_STEPS,
  REFERRAL_CONTEXTS,
  REFERRAL_HANDOFF,
  RESOURCE_TIER_PRINCIPLE,
  RESPECTFUL_ESCALATION,
} from '@/lib/implementation/constants';

export function ImplementationPrinciples() {
  return (
    <aside className="my-4 space-y-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
      <h3 className="font-semibold">Same clinical goal, different delivery support</h3>
      <p>{RESOURCE_TIER_PRINCIPLE}</p>
      <p>{PHARMACY_PARTICIPATION}</p>
      <p>{AUTHORITY_BOUNDARY}</p>
    </aside>
  );
}

export function ReferralContextGuide() {
  return (
    <section aria-label="Referral context and handoff" className="my-4 space-y-3 text-sm">
      <div className="grid gap-3 lg:grid-cols-3">
        {REFERRAL_CONTEXTS.map((context) => (
          <article key={context.id} className="rounded-xl border border-gray-200 bg-gray-50 p-4">
            <h4 className="font-semibold text-gray-900">{context.title}</h4>
            <p className="mt-2 text-gray-700">{context.description}</p>
          </article>
        ))}
      </div>
      <p className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-blue-950">{REFERRAL_HANDOFF}</p>
    </section>
  );
}

export function LocalReadinessGuide() {
  return (
    <div className="space-y-4">
      <p>Use this educational preparation pack for synthetic tabletop exercises. Do not enter real patient information. No worksheet or exercise authorizes clinical operation or proves staff competence.</p>
      <ol className="grid gap-3 sm:grid-cols-2">
        {READINESS_STEPS.map((step, index) => (
          <li key={step.title} className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Step {index + 1}</p>
            <h3 className="mt-1 font-semibold text-gray-900">{step.title}</h3>
            <p className="mt-2 text-sm text-gray-700">{step.description}</p>
          </li>
        ))}
      </ol>
      <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">{RESPECTFUL_ESCALATION}</p>
      <p><a className="font-medium text-blue-700 underline" href="/resources/heartland-local-readiness-training.md" download>Download the readiness worksheets and 12 synthetic scenarios (Markdown)</a></p>
      <p className="text-sm">The pack includes a role matrix, coverage plan, paper logs, a huddle agenda, competency observations and remediation. Separate ambulatory-entry validation, institution-specific policies and a patient pilot remain outside this release.</p>
    </div>
  );
}
