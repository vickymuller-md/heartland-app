import Link from "next/link";
import { WeightTrend } from "@/components/shared/weight-trend";
import { SANDBOX_PATIENTS } from "@/lib/sandbox/fixtures";
import { APP_VERSION } from "@/lib/app-version";

export function Hero() {
  const sample = SANDBOX_PATIENTS[0];
  const latest = sample.vitals.at(-1);
  return (
    <section className="border-b border-grid bg-terminal">
      <div className="mx-auto max-w-[1200px] px-6 py-20 md:py-28">
        <div className="grid grid-cols-1 items-start gap-12 md:grid-cols-12">
          <div className="min-w-0 md:col-span-7">
            <p className="text-[0.875rem] font-medium text-signal">
              App {APP_VERSION} · Open-source educational companion
            </p>

            <h1 className="mt-6 font-editorial text-[clamp(2.6rem,6vw,5rem)] font-normal leading-[1.04] tracking-tight text-cool">
              Heart failure care{" "}
              <span className="font-display font-normal italic text-coral-ink">
                where there&rsquo;s no
              </span>{" "}
              cardiologist.
            </h1>

            <p className="mt-6 max-w-xl text-lg leading-relaxed text-cool/80">
              Explore how rural primary care teams could organize heart failure
              follow-up: eight protocol modules, synthetic patient journeys and
              visible boundaries between AI, registered rules and human review.
            </p>

            <div className="mt-10 flex flex-wrap items-center gap-4">
              <Link
                href="/sandbox"
                data-landing-cta="start-sandbox"
                className="inline-flex min-h-12 max-w-full items-center rounded-full bg-cool px-6 py-2.5 text-[1rem] font-medium text-terminal hover:bg-alert hover:text-cool"
              >
                Try the sandbox now
              </Link>
              <Link
                href="/request-access"
                className="inline-flex min-h-12 max-w-full items-center rounded-full border border-input px-6 py-2.5 text-[1rem] font-medium text-cool hover:bg-panel"
              >
                Request evaluation access
              </Link>
            </div>

            <aside aria-label="Evaluation boundaries" className="mt-8 max-w-xl border-l-2 border-grid-hi pl-4 text-sm leading-relaxed text-muted-foreground">
              Public routes: educational sandbox. Authenticated workspace: controlled evaluation only. Real PHI and unsupervised clinical use are not authorized until organizational security, privacy, validation, staffing, and governance gates are approved.
            </aside>

            <p className="mt-4 max-w-xl text-base leading-relaxed text-muted-foreground">
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

          <figure className="min-w-0 self-start rounded-[1.5rem] border border-grid bg-panel p-6 md:col-span-5 md:p-8">
            <figcaption className="border-b border-border pb-4">
              <p className="text-xs font-medium uppercase tracking-widest text-coral-ink">Synthetic patient record</p>
              <p className="mt-1 text-xl font-semibold text-foreground">{sample.name}</p>
            </figcaption>
            {latest && (
              <div className="my-5 flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm text-muted-foreground">Latest recorded weight</span>
                <span className="text-2xl font-semibold tabular-nums">{latest.weight} <span className="text-sm font-normal">lb</span></span>
              </div>
            )}
            <WeightTrend data={sample.vitals} />
            <ol aria-label="Sample case in the sandbox" className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {['Check-in received', 'Rule applied', 'Human review recorded'].map((step) => <li key={step} className="border-l border-input pl-2">{step}</li>)}
            </ol>
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
