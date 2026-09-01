import Link from "next/link";

const FLOW_STEPS = [
  {
    number: "01",
    layer: "Synthetic input",
    title: "A fictional patient answers",
    body: "Typed or opt-in voice input starts as an explicitly synthetic demonstration.",
    accent: "bg-stone",
  },
  {
    number: "02",
    layer: "Input safety",
    title: "Deterministic preflight runs",
    body: "Selected emergency phrases and obvious identifier patterns can trigger a bounded response before the model.",
    accent: "bg-alert",
  },
  {
    number: "03",
    layer: "Language layer",
    title: "AI structures the conversation",
    body: "English or Spanish responses become bounded fields; facts the visitor did not provide stay unknown.",
    accent: "bg-violet-600",
  },
  {
    number: "04",
    layer: "Output safety",
    title: "Supported generated text is screened",
    body: "On generated paraphrase and small-talk paths, selected prescriptive wording can trigger a canonical replacement.",
    accent: "bg-blue-500",
  },
  {
    number: "05",
    layer: "Registered rules",
    title: "The registry sets the simulated disposition",
    body: "Named rules and documented monitoring-gap policies — including required-input gaps — route the fictional case.",
    accent: "bg-signal",
  },
  {
    number: "06",
    layer: "Review record",
    title: "Displayed evidence meets human review",
    body: "The receipt shows source, extraction, unknowns, rule ID, disposition, and the human next action.",
    accent: "bg-cool",
  },
];

const RESPONSIBILITY_LAYERS = [
  {
    label: "AI language",
    detail: "Converses, extracts, drafts, and narrates",
    accent: "bg-violet-600",
  },
  {
    label: "Registered rules",
    detail: "Rules and gap policies set simulated routing",
    accent: "bg-signal",
  },
  {
    label: "Human review",
    detail: "Verifies evidence and authorizes action",
    accent: "bg-alert",
  },
];

const CAPABILITIES = [
  {
    eyebrow: "Command Center + Impact",
    title: "Run the overnight round",
    body: "Process 500, 2,500, or 5,000 synthetic check-ins, replay five clinic days, and inspect tour behavior in Impact — never presented as clinical efficacy.",
  },
  {
    eyebrow: "Outreach + Daily Loop + Patient 360",
    title: "Move from signal to closed loop",
    body: "Inspect source freshness, work the review queue, call a synthetic persona, open the 60-second brief, document the outcome, and route the next owner.",
  },
  {
    eyebrow: "Patient Today",
    title: "Try daily and titration check-ins",
    body: "Play the patient in bounded English or Spanish conversations by tap, text, or optional voice. The microphone starts off and unknown answers stay visible.",
  },
  {
    eyebrow: "Provider copilot",
    title: "Hear the morning brief",
    body: "Run three simulated calls, follow call-by-call progress, hear the queue summary, and inspect the tools behind each answer.",
  },
  {
    eyebrow: "Assisted SBAR",
    title: "Compare before accepting",
    body: "AI may propose Situation and Background wording. Accept, reject, or undo it; Assessment and Recommendation remain clinician-owned.",
  },
  {
    eyebrow: "Pathways + Coordination",
    title: "Keep protocol context and ownership together",
    body: "Move from the patient brief into the relevant protocol pathway, then make the owner, deadline, and next handoff explicit in the fictional workflow.",
  },
  {
    eyebrow: "Safety + Evidence Flow",
    title: "See what the system refuses to hide",
    body: "Selected phrase and identifier screens, generated-language safeguards on supported paths, capacity fallbacks, Evidence Flow, and Decision Receipts remain visible.",
  },
  {
    eyebrow: "Protocol guide",
    title: "Ask with the source still attached",
    body: "A bounded assistant answers from published HEARTLAND content and keeps the supporting references visible for review.",
  },
  {
    eyebrow: "Explain this result",
    title: "Translate without recalculating",
    body: "Deterministic public tools can request a plain-language explanation without allowing the AI layer to change the score or threshold result.",
  },
];

