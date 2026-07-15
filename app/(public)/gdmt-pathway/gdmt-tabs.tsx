'use client';

import { useState, useCallback, useMemo } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { PatientSelector, type SelectedPatientData } from '@/components/shared/patient-selector';
import { HfrefPanel } from './hfref-panel';
import { HfpefPanel } from './hfpef-panel';
import { saveGdmtMedications } from '@/lib/integration/actions';
import type { GdmtMedicationInput } from '@/lib/integration/types';
import { HFREF_MEDICATIONS, HFPEF_MEDICATIONS } from '@/lib/gdmt/constants';
import type { Medication } from '@/lib/gdmt/types';
import { Save } from 'lucide-react';
import { toast } from 'sonner';

/** Find a GDMT medication by agent name across both HFrEF and HFpEF lists */
function findGdmtMedication(name: string): Medication | undefined {
  const all = [...HFREF_MEDICATIONS, ...HFPEF_MEDICATIONS];
  return all.find(m => m.agent === name);
}

export function GdmtTabs({ clinicalIntegrationEnabled = false }: { clinicalIntegrationEnabled?: boolean }) {
  const [selectedPatient, setSelectedPatient] = useState<SelectedPatientData['patient'] | null>(null);
  const [patientMedications, setPatientMedications] = useState<{ name: string; dosage: string | null; frequency: string | null }[]>([]);
  const [selectedDrugs, setSelectedDrugs] = useState<Record<string, boolean>>({});
  const [isSaving, setIsSaving] = useState(false);

  // Normalized existing medication names for dedup
  const existingMedNames = useMemo(
    () => patientMedications.map(m => m.name.toLowerCase().trim()),
    [patientMedications]
  );

  const handlePatientSelect = useCallback((data: SelectedPatientData) => {
    setSelectedPatient(data.patient);
    setPatientMedications(data.medications);
    setSelectedDrugs({});
  }, []);

  const handlePatientClear = useCallback(() => {
    setSelectedPatient(null);
    setPatientMedications([]);
    setSelectedDrugs({});
  }, []);

  const handleDrugToggle = useCallback((drugAgent: string, checked: boolean) => {
    setSelectedDrugs(prev => ({ ...prev, [drugAgent]: checked }));
  }, []);

  const hasSelected = Object.values(selectedDrugs).some(Boolean);

  const handleSaveMedications = async () => {
    if (!selectedPatient) return;
    setIsSaving(true);

    const allDrugs: GdmtMedicationInput[] = Object.entries(selectedDrugs)
      .filter(([, checked]) => checked)
      .map(([agent]) => {
        const med = findGdmtMedication(agent);
        return {
          name: med?.agent ?? agent,
          dosage: med?.startingDose ?? '',
          frequency: med?.id?.includes('sglt2') ? 'daily' : 'as directed',
        };
      });

    const existingNames = patientMedications.map(m => m.name);
    const result = await saveGdmtMedications(selectedPatient.id, allDrugs, existingNames);
    setIsSaving(false);

    if (result.success) {
      const addedCount = allDrugs.length;
      toast.success(`${addedCount} medication(s) added to ${selectedPatient.full_name}`);
      setSelectedDrugs({});
      // Update local medication list so dedup labels refresh
      setPatientMedications(prev => [
        ...prev,
        ...allDrugs.map(d => ({ name: d.name, dosage: d.dosage, frequency: d.frequency })),
      ]);
    } else {
      toast.error(result.error ?? 'Failed to add medications');
    }
  };

  return (
    <div className="space-y-6">
      {/* Patient Selector */}
      {clinicalIntegrationEnabled && <div className="border-b pb-6">
        <h3 className="text-sm font-medium text-gray-700 mb-3">Link to Patient</h3>
        <PatientSelector
          onSelect={handlePatientSelect}
          selectedPatient={selectedPatient}
          onClear={handlePatientClear}
        />
      </div>}

      {/* HFmrEF guidance — 2022 AHA/ACC/HFSA Guideline, Class 2a */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-900">
        <span className="font-semibold">HFmrEF (LVEF 41–49%):</span>{' '}
        Treat with the HFrEF pathway below. 2022 AHA/ACC/HFSA Guideline for the
        Management of Heart Failure: quadruple therapy (ARNi/ACEi/ARB,
        evidence-based beta-blocker, MRA, SGLT2i) is reasonable in patients
        with mildly reduced ejection fraction (Class 2a, Level of Evidence: B-R).
        Reassess EF after 3–6 months of optimized therapy and reclassify
        (HFrEF, HFmrEF, or HFimpEF) as indicated.
      </div>

      <Tabs defaultValue="hfref" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="hfref">
            HFrEF (LVEF &le;40%) · HFmrEF (41–49%)
          </TabsTrigger>
          <TabsTrigger value="hfpef">
            HFpEF (LVEF &ge;50%)
          </TabsTrigger>
        </TabsList>
        <TabsContent value="hfref" className="mt-4">
          <HfrefPanel
            selectedPatient={selectedPatient}
            existingMedNames={existingMedNames}
            selectedDrugs={selectedDrugs}
            onDrugToggle={handleDrugToggle}
          />
        </TabsContent>
        <TabsContent value="hfpef" className="mt-4">
          <HfpefPanel
            selectedPatient={selectedPatient}
            existingMedNames={existingMedNames}
            selectedDrugs={selectedDrugs}
            onDrugToggle={handleDrugToggle}
          />
        </TabsContent>
      </Tabs>

      {/* Save Medications button */}
      {selectedPatient && hasSelected && (
        <div className="pt-4 border-t">
          <Button onClick={handleSaveMedications} disabled={isSaving} className="gap-1">
            <Save className="size-4" />
            {isSaving ? 'Adding...' : `Add Selected Medications to ${selectedPatient.full_name}`}
          </Button>
        </div>
      )}
    </div>
  );
}
