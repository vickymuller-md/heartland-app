import Link from "next/link";
import { WeightTrend } from "@/components/shared/weight-trend";
import { SANDBOX_PATIENTS } from "@/lib/sandbox/fixtures";
import { APP_VERSION } from "@/lib/app-version";

export function Hero() {
  const sample = SANDBOX_PATIENTS[0];
  const latest = sample.vitals.at(-1);
  return (
    <section className="relative bg-terminal">
      <div className="mx-auto max-w-[1200px] px-4 py-12 sm:px-6 md:py-20">
        <div className="grid grid-cols-1 items-center gap-8 md:grid-cols-12 md:gap-14">
          <div className="min-w-0 md:col-span-7">
            <p className="section-kicker">
              App {APP_VERSION} · Open-source educational companion
            </p>

            <h1 className="mt-4 max-w-[14ch] font-display text-[clamp(3.1rem,6vw,5.5rem)] font-normal leading-[0.98] tracking-[-0.035em] text-foreground">
              Heart failure care{" "}
              <span className="font-display font-normal italic text-primary">
                where there&rsquo;s
              </span>{" "}
              no cardiologist.
            </h1>

            <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground">
              Explore how rural primary care teams could organize heart failure
              follow-up: eight protocol modules, synthetic patient journeys and
              visible boundaries between AI, registered rules and human review.
            </p>


            <ol aria-label="Sample case in the sandbox" className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {['Check-in received', 'Rule applied', 'Human review recorded'].map((step) => <li key={step} className="border-l border-input pl-2">{step}</li>)}
            </ol>
            <div className="mt-5 flex flex-col flex-wrap items-start gap-4 sm:flex-row sm:items-center">
              <Link
                href="/sandbox"
                data-landing-cta="start-sandbox"
                className="inline-flex min-h-11 max-w-full items-center rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-signal-deep"
              >
                Try the sandbox now
              </Link>
              <Link
                href="/request-access"
                className="inline-flex min-h-11 max-w-full items-center rounded-lg border border-input px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted"
              >
                Request evaluation access
              </Link>
            </div>

            <p className="mt-4 max-w-xl text-base leading-relaxed text-cool/80">
              Based on the HEARTLAND Protocol published in Cureus. Peer review
              applies to the protocol article, not validation of the app or its AI.
            </p>

            <p className="mt-4 max-w-xl border-t border-border pt-3 text-sm leading-relaxed text-muted-foreground">
              Built for licensed clinicians. This release does not establish
              FDA clearance or authorization and does not resolve
              medical-device classification. It does not replace clinical
              judgment or institutional policy. Public routes use synthetic
              data; authenticated workspaces remain controlled evaluation only.
              Real PHI is not authorized until release gates are approved.
            </p>
          </div>

          <figure className="panel min-w-0 self-center p-5 sm:p-7 md:col-span-5">
            <figcaption className="border-b border-border pb-4">
              <p className="section-kicker">Synthetic patient record</p>
              <p className="mt-1 text-xl font-semibold text-foreground">{sample.name}</p>
            </figcaption>
            {latest && (
              <div className="my-5 flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm text-muted-foreground">Latest recorded weight</span>
                <span className="text-2xl font-semibold tabular-nums">{latest.weight} <span className="text-sm font-normal">lb</span></span>
              </div>
            )}
            <WeightTrend data={sample.vitals} />
            <Link href={`/sandbox?area=patient-360&person=${sample.id}`}
              className="mt-5 inline-flex min-h-11 items-center text-sm font-semibold text-primary underline underline-offset-4">
              Open the fictional patient record
            </Link>
          </figure>
        </div>
      </div>
    </section>
  );
}
