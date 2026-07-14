import Link from "next/link";
import { HeroIllustration } from "./medical-cross";

/**
 * Hero — generous warm landing.
 * Big inviting headline + subhead + two CTAs on the left.
 * Soft hand-drawn stethoscope illustration anchors the right.
 */
export function Hero() {
  return (
    <section className="relative overflow-hidden bg-terminal">
      <div className="mx-auto max-w-[1200px] px-6 pb-24 pt-16 md:pb-32 md:pt-24">
        <div className="grid grid-cols-1 items-center gap-16 md:grid-cols-12 md:gap-12">
          <div className="md:col-span-7">
            <p className="inline-flex items-center gap-2 rounded-full border border-grid bg-panel px-3.5 py-1.5 font-editorial text-[12px] tracking-tight text-cool/80">
              <span className="h-1.5 w-1.5 rounded-full bg-signal" aria-hidden />
              Peer-reviewed in Cureus · Open source
            </p>

            <h1 className="mt-7 text-[clamp(2.6rem,6.4vw,5.25rem)] font-editorial font-semibold leading-[1.04] tracking-[-0.025em] text-cool">
              Heart failure care{" "}
              <span className="font-display italic font-normal text-alert">
                where there&rsquo;s
              </span>{" "}
              no cardiologist.
            </h1>

            <p className="mt-7 max-w-xl font-editorial text-[17px] leading-[1.65] text-cool/75 md:text-[18px]">
              Heartland is a clinical implementation companion for primary
              care teams managing heart failure in rural and resource-limited
              settings across the United States. Built from the peer-reviewed
              HEARTLAND Protocol — eight modules, one shared workflow.
            </p>

            <div className="mt-10 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
              <Link
                href="/request-access"
                data-landing-cta="request-access"
                className="group inline-flex items-center gap-3 rounded-full bg-cool px-7 py-4 font-editorial text-[15px] font-medium text-terminal transition-colors hover:bg-alert hover:text-cool"
              >
                Request professional access
                <span className="transition-transform group-hover:translate-x-1">
                  →
                </span>
              </Link>
              <Link
                href="/login"
                className="group inline-flex items-center gap-2 font-editorial text-[15px] font-medium text-cool/85 transition-colors hover:text-alert"
              >
                I have an invitation
                <span className="transition-transform group-hover:translate-x-1">
                  →
                </span>
              </Link>
            </div>

            <p className="mt-12 max-w-md font-editorial text-[12.5px] leading-relaxed text-stone">
              Built for licensed clinicians. Not a medical device. Not for
              direct patient care. Public routes use synthetic data;
              authenticated workspaces remain controlled evaluation only. Real
              PHI is not authorized until release gates are approved.
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
