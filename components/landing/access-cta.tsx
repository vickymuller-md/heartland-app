import Link from "next/link";

/**
 * Access CTA — warm, confident closer. A single bold panel with the
 * essential message and two clear actions. No prescription pad, no Rx,
 * no "controlled access ledger".
 */
export function AccessCta() {
  return (
    <section className="bg-terminal">
      <div className="mx-auto max-w-[1200px] px-4 py-24 sm:px-6 md:py-32">
        <div className="relative overflow-hidden rounded-3xl bg-cool px-4 py-16 text-terminal sm:px-8 md:px-16 md:py-24">
          {/* warm glow blob, low opacity */}
          <div
            aria-hidden
            className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-alert-on-dark/30 blur-3xl"
          />

          <div className="relative flex flex-wrap items-end gap-12">
            <div className="min-w-0 flex-[7_1_24rem]">
              <p className="font-editorial text-sm uppercase tracking-[0.14em] text-alert-on-dark">
                For licensed clinicians
              </p>
              <h2 className="mt-5 text-[clamp(1.5rem,4.6vw,3.75rem)] font-editorial font-semibold leading-[1.15] tracking-[-0.02em] text-terminal">
                Explore first. Evaluate{" "}
                <span className="font-display italic font-normal text-alert-on-dark">
                  deliberately.
                </span>
              </h2>
              <p className="mt-6 max-w-xl font-editorial text-base leading-relaxed text-terminal/85">
                Start with fictional cases in the public sandbox, without an
                account. For a controlled workspace evaluation, use the separate
                access request. A request is not authorization for clinical use.
              </p>

              <div className="mt-10 flex flex-col flex-wrap items-start gap-4 sm:flex-row sm:items-center">
                <Link
                  href="/sandbox"
                  data-landing-cta="start-sandbox-primary"
                  className="group inline-flex min-h-11 max-w-full items-center gap-3 rounded-3xl bg-alert-on-dark px-4 py-4 font-editorial text-base font-medium text-cool transition-colors hover:bg-terminal hover:text-cool sm:px-7"
                >
                  Start the free sandbox
                  <span className="transition-transform group-hover:translate-x-1">
                    →
                  </span>
                </Link>
                <Link
                  href="/request-access"
                  className="group inline-flex min-h-11 max-w-full items-center gap-2 font-editorial text-base text-terminal/85 transition-colors hover:text-alert-on-dark"
                >
                  Request evaluation access
                  <span className="transition-transform group-hover:translate-x-1">
                    →
                  </span>
                </Link>
              </div>
            </div>

            <aside className="min-w-0 flex-[5_1_16rem]">
              <p className="font-editorial text-sm uppercase tracking-[0.14em] text-terminal/85">
                Resources across the toolkit and workspace
              </p>
              <ul className="mt-5 space-y-3 font-editorial text-base leading-relaxed text-terminal/85">
                {[
                  "Eight educational implementation modules",
                  "Ten downloadable pocket reference cards",
                  "Telephone checklist with gates to inspect",
                  "Remote monitoring assignment + billing reference",
                  "Controlled workspace: monthly aggregate adoption report",
                  "Controlled workspace: CSV export with identifier substitution and year-only dates",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <span aria-hidden className="mt-[0.55em] inline-block h-1.5 w-1.5 flex-none rounded-full bg-alert-on-dark" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-5 font-editorial text-sm leading-relaxed text-terminal/85">
                Workspace resources require separately governed access; they are
                not all public sandbox actions. Real PHI remains unauthorized.
              </p>
              <p className="mt-5 font-editorial text-sm leading-relaxed text-terminal/85">
                Export transformations reduce direct identifiers but do not
                independently establish de-identification or HIPAA compliance.
              </p>
            </aside>
          </div>
        </div>
      </div>
    </section>
  );
}
