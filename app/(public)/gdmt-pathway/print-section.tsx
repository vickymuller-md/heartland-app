import {
  HFREF_MEDICATIONS,
  HFPEF_MEDICATIONS,
  NON_PHARMACOLOGICAL,
  HFREF_PATHWAY_LABEL,
  LVEF_GE_40_PATHWAY_LABEL,
} from '@/lib/gdmt/constants';
import { EVIDENCE_LEVEL_CONFIG } from '@/lib/gdmt/evidence-levels';
import type { Medication } from '@/lib/gdmt/types';
import { FinerenoneGuide } from '@/components/gdmt/finerenone-guide';
import { MraReference } from '@/components/gdmt/mra-reference';
import { SafetyGateCard } from '@/components/gdmt/safety-gate-card';
import { GenericBridge } from '@/components/gdmt/generic-bridge';

function MedicationTable({
  medications,
  showPriority,
}: {
  medications: Medication[];
  showPriority?: boolean;
}) {
  return (
    <div className="space-y-3">
      {medications.map((med) => (
        <article key={med.id} className="gdmt-print-medication border-b pb-2">
          <h3 className="font-semibold">
            {showPriority && `${med.priority ?? ''}. `}{med.drugClass} — {med.agent}
          </h3>
          <p><strong>Starting dose:</strong> {med.startingDose}</p>
          <p><strong>Target dose:</strong> {med.targetDose}</p>
          <p><strong>Safety gates:</strong> {med.safetyGates.length > 0 ? med.safetyGates.join('; ') : '--'}</p>
          <p><strong>Evidence category:</strong> {EVIDENCE_LEVEL_CONFIG[med.evidenceLevel].label}</p>
        </article>
      ))}
    </div>
  );
}

export function PrintSection() {
  return (
    <div className="gdmt-print hidden print:block space-y-6 text-sm">
      <div>
        <h1 className="text-xl font-bold">GDMT Optimization Pathway</h1>
        <p className="text-gray-600">
          HEARTLAND Module 2 reference checked September 30, 2026.
          Toolkit V3.4 remains a candidate, not a published or clinically approved release.
        </p>
      </div>

      {/* Section 1: HFrEF and HFmrEF */}
      <section>
        <h2 className="text-base font-bold mb-2 border-b pb-1">
          {HFREF_PATHWAY_LABEL} -- Quadruple Therapy
        </h2>
        <MedicationTable medications={HFREF_MEDICATIONS} />
      </section>

      {/* Section 2: LVEF >=40% (MRA and SGLT2i lines) */}
      <section>
        <h2 className="text-base font-bold mb-2 border-b pb-1">
          {LVEF_GE_40_PATHWAY_LABEL} -- Evolving Evidence
        </h2>
        <MedicationTable
          medications={[...HFPEF_MEDICATIONS].sort(
            (a, b) => (a.priority ?? 0) - (b.priority ?? 0)
          )}
          showPriority
        />
      </section>

      {/* Section 3: Finerenone Decision Guide */}
      <section>
        <h2 className="text-base font-bold mb-2 border-b pb-1">
          Finerenone vs. Spironolactone Decision Guide
        </h2>
        <FinerenoneGuide />
      </section>

      <section>
        <h2 className="text-base font-bold mb-2 border-b pb-1">MRA Label Reference</h2>
        <MraReference />
      </section>

      {/* Section 4: Titration Safety Gates */}
      <section>
        <h2 className="text-base font-bold mb-2 border-b pb-1">
          Titration Safety Gates
        </h2>
        <SafetyGateCard />
      </section>

      {/* Section 5: Non-Pharmacological */}
      <section>
        <h2 className="text-base font-bold mb-2 border-b pb-1">
          Non-Pharmacological Management
        </h2>
        <dl className="space-y-1">
          {[
            NON_PHARMACOLOGICAL.sodium,
            NON_PHARMACOLOGICAL.activity,
            NON_PHARMACOLOGICAL.cardiacRehab,
          ].map((item) => (
            <div key={item.label}>
              <dt className="inline font-medium">{item.label}: </dt>
              <dd className="inline">{item.target}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Section 6: Generic Bridge */}
      <section>
        <h2 className="text-base font-bold mb-2 border-b pb-1">
          Generic Bridge
        </h2>
        <GenericBridge />
      </section>

      {/* Disclaimer */}
      <div className="border-t pt-2 text-xs text-gray-500 mt-8">
        <p className="font-medium mb-1">
          Clinical Use Disclaimer
        </p>
        <p>
          This tool is designed for healthcare professionals as an educational
          implementation-support resource. It does not provide medical diagnoses,
          treatment recommendations for individual patients, or replace clinical
          judgment. Not intended for direct patient care. For professional use
          only.
        </p>
      </div>
    </div>
  );
}
