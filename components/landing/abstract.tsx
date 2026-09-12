/**
 * Implementation questions, not unqualified population or outcome claims.
 */
export function Abstract() {
  return (
    <section className="border-y border-grid bg-panel">
      <div className="mx-auto max-w-[1200px] px-6 py-24 md:py-32">
        <div className="mx-auto max-w-3xl text-center">
          <p className="font-editorial text-sm uppercase tracking-[0.14em] text-alert">
            Why Heartland exists
          </p>
          <h2 className="mt-5 text-[clamp(1.85rem,3.5vw,2.85rem)] font-editorial font-semibold leading-[1.15] tracking-[-0.015em] text-cool">
            Follow-up needs more than a{" "}
            <span className="font-display italic font-normal text-alert">
              calculated score
            </span>
            . It needs context, ownership and a next step.
          </h2>
        </div>

        <div className="mt-16 grid grid-cols-[repeat(auto-fit,minmax(min(100%,18rem),1fr))] gap-6">
          <ContextCard
            heading="Access"
            note="How will follow-up work when travel, connectivity or specialist access is limited? Explore digital and telephone workflow options."
          />
          <ContextCard
            heading="Complete context"
            note="Which answers are present, absent or awaiting confirmation? Inspect the source before interpreting a signal."
            accent
          />
          <ContextCard
            heading="Accountable follow-up"
            note="Who reviews the information, records a decision and owns the next step? A routed alert is not a completed review."
          />
        </div>

        <p className="mx-auto mt-16 max-w-2xl text-center font-editorial text-base leading-relaxed text-cool/80">
          Heartland makes proposed workflows inspectable with fictional cases.
          Explore the handoffs, examine what is missing and identify questions
          for local evaluation before considering implementation.
        </p>

        {/* Preserve the professional-use and unvalidated-framework boundaries. */}
        <div className="mt-20 grid grid-cols-1 gap-5 md:grid-cols-2 md:gap-6">
          <Disclaimer heading="Professional use only">
            Public tools are an educational sandbox. The authenticated workspace
            is a controlled evaluation environment, not authorization for real
            PHI or unsupervised clinical use. Outputs do not replace independent
            review, clinical judgment, or institutional policy.
          </Disclaimer>
          <Disclaimer heading="Framework in development">
            The HEARTLAND Risk Stratification Framework is a proposed tool
            under development. It has not been validated against clinical
            outcomes data. Formal validation through registry data is a
            defined research objective.
          </Disclaimer>
        </div>
      </div>
    </section>
  );
}

function Disclaimer({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <aside
      role="note"
      aria-label="Clinical use disclaimer"
      className="rounded-2xl border border-grid bg-terminal p-6"
    >
      <p className="font-editorial text-sm uppercase tracking-[0.14em] text-alert">
        {heading}
      </p>
      <p className="mt-3 font-editorial text-base leading-relaxed text-cool/80">
        {children}
      </p>
    </aside>
  );
}

function ContextCard({
  heading,
  note,
  accent,
}: {
  heading: string;
  note: string;
  accent?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-grid bg-terminal p-6 md:p-8">
      <h3
        className={
          "font-editorial text-2xl font-semibold leading-snug " +
          (accent ? "text-alert" : "text-cool")
        }
      >
        {heading}
      </h3>
      <p className="mt-4 font-editorial text-base leading-relaxed text-cool/80">
        {note}
      </p>
    </div>
  );
}
