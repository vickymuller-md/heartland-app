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
            save a patient record or contact anyone. The dated implementation states below are separate from this illustration.
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
          <p className="mt-3 max-w-3xl text-base leading-relaxed text-cool/80">These capabilities do not guarantee that every mode is currently enabled. Public interactions are synthetic; capacity and safety controls apply. See the separate audio-release and implementation states below.</p>
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
          <p className="text-sm font-semibold text-cool">Implementation status · Deployed 1 October 2026</p>
          <h3 id="lab-candidate-title" className="mt-3 text-2xl font-semibold text-cool">What is deployed, what is inactive, what still needs approval.</h3>
          <p className="mt-4 max-w-3xl text-base leading-relaxed text-cool/80">A software archive, a deployment and clinical approval are different kinds of evidence. This dated summary is not a live service-status check or authorization for patient care.</p>
          <div data-testid="recorded-checkpoint" className="mt-6 rounded-2xl border border-grid bg-panel p-5">
            <p className="text-sm font-semibold text-signal">Recorded deployment checkpoint · 30 September 2026</p>
            <h4 className="mt-3 text-xl font-semibold text-cool">Laboratory submission recovery</h4>
            <dl className="mt-4 grid gap-5 text-base leading-relaxed md:grid-cols-2">
              <div><dt className="font-semibold text-cool">Collection and reports</dt><dd className="mt-2 text-cool/80">The controlled workspace keeps collection time. Patient-summary printouts label a missing classification “Not recorded”; CSV leaves it blank. Neither export assumes “Normal”.</dd></div>
              <div><dt className="font-semibold text-cool">Save, evaluate, then recover</dt><dd className="mt-2 text-cool/80">A saved result and pending evaluation are distinct. A prepared attempt supports recovery without resending the exam. Acknowledgment is not clinical review; cancellation does not erase a saved result.</dd></div>
            </dl>
            <p className="mt-4 text-base leading-relaxed text-cool/80">These are registered-workspace controls, not a public exam-submission service. Earlier submissions without a prepared attempt need their exact known identifier. This checkpoint does not create a new software archive.</p>
          </div>
          <div data-testid="deployment-expansion" className="mt-6 rounded-2xl border border-dashed border-cool/40 p-5">
            <p className="text-sm font-semibold text-[#b4372d]">Deployment expansion · Controlled evaluation only</p>
            <h4 className="mt-3 text-xl font-semibold text-cool">Recovery, ownership and visible pending work</h4>
            <dl className="mt-4 grid gap-5 text-base leading-relaxed md:grid-cols-2">
              <div><dt className="font-semibold text-cool">Recover the saved observation</dt><dd className="mt-2 text-cool/80">The deployed workspace supports receipted individual and batch vital/symptom submissions and recovery without resending observations. Periodic-scan recovery is implemented but remains disabled.</dd></div>
              <div><dt className="font-semibold text-cool">Show who can act</dt><dd className="mt-2 text-cool/80">Organization-scoped owner selection, recoverable reassignment requests and restricted exception views make unresolved work visible. A captured notification intent is not a sent message; the new transport remains inactive.</dd></div>
              <div><dt className="font-semibold text-cool">Trace the documented workflow</dt><dd className="mt-2 text-cool/80">Requests, laboratory source versions, human review records and contact documentation retain separate receipts and unresolved barriers. A documented step does not prove external delivery or completed care.</dd></div>
              <div><dt className="font-semibold text-cool">Education and notification preferences</dt><dd className="mt-2 text-cool/80">Education responses use recoverable, session-bound submissions. Notification preferences are updated through authenticated, serialized requests. A saved response is not a clinical assessment; a preference is not proof that a message was delivered.</dd></div>
              <div><dt className="font-semibold text-cool">Rehearse without the App</dt><dd className="mt-2 text-cool/80">Published Toolkit V3.4 is accompanied by offline readiness worksheets, handoff/contact logs and 12 synthetic training scenarios. Prepared material is not evidence of completed training or clinical adoption; prototype cards retain their stated distribution restrictions.</dd></div>
              <div><dt className="font-semibold text-cool">Listen to bounded synthetic demonstrations</dt><dd className="mt-2 text-cool/80">58 prerecorded clips have recording-specific authorization for synthetic sandbox playback, while preserving text simulation. Clinical script acceptance, automated source-to-transcript checks and release authorization are recorded separately. This is not human-listening certification or patient communication. Only verified immutable recordings play; changed or revoked recordings remain blocked.</dd></div>
            </dl>
          </div>
          <p className="mt-6 border-t border-grid pt-5 text-base leading-relaxed text-cool/80">Verification: synthetic authenticated integration checks passed in an isolated environment; hosted schema and read contracts were checked at deployment. Still gated: scheduled scans, external notification delivery and institution-specific operational approval. Script acceptance and synthetic audio release do not authorize real-patient use. Consult the publication section for the separately archived versions. No completed clinical cycle, real-world activation or validated outcome is claimed.</p>
        </aside>
      </div>
    </section>
  );
}
