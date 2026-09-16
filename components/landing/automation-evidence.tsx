import Link from "next/link";
import { APP_VERSION } from "@/lib/app-version";

const FLOW_STEPS = [
  {
    number: "01",
    title: "Collection",
    body: "Start with the answer, its source and its time.",
    source: 'Fictional check-in: “I did not record my weight today.”',
    record: "Demo day 1, 09:00 · typed answer · weight not provided.",
    owner: "Visitor playing a fictional patient. Voice is optional and starts off.",
  },
  {
    number: "02",
    title: "Record",
    body: "Keep what was said separate from what was extracted.",
    source: "The original answer remains the reference for this explanation.",
    record: "Weight: unknown. No value is invented to complete the record.",
    owner: "AI can structure language; selected input and generated-text screens apply on supported paths.",
  },
  {
    number: "03",
    title: "Signal",
    body: "Make missing information visible to the reviewer.",
    source: "A required answer is missing in this fictional check-in.",
    record: "Monitoring gap for review — not a diagnosis or a normal result.",
    owner: "Registered rules and documented gap policies set simulated routing, not the language model.",
  },
  {
    number: "04",
    title: "Human review",
    body: "Show the evidence before choosing the next action.",
    source: "Source answer, unknown fields and routing reason are available together.",
    record: "Example owner: demo reviewer. Next step: clarify the missing answer.",
    owner: "A person verifies context. AI wording is a proposal, never clinical authorization.",
  },
  {
    number: "05",
    title: "Documented outcome",
    body: "Record what happened, not just that a button was pressed.",
    source: "Illustrated outcome: clarification still pending with the demo reviewer.",
    record: "No real contact, delivery or clinical benefit is demonstrated.",
    owner: "People own follow-up and closure. A saved or acknowledged receipt is not clinical review.",
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
    <section id="evidence-lab" className="border-b border-grid bg-panel font-editorial [overflow-wrap:anywhere]" data-testid="landing-evidence-lab">
      <div className="mx-auto max-w-[1200px] px-6 py-24 md:py-32">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-7">
            <p className="text-sm uppercase tracking-[0.18em] text-alert">
              The Evidence Lab
            </p>
            <h2 className="mt-5 max-w-3xl text-[clamp(2rem,4.2vw,3.5rem)] font-editorial font-semibold leading-[1.05] tracking-[-0.02em] text-cool">
              See what the system does —{" "}
              <span className="font-display italic font-normal text-alert">
                and what it never decides.
              </span>
            </h2>
            <p className="mt-6 max-w-2xl text-base leading-relaxed text-cool/80">
              The public sandbox turns automation into an inspectable workflow.
              AI handles bounded language tasks; registered rules set simulated dispositions;
              people own clinical judgment and the next action.
            </p>
          </div>

          <div data-testid="responsibility-layers" className="grid grid-cols-1 gap-3 lg:col-span-5">
            {RESPONSIBILITY_LAYERS.map((layer) => (
              <div key={layer.label} className="rounded-2xl border border-grid bg-terminal p-4">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${layer.accent}`} aria-hidden="true" />
                  <p className="text-sm font-semibold text-cool">
                    {layer.label}
                  </p>
                </div>
                <p className="mt-2 text-base leading-relaxed text-cool/80">
                  {layer.detail}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div data-testid="synthetic-walkthrough" className="mt-14 rounded-3xl border border-grid bg-terminal p-5 md:p-8">
          <p className="text-sm font-semibold text-alert">Synthetic walkthrough · No clinical care</p>
          <h3 className="mt-3 text-2xl font-semibold text-cool">One answer, five visible handoffs.</h3>
          <p className="mt-4 max-w-3xl text-base leading-relaxed text-cool/80">
            Open each step to follow a fixed fictional example. This explanation does not run AI,
            save a patient record or contact anyone. It is not the laboratory recovery candidate below.
          </p>
          <ol className="mt-8 space-y-3">
            {FLOW_STEPS.map((step) => (
              <li key={step.number}>
                <details open={step.number === "01"} className="group rounded-2xl border border-grid bg-panel">
                  <summary className="min-h-12 cursor-pointer rounded-2xl px-5 py-5 text-cool marker:text-alert focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-alert">
                    <span className="ml-2 text-sm font-semibold text-alert">{step.number}</span>{" "}
                    <span className="ml-2 text-lg font-semibold">{step.title}</span>
                    <span className="mt-2 block text-base leading-relaxed text-cool/80">{step.body}</span>
                  </summary>
                  <dl className="grid gap-5 border-t border-grid px-5 py-5 text-base leading-relaxed md:grid-cols-3">
                    <div><dt className="text-sm font-semibold text-alert">Source</dt><dd className="mt-2 text-cool/80">{step.source}</dd></div>
                    <div><dt className="text-sm font-semibold text-alert">What changes</dt><dd className="mt-2 text-cool/80">{step.record}</dd></div>
                    <div><dt className="text-sm font-semibold text-alert">Responsibility</dt><dd className="mt-2 text-cool/80">{step.owner}</dd></div>
                  </dl>
                </details>
              </li>
            ))}
          </ol>
        </div>

        <div className="mt-14">
          <p className="text-sm font-semibold text-signal">Published release · {APP_VERSION}</p>
          <h3 className="mt-3 text-2xl font-semibold text-cool">Choose what to explore.</h3>
          <p className="mt-3 max-w-3xl text-base leading-relaxed text-cool/80">These capabilities belong to the published App baseline. Public interactions are synthetic; AI availability is bounded by capacity and safety controls.</p>
        </div>
        <div data-testid="published-capabilities" className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {CAPABILITIES.map((capability) => (
            <article key={capability.eyebrow} className="min-w-0 break-words rounded-2xl border border-grid bg-terminal p-6">
              <p className="text-sm font-semibold text-alert">
                {capability.eyebrow}
              </p>
              <h3 className="mt-3 font-editorial text-[18px] font-semibold tracking-tight text-cool">
                {capability.title}
              </h3>
              <p className="mt-3 text-base leading-relaxed text-cool/80">
                {capability.body}
              </p>
            </article>
          ))}
        </div>

        <div className="mt-10 flex flex-col flex-wrap gap-5 rounded-2xl border border-alert/30 bg-alert/10 p-6 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0 flex-1">
            <p className="font-editorial text-[16px] font-semibold text-cool">
              Try the published synthetic workflow.
            </p>
            <p className="mt-2 max-w-2xl text-base leading-relaxed text-cool/80">
              Demonstration only. Do not enter real patient, personal, or health
              information. The sandbox does not authorize real-world or unsupervised clinical use.
            </p>
          </div>
          <Link
            href="/sandbox"
            prefetch={false}
            className="inline-flex min-h-12 max-w-full items-center justify-center rounded-xl bg-alert px-6 py-3 text-center text-base font-semibold text-white transition-colors hover:bg-cool focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-alert"
          >
            Open the Evidence Lab →
          </Link>
        </div>
        <aside data-testid="local-candidate" aria-labelledby="lab-candidate-title" className="mt-10 rounded-3xl border-2 border-dashed border-cool/40 bg-terminal p-6 md:p-8">
          <p className="text-sm font-semibold text-cool">Local candidate · Not deployed</p>
          <h3 id="lab-candidate-title" className="mt-3 text-2xl font-semibold text-cool">Laboratory submission recovery</h3>
          <p className="mt-4 max-w-3xl text-base leading-relaxed text-cool/80">Implemented and tested locally; not available in the public sandbox or hosted workspace. Hosted integration and coordinated rollout remain pending.</p>
          <dl className="mt-6 grid gap-6 text-base leading-relaxed md:grid-cols-2">
            <div><dt className="font-semibold text-cool">Keep the collection time</dt><dd className="mt-2 text-cool/80">Reports retain the recorded collection time. Patient-summary printouts label a missing classification “Not recorded”; CSV leaves it blank. Neither export assumes “Normal”.</dd></div>
            <div><dt className="font-semibold text-cool">Separate save from evaluation</dt><dd className="mt-2 text-cool/80">A saved-result receipt and pending alert evaluation are distinct states. Retrying evaluation does not insert another exam.</dd></div>
            <div><dt className="font-semibold text-cool">Return without resending</dt><dd className="mt-2 text-cool/80">A prepared submission can be checked after leaving the page. Recovery reads its saved receipt; it does not retransmit the exam or recreate unsaved values.</dd></div>
            <div><dt className="font-semibold text-cool">Acknowledge or cancel explicitly</dt><dd className="mt-2 text-cool/80">Acknowledgment is not clinical review. Protected cancellation rejects a late submission; it does not erase a saved result.</dd></div>
          </dl>
          <p className="mt-6 border-t border-grid pt-5 text-base leading-relaxed text-cool/80">Earlier submissions without a prepared attempt still need their exact known identifier. Revised English/Spanish scripts are also local; matching audio review is pending.</p>
        </aside>
      </div>
    </section>
  );
}
