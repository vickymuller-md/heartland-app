import Link from "next/link";
import { HeroIllustration } from "./medical-cross";
import { APP_VERSION } from "@/lib/app-version";

/**
 * Hero — generous warm landing.
 * Big inviting headline + subhead + two CTAs on the left.
 * Soft hand-drawn stethoscope illustration anchors the right.
 */
export function Hero() {
  return (
    <section className="relative bg-terminal">
      <div className="mx-auto max-w-[1200px] px-6 pb-24 pt-16 md:pb-32 md:pt-24">
        <div className="grid grid-cols-1 items-center gap-16 md:grid-cols-12 md:gap-12">
          <div className="min-w-0 md:col-span-7">
            <p className="inline-flex items-center rounded-2xl border border-grid bg-panel px-3.5 py-2 font-editorial text-sm text-cool/80">
              App {APP_VERSION} · Open-source educational companion
            </p>

            <h1 className="mt-7 text-[clamp(2.6rem,6.4vw,5.25rem)] font-editorial font-semibold leading-[1.04] tracking-[-0.025em] text-cool">
              Heart failure care{" "}
              <span className="font-display italic font-normal text-alert">
                where there&rsquo;s
              </span>{" "}
              no cardiologist.
            </h1>

            <p className="mt-7 max-w-xl font-editorial text-lg leading-relaxed text-cool/80">
              Explore how rural primary care teams could organize heart failure
              follow-up: eight protocol modules, synthetic patient journeys and
              visible boundaries between AI, registered rules and human review.
            </p>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-cool/80">
              Based on the HEARTLAND Protocol published in Cureus. Peer review
              applies to the protocol article, not validation of the app or its AI.
            </p>

            <div className="mt-10 flex flex-col flex-wrap items-start gap-4 sm:flex-row sm:items-center">
              <Link
                href="/sandbox"
                data-landing-cta="start-sandbox"
                className="group inline-flex min-h-11 max-w-full items-center gap-3 rounded-3xl bg-cool px-7 py-4 font-editorial text-base font-medium text-terminal transition-colors hover:bg-alert"
              >
                Try the sandbox now
                <span className="transition-transform group-hover:translate-x-1">
                  →
                </span>
              </Link>
              <Link
                href="/request-access"
                className="group inline-flex min-h-11 max-w-full items-center gap-2 font-editorial text-base font-medium text-cool/85 transition-colors hover:text-alert"
              >
                Request evaluation access
                <span className="transition-transform group-hover:translate-x-1">
                  →
                </span>
              </Link>
            </div>

            <p className="mt-12 max-w-xl font-editorial text-sm leading-relaxed text-stone">
              Built for licensed clinicians. This release does not establish
              FDA clearance or authorization and does not resolve
              medical-device classification. It does not replace clinical
              judgment or institutional policy. Public routes use synthetic
              data; authenticated workspaces remain controlled evaluation only.
              Real PHI is not authorized until release gates are approved.
            </p>
          </div>

          <div className="md:col-span-5">
            <div className="relative">
              <HeroIllustration className="mx-auto h-auto w-full max-w-[460px]" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
