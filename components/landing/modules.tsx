/**
 * "What's inside" — eight modules as warm, breathable cards. Soft
 * rounded shapes, generous padding, light icon glyphs. No medical
 * RX symbols, no terminal codes, no order/line numbers.
 */

type Module = {
  title: string;
  body: string;
  icon: React.ReactNode;
  available: boolean;
};

function Glyph({ d }: { d: string }) {
  return (
    <svg
      className="h-7 w-7 text-alert"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

const MODULES: Module[] = [
  {
    title: "Risk stratification",
    body: "Explore the proposed ten-variable HEARTLAND score, including distance to cardiology and social support. Outcome validation remains a research objective.",
    icon: (
      <Glyph d="M 4 18 L 9 9 L 13 14 L 17 5 L 20 11 M 4 21 H 20" />
    ),
    available: true,
  },
  {
    title: "GDMT optimization",
    body: "Inspect HFrEF, HFmrEF and HFpEF pathways, evidence tiers and generic-bridge cost examples. Prices and patient suitability require independent verification.",
    icon: <Glyph d="M 8 3 H 16 V 9 L 21 14 V 21 H 3 V 14 L 8 9 Z M 12 14 V 18" />,
    available: true,
  },
  {
    title: "Telephone titration",
    body: "Walk through a telephone checklist with renal-function and potassium gates. Source studies provide context, not validation of this app's titration workflow.",
    icon: (
      <Glyph d="M 5 5 C 5 16 8 19 19 19 V 15 L 15 14 L 13 16 C 11 15 9 13 8 11 L 10 9 L 9 5 Z" />
    ),
    available: true,
  },
  {
    title: "Discharge transitions",
    body: "Explore SBAR handoff, follow-up planning and medication reconciliation. A generated handoff still requires review and an accountable recipient.",
    icon: <Glyph d="M 4 4 H 16 L 20 8 V 20 H 4 Z M 16 4 V 8 H 20 M 8 13 H 16 M 8 17 H 14" />,
    available: true,
  },
  {
    title: "Remote monitoring",
    body: "Compare digital and analog workflow options by connectivity and literacy, with a billing reference. Telephone reports are not equivalent to connected-device measurements.",
    icon: <Glyph d="M 3 12 H 6 L 8 7 L 11 17 L 14 9 L 16 12 H 21" />,
    available: true,
  },
  {
    title: "Comorbidity care",
    body: "Inspect Cardio-Kidney-Metabolic staging, quality metrics and contextual prompts for diabetes, CKD, AF and obesity using fictional cases.",
    icon: <Glyph d="M 12 3 C 16 7 19 11 19 14 a 7 7 0 0 1 -14 0 C 5 11 8 7 12 3 Z" />,
    available: true,
  },
  {
    title: "Primary-care linkage",
    body: "Map roles, triggers and shared documentation between discharge and longitudinal primary care. A recorded assignment does not confirm delivery or follow-up.",
    icon: (
      <Glyph d="M 8 7 a 3 3 0 1 0 0 -0.1 Z M 16 7 a 3 3 0 1 0 0 -0.1 Z M 4 19 c 0 -3 2 -5 4 -5 c 2 0 4 2 4 5 M 12 19 c 0 -3 2 -5 4 -5 c 2 0 4 2 4 5" />
    ),
    available: true,
  },
  {
    title: "Implementation tier",
    body: "Explore Tier 1 / 2 / 3 resource profiles and planning checklists. A tier is not authorization to activate a clinical service.",
    icon: <Glyph d="M 4 20 V 12 H 9 V 20 Z M 9 20 V 8 H 15 V 20 Z M 15 20 V 4 H 20 V 20 Z" />,
    available: true,
  },
];

export function Modules() {
  return (
    <section aria-labelledby="modules-title" className="border-b border-grid bg-terminal">
      <div className="mx-auto max-w-[1200px] px-6 py-24 md:py-32">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-12 md:gap-12">
          <div className="md:col-span-5">
            <p className="font-editorial text-sm uppercase tracking-[0.14em] text-alert">
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
              className="group flex h-full min-w-0 flex-col rounded-2xl border border-grid bg-panel p-6 transition-colors hover:border-cool/40"
            >
              <div className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-alert/10">
                {m.icon}
              </div>
              <h3 className="font-editorial text-lg font-semibold leading-snug text-cool">
                {m.title}
              </h3>
              <p className="mt-2 grow font-editorial text-base leading-relaxed text-cool/80">
                {m.body}
              </p>
              <p
                className={
                  "mt-5 inline-flex items-center gap-1.5 font-editorial text-sm " +
                  (m.available ? "text-signal" : "text-stone")
                }
              >
                {m.available ? "Educational module" : "Planned educational module"}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
