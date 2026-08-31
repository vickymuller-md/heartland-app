import Link from "next/link";
import { simulatePopulationDay } from "@/lib/sandbox/population";

/**
 * "One clinician, thousands of patients" — the scale story, rendered from the
 * SAME deterministic population engine the sandbox scene runs, so the landing
 * numbers can never drift from what the visitor then watches live.
 */
export function ScaleDemo() {
  const day = simulatePopulationDay(2500, 0);
  const numberFormat = new Intl.NumberFormat("en-US");

  return (
    <section className="border-b border-grid bg-terminal">
      <div className="mx-auto max-w-[1200px] px-6 py-24 md:py-32">
        <div className="mx-auto max-w-3xl text-center">
          <p className="font-editorial text-[12.5px] uppercase tracking-[0.18em] text-alert">
            The scale demonstration
          </p>
          <h2 className="mt-5 text-[clamp(1.85rem,3.5vw,2.85rem)] font-editorial font-semibold leading-[1.15] tracking-[-0.015em] text-cool">
            One clinician.{" "}
            <span className="font-display italic font-normal text-alert">
              Thousands of patients.
            </span>{" "}
            Every decision by registered rules.
          </h2>
          <p className="mx-auto mt-6 max-w-2xl font-editorial text-[15.5px] leading-relaxed text-cool/75">
            In the public sandbox, the registered clinical rules process a
            synthetic monitored population overnight — documenting the routine,
            retrying the unreachable, routing adherence gaps — and hand the
            clinician only the exceptions.
          </p>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-6 md:grid-cols-3 md:gap-8">
          <div className="rounded-2xl border border-grid bg-panel p-8">
            <p className="font-editorial text-5xl font-semibold leading-none tracking-[-0.02em] text-cool md:text-6xl">
              {numberFormat.format(day.counts.total)}
            </p>
            <p className="mt-5 font-editorial text-[15.5px] font-medium text-cool">
              synthetic check-ins processed
            </p>
            <p className="mt-1.5 font-editorial text-[14px] leading-relaxed text-cool/70">
              in one simulated overnight round.
            </p>
          </div>
          <div className="rounded-2xl border border-grid bg-panel p-8">
            <p className="font-editorial text-5xl font-semibold leading-none tracking-[-0.02em] text-alert md:text-6xl">
              {numberFormat.format(day.counts.reviewQueue)}
            </p>
            <p className="mt-5 font-editorial text-[15.5px] font-medium text-cool">
              reached the clinician review queue
            </p>
            <p className="mt-1.5 font-editorial text-[14px] leading-relaxed text-cool/70">
              each one placed there by a registered rule.
            </p>
          </div>
          <div className="rounded-2xl border border-grid bg-panel p-8">
            <p className="font-editorial text-5xl font-semibold leading-none tracking-[-0.02em] text-cool md:text-6xl">
              {day.counts.automatedPct}%
            </p>
            <p className="mt-5 font-editorial text-[15.5px] font-medium text-cool">
              resolved by the registered rules
            </p>
            <p className="mt-1.5 font-editorial text-[14px] leading-relaxed text-cool/70">
              no AI in the decision loop.
            </p>
          </div>
        </div>

        <div className="mt-12 text-center">
          <Link
            href="/sandbox"
            className="inline-flex min-h-12 items-center rounded-xl bg-alert px-6 font-editorial text-[15.5px] font-semibold text-terminal transition-colors hover:opacity-90"
          >
            Run the overnight round yourself →
          </Link>
          <p className="mx-auto mt-6 max-w-xl font-editorial text-[12.5px] leading-relaxed text-cool/70">
            Illustrative workflow demonstration on synthetic data — not a
            clinical outcome or staffing claim.
          </p>
        </div>
      </div>
    </section>
  );
}