export function AutomationEvidence() {
  return (
    <section id="evidence-lab" className="border-b border-grid bg-panel" data-testid="landing-evidence-lab">
      <div className="mx-auto max-w-[1200px] px-6 py-24 md:py-32">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-7">
            <p className="font-editorial text-[12.5px] uppercase tracking-[0.18em] text-alert">
              The Evidence Lab
            </p>
            <h2 className="mt-5 max-w-3xl text-[clamp(2rem,4.2vw,3.5rem)] font-editorial font-semibold leading-[1.05] tracking-[-0.02em] text-cool">
              See what the system does —{" "}
              <span className="font-display italic font-normal text-alert">
                and what it never decides.
              </span>
            </h2>
            <p className="mt-6 max-w-2xl font-editorial text-[15.5px] leading-relaxed text-cool/75">
              The public sandbox turns automation into an inspectable workflow.
              AI handles bounded language tasks; registered rules set simulated dispositions;
              people own clinical judgment and the next action.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:col-span-5">
            {RESPONSIBILITY_LAYERS.map((layer) => (
              <div key={layer.label} className="rounded-2xl border border-grid bg-terminal p-4">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${layer.accent}`} aria-hidden="true" />
                  <p className="font-editorial text-[10.5px] font-semibold uppercase tracking-[0.12em] text-cool">
                    {layer.label}
                  </p>
                </div>
                <p className="mt-2 font-editorial text-[11.5px] leading-relaxed text-cool/75">
                  {layer.detail}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-14 rounded-3xl border border-grid bg-terminal p-5 md:p-8">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <p className="font-editorial text-[11px] uppercase tracking-[0.18em] text-stone">
                One example, layer by layer
              </p>
              <h3 className="mt-2 font-editorial text-[22px] font-semibold text-cool">
                An inspectable workflow record
              </h3>
            </div>
            <p className="max-w-lg font-editorial text-[13px] leading-relaxed text-cool/80">
              The interface labels each displayed role so a fluent sentence cannot
              masquerade as a registered rule or a human authorization.
            </p>
          </div>

          <ol className="mt-8 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
            {FLOW_STEPS.map((step) => (
              <li key={step.number} className="rounded-2xl border border-grid bg-panel p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2 font-editorial text-[11px] font-semibold uppercase tracking-[0.16em] text-cool">
                    <span className={`h-2 w-2 rounded-full ${step.accent}`} aria-hidden="true" />
                    {step.layer}
                  </span>
                  <span className="font-mono-editorial text-[11px] text-cool/70">{step.number}</span>
                </div>
                <p className="mt-5 font-editorial text-[14px] font-semibold leading-snug text-cool">
                  {step.title}
                </p>
                <p className="mt-2 font-editorial text-[12.5px] leading-relaxed text-cool/80">
                  {step.body}
                </p>
              </li>
            ))}
          </ol>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {CAPABILITIES.map((capability) => (
            <article key={capability.eyebrow} className="rounded-2xl border border-grid bg-terminal p-6">
              <p className="font-editorial text-[11px] font-semibold uppercase tracking-[0.16em] text-alert">
                {capability.eyebrow}
              </p>
              <h3 className="mt-3 font-editorial text-[18px] font-semibold tracking-tight text-cool">
                {capability.title}
              </h3>
              <p className="mt-3 font-editorial text-[13.5px] leading-relaxed text-cool/75">
                {capability.body}
              </p>
            </article>
          ))}
        </div>

        <div className="mt-10 flex flex-col gap-5 rounded-2xl border border-alert/30 bg-alert/10 p-6 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="font-editorial text-[16px] font-semibold text-cool">
              Walk through the complete synthetic workflow in about five minutes.
            </p>
            <p className="mt-1 max-w-2xl font-editorial text-[12.5px] leading-relaxed text-cool/80">
              Demonstration only. Do not enter real patient, personal, or health
              information. The sandbox does not authorize real-world or unsupervised clinical use.
            </p>
          </div>
          <Link
            href="/sandbox"
            className="inline-flex min-h-12 shrink-0 items-center justify-center rounded-xl bg-alert px-6 font-editorial text-[15px] font-semibold text-terminal transition-colors hover:bg-cool hover:text-terminal"
          >
            Open the Evidence Lab →
          </Link>
        </div>
      </div>
    </section>
  );
}
