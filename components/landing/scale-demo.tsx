import Link from "next/link";
import { simulatePopulationDay } from "@/lib/sandbox/population";

/**
 * Illustrate the seeded sandbox scenario without equating queue exclusion
 * with resolution, review, staffing capacity or complete clinical coverage.
 */
export function ScaleDemo() {
  const day = simulatePopulationDay(2500, 0);
  const numberFormat = new Intl.NumberFormat("en-US");

  return (
    <section aria-labelledby="scale-title" className="border-b border-grid bg-terminal">
      <div className="mx-auto max-w-[1200px] px-6 py-24 md:py-32">
        <div className="mx-auto max-w-3xl text-center">
          <p className="font-editorial text-sm uppercase tracking-[0.14em] text-alert">
            The scale demonstration
          </p>
          <h2 id="scale-title" className="mt-5 text-[clamp(1.85rem,3.5vw,2.85rem)] font-editorial font-semibold leading-[1.15] tracking-[-0.015em] text-cool">
            Explore scale.{" "}
            <span className="font-display italic font-normal text-alert">
              Keep the unknowns visible.
            </span>
          </h2>
          <p className="mx-auto mt-6 max-w-2xl font-editorial text-base leading-relaxed text-cool/80">
            One fictional overnight round models check-ins, retry attempts and
            rule-based routing. These counts come from the same seeded population
            engine used in the sandbox, not from real patients or contacts.
          </p>
        </div>

        <div className="mt-14 grid grid-cols-[repeat(auto-fit,minmax(min(100%,18rem),1fr))] gap-6">
          <article aria-labelledby="scale-total" className="min-w-0 rounded-2xl border border-grid bg-panel p-6 md:p-8">
            <p className="font-editorial text-4xl font-semibold leading-tight tracking-[-0.02em] text-cool">
              {numberFormat.format(day.counts.total)}
            </p>
            <h3 id="scale-total" className="mt-5 font-editorial text-lg font-medium text-cool">
              Synthetic check-ins
            </h3>
            <p className="mt-2 font-editorial text-base leading-relaxed text-cool/80">
              Included in this simulated round; not a count of completed care.
            </p>
          </article>
          <article aria-labelledby="scale-queue" className="min-w-0 rounded-2xl border border-grid bg-panel p-6 md:p-8">
            <p className="font-editorial text-4xl font-semibold leading-tight tracking-[-0.02em] text-alert">
              {numberFormat.format(day.counts.reviewQueue)}
            </p>
            <h3 id="scale-queue" className="mt-5 font-editorial text-lg font-medium text-cool">
              Review queue reported by this scenario
            </h3>
            <p className="mt-2 font-editorial text-base leading-relaxed text-cool/80">
              A routing count; it does not demonstrate completed clinical reviews.
            </p>
          </article>
          <article aria-labelledby="scale-unanswered" className="min-w-0 rounded-2xl border border-grid bg-panel p-6 md:p-8">
            <p className="font-editorial text-4xl font-semibold leading-tight tracking-[-0.02em] text-cool">
              {numberFormat.format(day.counts.unresolvedNoAnswer)}
            </p>
            <h3 id="scale-unanswered" className="mt-5 font-editorial text-lg font-medium text-cool">
              Unanswered after simulated retry
            </h3>
            <p className="mt-2 font-editorial text-base leading-relaxed text-cool/80">
              Missing responses remain unknown, including when no clinical alert is shown.
            </p>
          </article>
        </div>

        <p className="mx-auto mt-8 max-w-3xl text-base leading-relaxed text-cool/80">
          Counts overlap and must not be added together: the review queue can
          include unanswered check-ins. Being outside the queue does not mean a
          case was resolved. The sandbox shows a limited set of example records,
          not proof that every case has been reviewed.
        </p>

        <div className="mt-12 text-center">
          <Link
            href="/sandbox"
            className="inline-flex min-h-12 max-w-full items-center rounded-xl bg-alert px-6 py-3 font-editorial text-base font-semibold text-terminal transition-colors hover:opacity-90"
          >
            Run the overnight round yourself →
          </Link>
          <p className="mx-auto mt-6 max-w-2xl font-editorial text-sm leading-relaxed text-cool/80">
            Illustrative workflow demonstration on synthetic data — not a
            clinical outcome, staffing estimate or coverage guarantee.
          </p>
        </div>
      </div>
    </section>
  );
}
