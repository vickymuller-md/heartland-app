export function ImplementationReadiness() {
  return (
    <section id="implementation-readiness" className="border-b border-grid bg-panel">
      <div className="mx-auto max-w-[1200px] px-6 py-16">
        <p className="text-sm uppercase tracking-[0.2em] text-cool/75">Operational clarification</p>
        <h2 className="mt-3 font-display text-3xl sm:text-4xl">Same clinical goal. Explicit human responsibility.</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {[
            ['Pharmacy at any tier', 'Local, community or remote pharmacy support can contribute to reconciliation, teaching, access and monitoring. Availability is not assumed; professional authority remains explicit.'],
            ['Recognize, assess, authorize', 'Trained team members raise concerns; qualified professionals assess them within scope. Medication changes and clinical disposition require documented authority.'],
            ['Referral with context', 'Distinguish planned consultation, urgent assessment and advanced-HF/inpatient evaluation. A sent request is not an accepted handoff or completed care.'],
            ['Prepare and rehearse', 'Four preparation steps, printable worksheets and 12 synthetic scenarios help teams inspect ownership, communication and recovery gaps. They do not prove training delivered or clinical readiness.'],
          ].map(([title, description]) => (
            <article key={title} className="rounded-2xl border border-grid bg-terminal p-5">
              <h3 className="font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-cool/80">{description}</p>
            </article>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <a className="inline-flex min-h-11 items-center rounded-full bg-cool px-5 py-3 text-sm text-terminal" href="/guide#implementation-readiness">Explore local readiness and training</a>
          <a className="inline-flex min-h-11 items-center rounded-full border border-cool px-5 py-3 text-sm" href="/resources/heartland-local-readiness-training.md" download>Download the synthetic exercise pack</a>
        </div>
        <p className="mt-4 text-sm text-cool/75">Resource tier changes delivery support, not clinically indicated care. No patient pilot, institutional adoption or clinical outcome is demonstrated.</p>
      </div>
    </section>
  );
}
