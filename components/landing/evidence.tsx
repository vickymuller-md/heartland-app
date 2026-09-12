/**
 * Evidence — five anchoring trials presented as a calm reading list.
 * Subtle dividers, no table-headers, no "lab result" framing.
 */

const ROWS = [
  {
    trial: "EMPEROR-Preserved",
    citation: "NEJM, 2021",
    finding:
      "A randomized trial of empagliflozin versus placebo, added to usual therapy, in symptomatic heart failure with mildly reduced or preserved ejection fraction.",
    href: "https://doi.org/10.1056/NEJMoa2107038",
  },
  {
    trial: "FINEARTS-HF",
    citation: "NEJM, 2024",
    finding:
      "A randomized trial of finerenone versus placebo, added to usual therapy, in heart failure with mildly reduced or preserved ejection fraction.",
    href: "https://doi.org/10.1056/NEJMoa2407107",
  },
  {
    trial: "Hózhó Trial",
    citation: "JAMA Internal Medicine, 2024",
    finding:
      "A randomized trial of clinician-led telephone medication optimization with home blood pressure monitoring in American Indian adults with reduced-ejection-fraction heart failure in Navajo Nation.",
    href: "https://jamanetwork.com/journals/jamainternalmedicine/fullarticle/2817466",
  },
  {
    trial: "STRONG-HF",
    citation: "Lancet, 2022",
    finding:
      "A randomized trial comparing medication intensification and close follow-up with usual care after hospitalization for acute heart failure.",
    href: "https://pubmed.ncbi.nlm.nih.gov/36356631/",
  },
  {
    trial: "TIM-HF2",
    citation: "Lancet, 2018",
    finding:
      "A randomized trial of structured remote management plus usual care versus usual care alone in selected patients in Germany with heart failure and a previous heart failure hospitalization.",
    href: "https://pubmed.ncbi.nlm.nih.gov/30153985/",
  },
];

export function EvidenceFoundation() {
  return (
    <section aria-labelledby="clinical-context-title" className="border-b border-grid bg-panel-hi/40">
      <div className="mx-auto max-w-[1200px] px-6 py-24 md:py-32">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <header className="min-w-0 break-words">
            <p className="font-editorial text-[12.5px] uppercase tracking-[0.18em] text-alert">
              Evidence
            </p>
            <h2 id="clinical-context-title" className="mt-5 text-[clamp(1.85rem,3.5vw,2.85rem)] font-editorial font-semibold leading-[1.1] tracking-[-0.02em] text-cool">
              Clinical context, not product validation
            </h2>
            <p className="mt-6 max-w-sm font-editorial text-base leading-relaxed text-cool/80">
              Five studies informing the clinical context. They evaluated their own treatments or care programs;
              they did not evaluate the HEARTLAND App or its AI. Populations, staffing and follow-up differ.
              These references are not individual treatment instructions.
            </p>
          </header>

          <ul className="min-w-0 break-words">
            {ROWS.map((row, i) => (
              <li
                key={row.trial}
                className={
                  "grid grid-cols-1 gap-3 py-7 " +
                  (i === 0 ? "" : "border-t border-grid")
                }
              >
                <div className="min-w-0">
                  <a href={row.href} className="inline-flex min-h-11 items-center font-editorial text-lg font-semibold tracking-tight text-cool underline decoration-alert underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-alert">
                    {row.trial} ↗
                  </a>
                  <p className="mt-1 font-editorial text-sm text-stone">
                    {row.citation}
                  </p>
                </div>
                <p className="font-editorial text-base leading-relaxed text-cool/80">
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
