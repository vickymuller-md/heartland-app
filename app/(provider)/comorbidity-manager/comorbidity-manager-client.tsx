'use client';

import { useState, useCallback, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { COMORBIDITY_DATA } from '@/lib/comorbidity/constants';
import { savePatientComorbidities } from '@/lib/actions/comorbidity';
import type { ComorbidityKey } from '@/lib/comorbidity/types';
import { ComorbiditySelector } from './_components/comorbidity-selector';
import { ComorbidityDetailCard } from './_components/comorbidity-detail-card';
import { ReferralCriteriaForm } from './_components/referral-criteria-form';
import { DeviceCriteriaForm } from './_components/device-criteria-form';

interface ComorbidityManagerClientProps {
  patients: { id: string; full_name: string }[];
  selectedPatientId: string | null;
  initialComorbidities: ComorbidityKey[];
}

export function ComorbidityManagerClient({
  patients,
  selectedPatientId,
  initialComorbidities,
}: ComorbidityManagerClientProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selected, setSelected] = useState<ComorbidityKey[]>(initialComorbidities);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handlePatientChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const pid = e.target.value;
      if (pid) {
        router.push(`/comorbidity-manager?patientId=${pid}`);
      } else {
        router.push('/comorbidity-manager');
      }
    },
    [router],
  );

  const handleSelectionChange = useCallback((keys: ComorbidityKey[]) => {
    setSelected(keys);
    setSaveStatus('idle');
  }, []);

  const handleSave = useCallback(() => {
    if (!selectedPatientId) return;

    startTransition(async () => {
      const formData = new FormData();
      formData.set('patientId', selectedPatientId);
      formData.set('comorbidities', JSON.stringify(selected));

      const result = await savePatientComorbidities(formData);

      if (result.error) {
        setSaveStatus('error');
        setErrorMessage(result.error);
      } else {
        setSaveStatus('success');
        setErrorMessage(null);
      }
    });
  }, [selectedPatientId, selected]);

  const selectedDetails = COMORBIDITY_DATA.filter((c) =>
    selected.includes(c.key),
  );

  return (
    <div className="space-y-6">
      {/* Patient selector */}
      <div>
        <label
          htmlFor="patient-select"
          className="block text-sm font-medium text-gray-700"
        >
          Select Patient
        </label>
        <select
          id="patient-select"
          className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          value={selectedPatientId ?? ''}
          onChange={handlePatientChange}
        >
          <option value="">-- Select a patient --</option>
          {patients.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name}
            </option>
          ))}
        </select>
      </div>

      {selectedPatientId && (
        <>
          {/* Comorbidity selector */}
          <div>
            <h2 className="mb-2 text-lg font-semibold text-gray-900">
              Comorbidities
            </h2>
            <ComorbiditySelector
              initialSelected={initialComorbidities}
              onSelectionChange={handleSelectionChange}
            />
          </div>

          {/* Detail cards for selected comorbidities */}
          {selectedDetails.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-gray-900">
                GDMT Guidance
              </h2>
              {selectedDetails.map((c) => (
                <ComorbidityDetailCard key={c.key} comorbidity={c} />
              ))}
            </div>
          )}

          {/* Advanced HF Criteria */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-gray-900">
              Advanced HF Criteria
            </h2>

            <div className="grid gap-6 lg:grid-cols-2">
              <ReferralCriteriaForm />
              <DeviceCriteriaForm />
            </div>
          </div>

          {/* Save button */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleSave}
              disabled={isPending}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
            >
              {isPending ? 'Saving...' : 'Save Comorbidity Profile'}
            </button>

            {saveStatus === 'success' && (
              <span className="text-sm font-medium text-green-600">
                Saved successfully
              </span>
            )}
            {saveStatus === 'error' && (
              <span className="text-sm font-medium text-red-600">
                {errorMessage ?? 'Failed to save'}
              </span>
            )}
          </div>
        </>
      )}

      {!selectedPatientId && (
        <p className="text-sm text-gray-500">
          Select a patient to manage their comorbidity profile.
        </p>
      )}
    </div>
  );
}
