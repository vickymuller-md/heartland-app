/**
 * Evidence — five anchoring trials presented as a calm reading list.
 * Subtle dividers, no table-headers, no "lab result" framing.
 */

const ROWS = [
  {
    trial: "EMPEROR-Preserved",
    citation: "NEJM, 2021",
    finding:
      "SGLT2 inhibitors reduce cardiovascular death and HF hospitalization in HFpEF.",
  },
  {
    trial: "FINEARTS-HF",
    citation: "NEJM, 2024",
    finding:
      "Finerenone delivers a 16% reduction in cardiovascular death and HF events.",
  },
  {
    trial: "Hozho Trial",
    citation: "JAMA Internal Medicine, 2024",
    finding:
      "53% absolute increase in GDMT class addition via voice-telephone titration in rural Navajo Nation.",
  },
  {
    trial: "STRONG-HF",
    citation: "Lancet, 2022",
    finding:
      "Rapid up-titration within two weeks of discharge proves both safe and effective.",
  },
  {
    trial: "TIM-HF2",
    citation: "Lancet, 2018",
    finding:
      "30% all-cause mortality reduction with structured remote monitoring.",
  },
];

export function EvidenceFoundation() {
  return (
    <section className="border-b border-grid bg-panel-hi/40">
      <div className="mx-auto max-w-[1200px] px-6 py-24 md:py-32">
        <div className="grid grid-cols-1 gap-12 md:grid-cols-12 md:gap-16">
          <header className="md:col-span-4">
            <p className="font-editorial text-[12.5px] uppercase tracking-[0.18em] text-alert">
              Evidence
            </p>
            <h2 className="mt-5 text-[clamp(1.85rem,3.5vw,2.85rem)] font-editorial font-semibold leading-[1.1] tracking-[-0.02em] text-cool">
              Anchored in{" "}
              <span className="font-display italic font-normal text-cool/70">
                five trials
              </span>
              .
            </h2>
            <p className="mt-6 max-w-sm font-editorial text-[15px] leading-relaxed text-cool/70">
              Each module is integrated with the highest-quality evidence
              available. Full reference list — 71 citations — accompanies
              the Cureus article and Zenodo / OSF deposits.
            </p>
          </header>

          <ul className="md:col-span-8">
            {ROWS.map((row, i) => (
              <li
                key={row.trial}
                className={
                  "grid grid-cols-1 gap-3 py-7 md:grid-cols-12 md:items-baseline md:gap-8 " +
                  (i === 0 ? "" : "border-t border-grid")
                }
              >
                <div className="md:col-span-4">
                  <p className="font-editorial text-[18px] font-semibold tracking-tight text-cool">
                    {row.trial}
                  </p>
                  <p className="mt-1 font-editorial text-[13px] text-stone">
                    {row.citation}
                  </p>
                </div>
                <p className="md:col-span-8 font-editorial text-[15px] leading-relaxed text-cool/80">
                  {row.finding}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
