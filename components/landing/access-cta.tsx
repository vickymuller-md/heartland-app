import Link from "next/link";

/**
 * Access CTA — warm, confident closer. A single bold panel with the
 * essential message and two clear actions. No prescription pad, no Rx,
 * no "controlled access ledger".
 */
export function AccessCta() {
  return (
    <section className="bg-terminal">
      <div className="mx-auto max-w-[1200px] px-6 py-24 md:py-32">
        <div className="relative overflow-hidden rounded-3xl bg-cool px-8 py-16 text-terminal md:px-16 md:py-24">
          {/* warm glow blob, low opacity */}
          <div
            aria-hidden
            className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-alert-on-dark/30 blur-3xl"
          />

          <div className="relative grid grid-cols-1 gap-12 md:grid-cols-12 md:items-end md:gap-16">
            <div className="md:col-span-7">
              <p className="font-editorial text-[12.5px] uppercase tracking-[0.18em] text-alert-on-dark">
                For licensed clinicians
              </p>
              <h2 className="mt-5 text-[clamp(2.2rem,4.6vw,3.75rem)] font-editorial font-semibold leading-[1.05] tracking-[-0.02em] text-terminal">
                Ready to put Heartland to work in your{" "}
                <span className="font-display italic font-normal text-alert-on-dark">
                  community?
                </span>
              </h2>
              <p className="mt-6 max-w-xl font-editorial text-[16px] leading-relaxed text-terminal/80">
                Explore the complete provider workflow with synthetic data in
                instantly. No account, approval, email confirmation, or
                authenticator setup.
                Verified clinical workspaces remain separately governed.
              </p>

              <div className="mt-10 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
                <Link
                  href="/sandbox"
                  data-landing-cta="start-sandbox-primary"
                  className="group inline-flex items-center gap-3 rounded-full bg-alert-on-dark px-7 py-4 font-editorial text-[15px] font-medium text-cool transition-colors hover:bg-terminal hover:text-cool"
                >
                  Start the free sandbox
                  <span className="transition-transform group-hover:translate-x-1">
                    →
                  </span>
                </Link>
                <Link
                  href="/request-access"
                  className="group inline-flex items-center gap-2 font-editorial text-[15px] text-terminal/85 transition-colors hover:text-alert-on-dark"
                >
                  Need verified clinical access?
                  <span className="transition-transform group-hover:translate-x-1">
                    →
                  </span>
                </Link>
              </div>
            </div>

            <aside className="md:col-span-5">
              <p className="font-editorial text-[12.5px] uppercase tracking-[0.18em] text-terminal/70">
                What approved professionals receive
              </p>
              <ul className="mt-5 space-y-3 font-editorial text-[15px] text-terminal/85">
                {[
                  "All eight implementation modules",
                  "Ten downloadable pocket reference cards",
                  "Telephone titration workflow with safety gates",
                  "Remote monitoring assignment + billing reference",
                  "Monthly aggregate adoption report",
                  "CSV export with HIPAA Safe-Harbor date truncation",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <span className="mt-[0.55em] inline-block h-1.5 w-1.5 flex-none rounded-full bg-alert-on-dark" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </aside>
          </div>
        </div>
      </div>
    </section>
  );
}
