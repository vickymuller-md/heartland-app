import { HFREF_MEDICATIONS } from '@/lib/gdmt/constants';
import { ExplainResultButton } from '@/components/ai/explain-result-button';
import { MedicationCard } from '@/components/gdmt/medication-card';

interface HfrefPanelProps {
  selectedPatient?: { id: string; full_name: string } | null;
  existingMedNames?: string[];
  selectedDrugs?: Record<string, boolean>;
  onDrugToggle?: (drugAgent: string, checked: boolean) => void;
}

export function HfrefPanel({ selectedPatient, existingMedNames = [], selectedDrugs = {}, onDrugToggle }: HfrefPanelProps) {
  return (
    <div>
      <h3 className="text-lg font-semibold mb-4">Quadruple Therapy</h3>
      <div className="grid gap-4 md:grid-cols-2">
        {HFREF_MEDICATIONS.map((med) => {
          const isExisting = existingMedNames.includes(med.agent.toLowerCase().trim());
          return (
            <div key={med.id}>
              <MedicationCard medication={med} />
              {selectedPatient && (
                <div className="mt-2 px-1">
                  {isExisting ? (
                    <span className="text-xs text-gray-400">Already in medication list</span>
                  ) : (
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedDrugs[med.agent] ?? false}
                        onChange={(e) => onDrugToggle?.(med.agent, e.target.checked)}
                        className="size-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      Add to medications
                    </label>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="print:hidden">
        <ExplainResultButton
          input={{
            module: 'gdmt',
            result: {
              phenotype: 'HFrEF',
              classes: HFREF_MEDICATIONS.map((med) => ({
                therapyClass: med.drugClass,
                agent: med.agent,
                evidence: med.evidenceLevel,
              })),
            },
          }}
        />
      </div>
    </div>
  );
}
