'use client';

import { useState, useCallback, useMemo, useRef } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { PatientSelector, type SelectedPatientData } from '@/components/shared/patient-selector';
import { HfrefPanel } from './hfref-panel';
import { HfpefPanel } from './hfpef-panel';
import { saveGdmtMedications } from '@/lib/integration/actions';
import type { ConfirmedGdmtMedication } from '@/lib/integration/types';
import { FREQUENCY_OPTIONS } from '@/lib/medications/constants';
import {
  HFREF_MEDICATIONS,
  HFPEF_MEDICATIONS,
  HFREF_PATHWAY_LABEL,
  LVEF_GE_40_PATHWAY_LABEL,
  LVEF_BOUNDARIES,
} from '@/lib/gdmt/constants';
import type { Medication } from '@/lib/gdmt/types';
import { Save } from 'lucide-react';

/** Find a GDMT medication by agent name across both HFrEF and HFpEF lists */
function findGdmtMedication(name: string): Medication | undefined {
  const all = [...HFREF_MEDICATIONS, ...HFPEF_MEDICATIONS];
  return all.find(m => m.agent === name);
}

export function GdmtTabs({ clinicalIntegrationEnabled = false, actorId = null }: { clinicalIntegrationEnabled?: boolean; actorId?: string | null }) {
  const [selectedPatient, setSelectedPatient] = useState<SelectedPatientData['patient'] | null>(null);
  const [patientMedications, setPatientMedications] = useState<{ name: string; dosage: string | null; frequency: string | null }[]>([]);
  const [drafts, setDrafts] = useState<Record<string, ConfirmedGdmtMedication>>({});
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const patientGeneration = useRef(0);
  const selectedDrugs = Object.fromEntries(Object.keys(drafts).map(agent => [agent, true]));

  // Normalized existing medication names for dedup
  const existingMedNames = useMemo(
    () => patientMedications.map(m => m.name.toLowerCase().trim()),
    [patientMedications]
  );

  const handlePatientSelect = useCallback((data: SelectedPatientData) => {
    patientGeneration.current++;
    setSelectedPatient(data.patient);
    setPatientMedications(data.medications);
    setDrafts({});
    setIsSaving(false);
    setError('');
    setReceipt('');
  }, []);

  const handlePatientClear = useCallback(() => {
    patientGeneration.current++;
    setSelectedPatient(null);
    setPatientMedications([]);
    setDrafts({});
    setIsSaving(false);
    setError('');
    setReceipt('');
  }, []);

  const handleDrugToggle = useCallback((drugAgent: string, checked: boolean) => {
    if (isSaving) return;
    const template = findGdmtMedication(drugAgent);
    if (!template) return;
    const request = crypto.randomUUID();
    setDrafts(previous => {
      const next = { ...previous };
      if (checked) next[drugAgent] = { request_id: request, name: /\sor\s/i.test(template.agent) ? '' : template.agent, dosage: '', frequency: '' };
      else delete next[drugAgent];
      return next;
    });
    setError('');
    setReceipt('');
  }, [isSaving]);

  function editInstruction(agent: string, field: 'name' | 'dosage' | 'frequency', value: string) {
    setDrafts(previous => ({ ...previous, [agent]: { ...previous[agent], [field]: value } }));
  }

  async function handleSaveMedications(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedPatient || !actorId || isSaving) return;
    const generation = patientGeneration.current;
    const items = Object.values(drafts);
    setIsSaving(true);
    setError('');
    try {
      const result = await saveGdmtMedications(selectedPatient.id, items, actorId);
      if (generation !== patientGeneration.current) return;
      if (!result.success) { setError(result.error ?? 'Saving was not confirmed. Please retry.'); return; }
      setReceipt(`${result.added} added to ${selectedPatient.full_name}. ${result.existing} already listed.`);
      setDrafts({});
      setPatientMedications(previous => [...previous, ...items.filter(item => !previous.some(med => med.name.trim().toLowerCase() === item.name.trim().toLowerCase()))]);
    } catch {
      if (generation === patientGeneration.current) setError('Saving was not confirmed. Keep the entries open and retry.');
    } finally {
      if (generation === patientGeneration.current) setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Patient Selector */}
      {clinicalIntegrationEnabled && <div className="border-b pb-6">
        <h3 className="text-sm font-medium text-gray-700 mb-3">Link to Patient</h3>
        <PatientSelector
          onSelect={handlePatientSelect}
          expectedActorId={actorId ?? undefined}
          selectedPatient={selectedPatient}
          onClear={handlePatientClear}
        />
      </div>}

      {/* HFmrEF and LVEF exactly 40% routing — 2022 AHA/ACC/HFSA Class 2a for
          quadruple therapy; KERENDIA label §1 for the LVEF >=40% MRA line */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-900">
        <span className="font-semibold">
          LVEF {LVEF_BOUNDARIES.hfrefMax}–{LVEF_BOUNDARIES.hfmrefMax}%: review both tabs.
        </span>{' '}
        Start from the quadruple-therapy tab. 2022 AHA/ACC/HFSA Guideline for the
        Management of Heart Failure: quadruple therapy (ARNi/ACEi/ARB,
        evidence-based beta-blocker, MRA, SGLT2i) is reasonable in patients
        with mildly reduced ejection fraction (Class 2a, Level of Evidence: B-R).
        Then review the LVEF &ge;{LVEF_BOUNDARIES.mraSglt2iPathwayMin}% tab for the
        MRA and SGLT2i lines: finerenone is FDA-labeled in heart failure with
        LVEF &ge;{LVEF_BOUNDARIES.mraSglt2iPathwayMin}%, so a patient at exactly
        40% or at 41–49% is inside that indication. The SGLT2i trials in preserved
        ejection fraction (EMPEROR-Preserved, DELIVER) enrolled LVEF &gt;40%.
        Reassess EF after 3–6 months of optimized therapy and reclassify
        (HFrEF, HFmrEF, or HFimpEF) as indicated.
      </div>

      <Tabs defaultValue="hfref" className="w-full">
        <TabsList className="grid h-auto w-full grid-cols-2">
          <TabsTrigger value="hfref" className="h-auto whitespace-normal py-2 text-center leading-tight">
            {HFREF_PATHWAY_LABEL}
          </TabsTrigger>
          <TabsTrigger value="hfpef" className="h-auto whitespace-normal py-2 text-center leading-tight">
            {LVEF_GE_40_PATHWAY_LABEL}
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

      {selectedPatient && <p role="status" className="text-sm font-medium text-gray-800">{receipt}</p>}
      {selectedPatient && actorId && Object.keys(drafts).length > 0 && (
        <form onSubmit={handleSaveMedications} className="space-y-4 border-t pt-4">
          <h3 className="font-semibold">Confirm the medication list for {selectedPatient.full_name}</h3>
          <p className="text-sm text-muted-foreground">Enter the medication and instructions documented for this patient. The care team can confirm timing separately.</p>
          {Object.entries(drafts).map(([agent, item]) => <fieldset key={agent} disabled={isSaving} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
            <legend className="px-1 text-sm font-medium">{agent}</legend>
            <label className="text-sm">Recorded medication name
              <input required maxLength={200} value={item.name} onChange={e => editInstruction(agent, 'name', e.target.value)} className="mt-1 block min-h-11 w-full rounded border px-2" />
            </label>
            <label className="text-sm">Recorded dosage
              <input required maxLength={100} value={item.dosage} onChange={e => editInstruction(agent, 'dosage', e.target.value)} className="mt-1 block min-h-11 w-full rounded border px-2" />
            </label>
            <label className="text-sm sm:col-span-2">Recorded frequency
              <select required value={item.frequency} onChange={e => editInstruction(agent, 'frequency', e.target.value)} className="mt-1 block min-h-11 w-full rounded border px-2">
                <option value="" disabled>Select the recorded frequency</option>
                {FREQUENCY_OPTIONS.filter(option => option.value !== 'weekly').map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                <option value="as directed">As directed · schedule pending confirmation</option>
              </select>
            </label>
          </fieldset>)}
          {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
          <Button type="submit" disabled={isSaving} className="gap-1">
            <Save className="size-4" />
            {isSaving ? 'Adding...' : `Add Selected Medications to ${selectedPatient.full_name}`}
          </Button>
        </form>
      )}
    </div>
  );
}
