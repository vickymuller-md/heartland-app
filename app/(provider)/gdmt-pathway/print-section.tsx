import {
  HFREF_MEDICATIONS,
  HFPEF_MEDICATIONS,
  FINERENONE_SCENARIOS,
  SAFETY_GATE_RULES,
  NON_PHARMACOLOGICAL,
  GENERIC_BRIDGE_ITEMS,
  GENERIC_BRIDGE_PRINCIPLE,
} from '@/lib/gdmt/constants';
import { EVIDENCE_LEVEL_CONFIG } from '@/lib/gdmt/evidence-levels';
import type { Medication } from '@/lib/gdmt/types';

function MedicationTable({
  medications,
  showPriority,
}: {
  medications: Medication[];
  showPriority?: boolean;
}) {
  return (
    <table className="w-full text-sm border-collapse">
      <thead>
        <tr className="border-b text-left">
          {showPriority && <th className="py-1 pr-2">#</th>}
          <th className="py-1 pr-2">Drug Class</th>
          <th className="py-1 pr-2">Agent</th>
          <th className="py-1 pr-2">Starting Dose</th>
          <th className="py-1 pr-2">Target Dose</th>
          <th className="py-1 pr-2">Safety Gates</th>
          <th className="py-1">Evidence</th>
        </tr>
      </thead>
      <tbody>
        {medications.map((med) => (
          <tr key={med.id} className="border-b">
            {showPriority && (
              <td className="py-1 pr-2">{med.priority ?? ''}</td>
            )}
            <td className="py-1 pr-2 font-medium">{med.drugClass}</td>
            <td className="py-1 pr-2">{med.agent}</td>
            <td className="py-1 pr-2">{med.startingDose}</td>
            <td className="py-1 pr-2">{med.targetDose}</td>
            <td className="py-1 pr-2">
              {med.safetyGates.length > 0
                ? med.safetyGates.join('; ')
                : '--'}
            </td>
            <td className="py-1">
              {EVIDENCE_LEVEL_CONFIG[med.evidenceLevel].label}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function PrintSection() {
  const uptitrate = SAFETY_GATE_RULES.filter((r) => r.action === 'uptitrate');
  const hold = SAFETY_GATE_RULES.filter((r) => r.action === 'hold');

  return (
    <div className="hidden print:block space-y-6 text-sm">
      <div>
        <h1 className="text-xl font-bold">GDMT Optimization Pathway</h1>
        <p className="text-gray-600">
          HEARTLAND Protocol v3.3 -- Module 2
        </p>
      </div>

      {/* Section 1: HFrEF */}
      <section>
        <h2 className="text-base font-bold mb-2 border-b pb-1">
          HFrEF (LVEF &le;40%) -- Quadruple Therapy
        </h2>
        <MedicationTable medications={HFREF_MEDICATIONS} />
      </section>

      {/* Section 2: HFpEF */}
      <section>
        <h2 className="text-base font-bold mb-2 border-b pb-1">
          HFpEF (LVEF &gt;40%) -- Evolving Evidence
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
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b text-left">
              <th className="py-1 pr-2">Clinical Scenario</th>
              <th className="py-1 pr-2">Suggested Approach</th>
              <th className="py-1">Rationale</th>
            </tr>
          </thead>
          <tbody>
            {FINERENONE_SCENARIOS.map((s) => (
              <tr key={s.clinicalScenario} className="border-b">
                <td className="py-1 pr-2">{s.clinicalScenario}</td>
                <td className="py-1 pr-2">{s.suggestedApproach}</td>
                <td className="py-1">{s.rationale}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Section 4: Titration Safety Gates */}
      <section>
        <h2 className="text-base font-bold mb-2 border-b pb-1">
          Titration Safety Gates
        </h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <h3 className="font-bold text-green-700 mb-1">UPTITRATE IF</h3>
            <ul className="list-disc ml-4">
              {uptitrate.map((r) => (
                <li key={r.condition}>{r.condition}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="font-bold text-red-700 mb-1">HOLD IF</h3>
            <ul className="list-disc ml-4">
              {hold.map((r) => (
                <li key={r.condition}>{r.condition}</li>
              ))}
            </ul>
          </div>
        </div>
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
          Generic Bridge (~$15/month)
        </h2>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b text-left">
              <th className="py-1 pr-2">Drug Class</th>
              <th className="py-1 pr-2">Generic Agent</th>
              <th className="py-1">Monthly Cost</th>
            </tr>
          </thead>
          <tbody>
            {GENERIC_BRIDGE_ITEMS.map((item) => (
              <tr key={item.agent} className="border-b">
                <td className="py-1 pr-2">
                  {item.drugClass}
                  {item.note && (
                    <span className="italic"> ({item.note})</span>
                  )}
                </td>
                <td className="py-1 pr-2">{item.agent}</td>
                <td className="py-1">{item.monthlyCost}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t font-bold">
              <td colSpan={2} className="py-1 pr-2">
                Total
              </td>
              <td className="py-1">~$15-16/month</td>
            </tr>
          </tfoot>
        </table>
        <p className="mt-2 font-medium italic">{GENERIC_BRIDGE_PRINCIPLE}</p>
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
