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
    body: "Ten-variable HEARTLAND score that includes distance to cardiology and social support — variables that other tools omit.",
    icon: (
      <Glyph d="M 4 18 L 9 9 L 13 14 L 17 5 L 20 11 M 4 21 H 20" />
    ),
    available: true,
  },
  {
    title: "GDMT optimization",
    body: "HFrEF, HFmrEF, and HFpEF pathways with evidence tiers and a $15/month generic-bridge calculator for cost-bound patients.",
    icon: <Glyph d="M 8 3 H 16 V 9 L 21 14 V 21 H 3 V 14 L 8 9 Z M 12 14 V 18" />,
    available: true,
  },
  {
    title: "Telephone titration",
    body: "Hozho-trial-based phone workflow for safe up-titration with eGFR and potassium safety gates per drug.",
    icon: (
      <Glyph d="M 5 5 C 5 16 8 19 19 19 V 15 L 15 14 L 13 16 C 11 15 9 13 8 11 L 10 9 L 9 5 Z" />
    ),
    available: true,
  },
  {
    title: "Discharge transitions",
    body: "SBAR handoff, 48-hour follow-up, and medication reconciliation for hospitals without HF coordinators.",
    icon: <Glyph d="M 4 4 H 16 L 20 8 V 20 H 4 Z M 16 4 V 8 H 20 M 8 13 H 16 M 8 17 H 14" />,
    available: false,
  },
  {
    title: "Remote monitoring",
    body: "Digital vs analog track assignment by broadband and literacy. Billing reference for CPT 99453–99458.",
    icon: <Glyph d="M 3 12 H 6 L 8 7 L 11 17 L 14 9 L 16 12 H 21" />,
    available: true,
  },
  {
    title: "Comorbidity care",
    body: "Cardio-Kidney-Metabolic staging with quality metrics and prompts for diabetes, CKD, AF, and obesity.",
    icon: <Glyph d="M 12 3 C 16 7 19 11 19 14 a 7 7 0 0 1 -14 0 C 5 11 8 7 12 3 Z" />,
    available: true,
  },
  {
    title: "Primary-care linkage",
    body: "Warm-handoff protocol: roles, triggers, and shared documentation between discharge and longitudinal primary care.",
    icon: (
      <Glyph d="M 8 7 a 3 3 0 1 0 0 -0.1 Z M 16 7 a 3 3 0 1 0 0 -0.1 Z M 4 19 c 0 -3 2 -5 4 -5 c 2 0 4 2 4 5 M 12 19 c 0 -3 2 -5 4 -5 c 2 0 4 2 4 5" />
    ),
    available: false,
  },
  {
    title: "Implementation tier",
    body: "Facility self-assessment that returns Tier 1 / 2 / 3 with a customized adoption roadmap per resource profile.",
    icon: <Glyph d="M 4 20 V 12 H 9 V 20 Z M 9 20 V 8 H 15 V 20 Z M 15 20 V 4 H 20 V 20 Z" />,
    available: true,
  },
];

export function Modules() {
  return (
    <section className="border-b border-grid bg-terminal">
      <div className="mx-auto max-w-[1200px] px-6 py-24 md:py-32">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-12 md:gap-12">
          <div className="md:col-span-5">
            <p className="font-editorial text-[12.5px] uppercase tracking-[0.18em] text-alert">
              What&rsquo;s inside
            </p>
            <h2 className="mt-5 text-[clamp(2rem,4vw,3.25rem)] font-editorial font-semibold leading-[1.05] tracking-[-0.02em] text-cool">
              Eight modules,{" "}
              <span className="font-display italic font-normal text-cool/70">
                one shared protocol.
              </span>
            </h2>
            <p className="mt-6 max-w-md font-editorial text-[15.5px] leading-relaxed text-cool/70">
              Each module is a direct translation of the published protocol
              text — tested for non-specialist primary care teams and
              optimized for low-bandwidth, paper-tolerant workflows.
            </p>
          </div>
          <div className="md:col-span-7" />
        </div>

        <div className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {MODULES.map((m) => (
            <article
              key={m.title}
              className="group flex h-full flex-col rounded-2xl border border-grid bg-panel p-6 transition-all hover:-translate-y-0.5 hover:border-cool/40"
            >
              <div className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-alert/10">
                {m.icon}
              </div>
              <h3 className="font-editorial text-[17px] font-semibold tracking-tight text-cool">
                {m.title}
              </h3>
              <p className="mt-2 grow font-editorial text-[14px] leading-relaxed text-cool/70">
                {m.body}
              </p>
              <p
                className={
                  "mt-5 inline-flex items-center gap-1.5 font-editorial text-[12px] " +
                  (m.available ? "text-signal" : "text-stone")
                }
              >
                <span
                  aria-hidden
                  className={
                    "h-1.5 w-1.5 rounded-full " +
                    (m.available ? "bg-signal" : "bg-stone")
                  }
                />
                {m.available ? "Available now" : "Coming in Phase II"}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
