type Module = {
  title: string;
  body: string;
};

const MODULES: Module[] = [
  {
    title: "Risk stratification",
    body: "Explore the proposed ten-variable HEARTLAND score, including distance to cardiology and social support. Outcome validation remains a research objective.",
  },
  {
    title: "GDMT optimization",
    body: "Inspect HFrEF, HFmrEF and HFpEF pathways, evidence tiers and generic-bridge cost examples. Prices and patient suitability require independent verification.",
  },
  {
    title: "Telephone titration",
    body: "Walk through a telephone checklist with renal-function and potassium gates. Source studies provide context, not validation of this app's titration workflow.",
  },
  {
    title: "Discharge transitions",
    body: "Explore SBAR handoff, follow-up planning and medication reconciliation. A generated handoff still requires review and an accountable recipient.",
  },
  {
    title: "Remote monitoring",
    body: "Compare digital and analog workflow options by connectivity and literacy, with a billing reference. Telephone reports are not equivalent to connected-device measurements.",
  },
  {
    title: "Comorbidity care",
    body: "Inspect Cardio-Kidney-Metabolic staging, quality metrics and contextual prompts for diabetes, CKD, AF and obesity using fictional cases.",
  },
  {
    title: "Primary-care linkage",
    body: "Map roles, triggers and shared documentation between discharge and longitudinal primary care. A recorded assignment does not confirm delivery or follow-up.",
  },
  {
    title: "Implementation tier",
    body: "Explore Tier 1 / 2 / 3 resource profiles and planning checklists. A tier is not authorization to activate a clinical service.",
  },
];

export function Modules() {
  return (
    <section aria-labelledby="modules-title" className="border-b border-grid bg-terminal">
      <div className="mx-auto max-w-[1200px] px-6 py-14 md:py-20">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-12 md:gap-12">
          <div className="md:col-span-5">
            <p className="font-editorial text-sm uppercase tracking-[0.14em] text-signal">
              What&rsquo;s inside
            </p>
            <h2 id="modules-title" className="mt-5 text-[clamp(2rem,4vw,3.25rem)] font-editorial font-semibold leading-[1.15] tracking-[-0.02em] text-cool">
              Eight modules,{" "}
              <span className="font-display italic font-normal text-cool/70">
                one shared protocol.
              </span>
            </h2>
            <p className="mt-6 max-w-md font-editorial text-base leading-relaxed text-cool/80">
              Educational tools for inspecting the published framework, including
              low-bandwidth and paper-based workflows. Content availability does
              not establish clinical readiness.
            </p>
          </div>
          <div className="md:col-span-7" />
        </div>

        <div className="mt-12 grid grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-5">
          {MODULES.map((m) => (
            <article
              key={m.title}
              className="panel flex h-full flex-col p-5"
            >
              <h3 className="font-editorial text-lg font-semibold leading-snug text-cool">
                {m.title}
              </h3>
              <p className="mt-2 grow font-editorial text-base leading-relaxed text-cool/80">
                {m.body}
              </p>

            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
