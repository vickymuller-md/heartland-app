import type { Metadata } from "next";
import { ProviderPageDisclaimer } from "@/components/disclaimers/provider-page-disclaimer";
import { APP_ARCHIVE_DOI, APP_VERSION } from "@/lib/app-version";

export const metadata: Metadata = {
  title: "About - HEARTLAND Protocol",
  description:
    "About the HEARTLAND Protocol and its educational implementation companion app: eight modules, synthetic public tools, separate identities for the article, the Toolkit and the software.",
};

const MODULES = [
  ["Risk stratification", "Explore the proposed ten-variable HEARTLAND score, including distance to cardiology and social support. Outcome validation remains a research objective."],
  ["GDMT optimization", "Inspect HFrEF, HFmrEF and HFpEF pathways, evidence tiers and generic-bridge cost examples. Prices and patient suitability require independent verification."],
  ["Telephone titration", "Walk through a telephone checklist with renal-function and potassium gates. Source studies provide context, not validation of this app's titration workflow."],
  ["Discharge transitions", "Explore SBAR handoff, follow-up planning and medication reconciliation. A generated handoff still requires review and an accountable recipient."],
  ["Remote monitoring", "Compare digital and analog workflow options by connectivity and literacy, with a billing reference. Telephone reports are not equivalent to connected-device measurements."],
  ["Comorbidity care", "Inspect Cardio-Kidney-Metabolic staging, quality metrics and contextual prompts for diabetes, CKD, AF and obesity using fictional cases."],
  ["Primary-care linkage", "Map roles, triggers and shared documentation between discharge and longitudinal primary care. A recorded assignment does not confirm delivery or follow-up."],
  ["Implementation tier", "Explore Tier 1 / 2 / 3 resource profiles and planning checklists. A tier is not authorization to activate a clinical service."],
] as const;

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-8">
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
          specialist access, rural populations carry a heavier burden: in 2018,
          heart-failure-related cardiovascular mortality was about 28% higher in
          rural than in urban US counties (73.2 vs 57.2 per 100,000; Pierce et
          al., PLOS ONE 2021). This is compounded by limited cardiology access
          — 86% of rural counties lack any cardiologist. This disparity is
          widening: young adults in rural areas experienced a 21% increase in
          cardiovascular mortality from 2010-2022, compared to only 3% in urban
          areas.
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
          interactive clinical implementation tools. Public tools and the
          sandbox run on synthetic data only; they support education and
          implementation planning and do not deliver care.
        </p>
        <ol className="list-decimal list-inside space-y-3 ml-2" data-testid="about-modules">
          {MODULES.map(([title, body]) => (
            <li key={title}>
              <strong>{title}</strong> — {body}
            </li>
          ))}
        </ol>
        <p>
          Cross-cutting tools: a <strong>Generic Bridge calculator</strong> that
          illustrates foundational therapy with generic medications while
          optimal agents are pursued, and a{" "}
          <strong>Pocket Card Library</strong> with digital versions of all ten
          clinical reference figures.
        </p>
        <p>
          As of the Walmart $4/$9 generic list effective March 2025, the bridge
          drugs run about $5–$9 each per month, roughly $28–$36/month
          for the set. Carvedilol is not on that list, and the set does not
          include an SGLT2 inhibitor. Prices change and require independent
          verification.
        </p>
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
                  Phone-based titration with a home BP cuff raised GDMT class
                  addition at 30 days from 13.1% to 66.2% (rural Navajo Nation,
                  n = 103)
                </td>
                <td className="px-3 py-2">Module 3: Telephone Titration</td>
              </tr>
              <tr>
                <td className="px-3 py-2">STRONG-HF (Lancet 2022)</td>
                <td className="px-3 py-2">
                  Rapid GDMT up-titration effective, with more non-serious
                  adverse events
                </td>
                <td className="px-3 py-2">Module 8: Tier 3 methodology</td>
              </tr>
              <tr>
                <td className="px-3 py-2">TIM-HF2 (Lancet 2018)</td>
                <td className="px-3 py-2">
                  30% lower all-cause death (HR 0.70, 0.50–0.96), a secondary
                  endpoint in a German trial; benefit greatest at longer travel
                  distances
                </td>
                <td className="px-3 py-2">Module 5: Remote Monitoring</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-sm text-muted-foreground">
          These studies evaluated the interventions and populations they
          describe. They did not evaluate the HEARTLAND App or its AI features,
          and the app&apos;s proposed risk framework has not been validated
          against clinical outcomes.
        </p>
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
        <p>
          The article, the Implementation Toolkit and this app are separate,
          freely available works with their own identifiers:
        </p>
        <ul className="list-disc list-inside space-y-2 ml-2">
          <li>
            <strong>Published article</strong>: Cureus (Springer Nature) —
            peer-reviewed, indexed in PubMed/PMC/Scopus —{" "}
            <a
              href="https://doi.org/10.7759/cureus.104817"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 underline hover:text-blue-800"
            >
              DOI 10.7759/cureus.104817
            </a>
          </li>
          <li>
            <strong>Implementation Toolkit V3.3</strong> (Zenodo):{" "}
            <a
              href="https://doi.org/10.5281/zenodo.19101219"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 underline hover:text-blue-800"
            >
              DOI 10.5281/zenodo.19101219
            </a>
          </li>
          <li>
            <strong>App software archive {APP_VERSION}</strong> (Zenodo):{" "}
            <a
              href={`https://doi.org/${APP_ARCHIVE_DOI}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 underline hover:text-blue-800"
            >
              DOI {APP_ARCHIVE_DOI}
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

      <ProviderPageDisclaimer variant="framework" />
    </div>
  );
}
