/**
 * "Why Heartland exists" — three soft stat cards + a closing line.
 * Replaces the dense vital-signs chart with a more breathable
 * problem-statement layout. No literal medical-form structure.
 */
export function Abstract() {
  return (
    <section className="border-y border-grid bg-panel">
      <div className="mx-auto max-w-[1200px] px-6 py-24 md:py-32">
        <div className="mx-auto max-w-3xl text-center">
          <p className="font-editorial text-[12.5px] uppercase tracking-[0.18em] text-alert">
            Why Heartland exists
          </p>
          <h2 className="mt-5 text-[clamp(1.85rem,3.5vw,2.85rem)] font-editorial font-semibold leading-[1.15] tracking-[-0.015em] text-cool">
            Most rural Americans live in a{" "}
            <span className="font-display italic font-normal text-alert">
              cardiology desert
            </span>
            . Heartland gives their primary care team a working framework.
          </h2>
        </div>

        <div className="mt-16 grid grid-cols-1 gap-6 md:grid-cols-3 md:gap-8">
          <StatCard
            value="86%"
            heading="of rural counties"
            note="have no practicing cardiologist."
          />
          <StatCard
            value="+53%"
            heading="excess HF mortality"
            note="in rural communities versus urban."
            accent
          />
          <StatCard
            value="< 1%"
            heading="of patients"
            note="reach all four GDMT therapeutic targets."
          />
        </div>

        <p className="mx-auto mt-16 max-w-2xl text-center font-editorial text-[15.5px] leading-relaxed text-cool/75">
          GWTG-HF and ESC-HF-LT are registries. MAGGIC and SHFM are
          prognostic calculators. None is a clinical operating system for
          rural primary care.{" "}
          <span className="text-cool">Heartland is.</span>
        </p>

        {/* Required disclaimers — verbatim text mandated by NIW_INTEGRATION.md */}
        <div className="mt-20 grid grid-cols-1 gap-5 md:grid-cols-2 md:gap-6">
          <Disclaimer heading="Professional use only">
            Public tools are an educational sandbox. The authenticated workspace
            is a controlled evaluation environment, not authorization for real
            PHI or unsupervised clinical use. Outputs do not replace independent
            review, clinical judgment, or institutional policy.
          </Disclaimer>
          <Disclaimer heading="Framework in development">
            The HEARTLAND Risk Stratification Framework is a proposed tool
            under development. It has not been validated against clinical
            outcomes data. Formal validation through registry data is a
            defined research objective.
          </Disclaimer>
        </div>
      </div>
    </section>
  );
}

function Disclaimer({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <aside
      role="note"
      aria-label="Clinical use disclaimer"
      className="rounded-2xl border border-grid bg-terminal p-6"
    >
      <p className="font-editorial text-[12.5px] uppercase tracking-[0.14em] text-alert">
        {heading}
      </p>
      <p className="mt-3 font-editorial text-[14px] leading-relaxed text-cool/75">
        {children}
      </p>
    </aside>
  );
}

function StatCard({
  value,
  heading,
  note,
  accent,
}: {
  value: string;
  heading: string;
  note: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-grid bg-terminal p-8 transition-colors hover:border-cool/40">
      <p
        className={
          "font-editorial text-5xl font-semibold leading-none tracking-[-0.02em] md:text-6xl " +
          (accent ? "text-alert" : "text-cool")
        }
      >
        {value}
      </p>
      <p className="mt-5 font-editorial text-[15.5px] font-medium text-cool">
        {heading}
      </p>
      <p className="mt-1.5 font-editorial text-[14px] leading-relaxed text-cool/65">
        {note}
      </p>
    </div>
  );
}
