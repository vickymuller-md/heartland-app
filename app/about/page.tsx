import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About - HEARTLAND Protocol",
  description:
    "About the HEARTLAND Protocol clinical implementation companion",
};

export default function AboutPage() {
  return (
    <article className="mx-auto max-w-4xl px-4 py-8 space-y-8">
      <h1 className="text-3xl font-bold tracking-tight">
        About the HEARTLAND Protocol
      </h1>

      {/* ---------- What is the HEARTLAND Protocol? ---------- */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">
          What is the HEARTLAND Protocol?
        </h2>
        <p>
          Heart failure affects over 6.7 million Americans and causes more than
          1 million hospitalizations annually. While urban centers benefit from
          specialist access, rural populations face a 53% higher mortality rate,
          exacerbated by limited cardiology access — 86% of rural counties lack
          any cardiologist. This disparity is widening: young adults in rural
          areas experienced a 21% increase in cardiovascular mortality from
          2010-2022, compared to only 3% in urban areas.
        </p>
        <p>
          Despite strong clinical evidence for guideline-directed medical therapy
          (GDMT), fewer than 20% of eligible patients receive all four
          recommended medication classes simultaneously, and fewer than 1%
          achieve target doses across all agents. This is not a failure of
          evidence — it is a failure of implementation and access.
        </p>
        <p>
          The HEARTLAND Protocol addresses this gap. Published as a peer-reviewed
          Technical Report in Cureus (Springer Nature) and indexed in PubMed,
          PubMed Central, Scopus, and Google Scholar, it is the only published
          implementation protocol specifically designed for primary care-led
          heart failure management in rural U.S. settings, as confirmed by a
          structured PubMed search.
        </p>
      </section>

      {/* ---------- What This App Does ---------- */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">What This App Does</h2>
        <p>
          This app translates the eight HEARTLAND Protocol modules into
          interactive clinical implementation tools:
        </p>
        <ol className="list-decimal list-inside space-y-3 ml-2">
          <li>
            <strong>Risk Stratification Calculator</strong> — Calculate the
            HEARTLAND Risk Score using 10 variables including distance to
            cardiology care and social support, generating a risk tier
            (Low/Moderate/High) with recommended monitoring intensity and care
            pathways.
          </li>
          <li>
            <strong>GDMT Optimization Pathway</strong> — Interactive decision
            tree for HFrEF (quadruple therapy) and HFpEF (evolving evidence),
            with starting doses, target doses, safety gates, and the evidence
            labeling system that distinguishes established, emerging, and
            pragmatic recommendations.
          </li>
          <li>
            <strong>Telephone Titration Checklist</strong> — Step-by-step guided
            workflow for phone-based medication adjustment, adapted from the
            Hozho Trial methodology that demonstrated a 53% absolute increase in
            GDMT class addition using voice telephone calls in rural Navajo
            Nation.
          </li>
          <li>
            <strong>Remote Monitoring Track Assignment</strong> — Assess patient
            capability and assign Digital (Track A) or Analog (Track B)
            monitoring pathways, with alert thresholds and RPM billing code
            reference for financial sustainability.
          </li>
          <li>
            <strong>Generic Bridge Calculator</strong> — Demonstrate how
            foundational heart failure therapy can be initiated at approximately
            $15/month using generic medications, ensuring no patient remains
            untreated due to cost while optimal agents are pursued.
          </li>
          <li>
            <strong>Implementation Tier Selector</strong> — Questionnaire-based
            assessment of facility resources, staffing, and technology to
            recommend Tier 1 (Minimal), Tier 2 (Standard), or Tier 3 (Advanced)
            implementation, with customized checklists for each tier.
          </li>
          <li>
            <strong>Pocket Card Library</strong> — Digital versions of all
            clinical reference tools: GDMT Quick Reference, Red Flags Alert
            Card, Patient Daily Monitoring Diary, Track Assignment Form,
            Financial Navigation Tracker, Risk Score Reference, Implementation
            Tiers Summary, SBAR Handoff Template, Teach-Back Checklist, and
            Comorbidity Quick Reference.
          </li>
        </ol>
      </section>

      {/* ---------- Who Is This For? ---------- */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">Who Is This For?</h2>
        <p>
          This app is designed for <strong>healthcare professionals</strong>{" "}
          managing heart failure in settings without on-site cardiology support:
        </p>
        <ul className="list-disc list-inside space-y-2 ml-2">
          <li>
            Primary care physicians in rural clinics and Critical Access
            Hospitals
          </li>
          <li>
            Nurse practitioners and physician assistants serving as frontline
            heart failure providers
          </li>
          <li>
            Quality improvement teams at hospitals seeking CMS Ambulatory
            Specialty Model (ASM) compliance
          </li>
          <li>
            Rural health administrators evaluating implementation frameworks for
            RHT Program funding
          </li>
          <li>
            Medical educators developing training materials for non-specialist
            providers in cardiology deserts
          </li>
        </ul>
      </section>

      {/* ---------- Evidence Foundation ---------- */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">Evidence Foundation</h2>
        <p>
          The protocol integrates evidence from landmark clinical trials:
        </p>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-3 py-2 text-left font-semibold">Trial</th>
                <th className="px-3 py-2 text-left font-semibold">Finding</th>
                <th className="px-3 py-2 text-left font-semibold">
                  Protocol Application
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              <tr>
                <td className="px-3 py-2">EMPEROR-Preserved (NEJM 2021)</td>
                <td className="px-3 py-2">
                  SGLT2i reduces CV death/HF hospitalization in HFpEF
                </td>
                <td className="px-3 py-2">Module 2: GDMT Optimization</td>
              </tr>
              <tr>
                <td className="px-3 py-2">DELIVER (NEJM 2022)</td>
                <td className="px-3 py-2">
                  Confirms SGLT2i benefit across broad HFpEF population
                </td>
                <td className="px-3 py-2">Module 2: GDMT Optimization</td>
              </tr>
              <tr>
                <td className="px-3 py-2">FINEARTS-HF (NEJM 2024)</td>
                <td className="px-3 py-2">
                  16% lower rate of CV death and total worsening HF events
                </td>
                <td className="px-3 py-2">
                  Module 2: Evidence and current-label navigation
                </td>
              </tr>
              <tr>
                <td className="px-3 py-2">STEP-HFpEF (NEJM 2023)</td>
                <td className="px-3 py-2">
                  Semaglutide improves symptoms in obese HFpEF
                </td>
                <td className="px-3 py-2">
                  Module 6: Comorbidity Management
                </td>
              </tr>
              <tr>
                <td className="px-3 py-2">Hozho Trial (JAMA IM 2024)</td>
                <td className="px-3 py-2">
                  53% GDMT increase via telephone in rural population
                </td>
                <td className="px-3 py-2">Module 3: Telephone Titration</td>
              </tr>
              <tr>
                <td className="px-3 py-2">STRONG-HF (Lancet 2022)</td>
                <td className="px-3 py-2">
                  Rapid GDMT up-titration safe and effective
                </td>
                <td className="px-3 py-2">Module 8: Tier 3 methodology</td>
              </tr>
              <tr>
                <td className="px-3 py-2">TIM-HF2 (Lancet 2018)</td>
                <td className="px-3 py-2">
                  30% mortality reduction with remote monitoring
                </td>
                <td className="px-3 py-2">Module 5: Remote Monitoring</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* ---------- Federal Alignment ---------- */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">Federal Alignment</h2>
        <p>
          The HEARTLAND Protocol is directly aligned with federal programs
          addressing rural cardiovascular care:
        </p>
        <ul className="list-disc list-inside space-y-2 ml-2">
          <li>
            <strong>Rural Health Transformation Program</strong> (Public Law
            119-21): $50 billion over five years (FY2026-2030) for rural health
            infrastructure, including chronic disease management tools
          </li>
          <li>
            <strong>CMS Ambulatory Specialty Model</strong> (ASM): Mandatory
            value-based payment for heart failure affecting ~8,600 physicians
            beginning January 2027
          </li>
          <li>
            <strong>Million Hearts 2027</strong>: CDC-CMS initiative targeting 1
            million prevented cardiovascular events
          </li>
          <li>
            <strong>Hospital Readmissions Reduction Program</strong> (HRRP):
            $1.9 billion in cumulative penalties — the HEARTLAND Protocol&apos;s
            discharge and titration modules directly target readmission reduction
          </li>
        </ul>
      </section>

      {/* ---------- Open Access ---------- */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">Open Access</h2>
        <p>The HEARTLAND Protocol is freely available:</p>
        <ul className="list-disc list-inside space-y-2 ml-2">
          <li>
            <strong>Published article</strong>: Cureus (Springer Nature) —
            peer-reviewed, indexed in PubMed/PMC/Scopus
          </li>
          <li>
            <strong>Zenodo</strong>:{" "}
            <a
              href="https://doi.org/10.5281/zenodo.18566403"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 underline hover:text-blue-800"
            >
              DOI 10.5281/zenodo.18566403
            </a>
          </li>
          <li>
            <strong>OSF</strong>:{" "}
            <a
              href="https://doi.org/10.17605/OSF.IO/YUSGH"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 underline hover:text-blue-800"
            >
              DOI 10.17605/OSF.IO/YUSGH
            </a>
          </li>
          <li>
            <strong>Systematic Reviews</strong>: Three complementary reviews
            registered in PROSPERO with preprints on medRxiv
          </li>
        </ul>
      </section>

      {/* ---------- Author ---------- */}
      <section className="space-y-4 border-t pt-8">
        <h2 className="text-2xl font-semibold">Author</h2>
        <div className="space-y-1">
          <p className="text-lg font-semibold">Vicky Muller Ferreira, MD</p>
          <p className="text-muted-foreground">
            Cardiologist | Implementation Science Researcher
          </p>
          <p>
            ORCID:{" "}
            <a
              href="https://orcid.org/0009-0009-1099-5690"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 underline hover:text-blue-800"
            >
              0009-0009-1099-5690
            </a>
          </p>
          <p>
            Email:{" "}
            <a
              href="mailto:vickymuller@heartlandprotocol.org"
              className="text-blue-600 underline hover:text-blue-800"
            >
              vickymuller@heartlandprotocol.org
            </a>
          </p>
        </div>
      </section>
    </article>
  );
}
