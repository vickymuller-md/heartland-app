'use client';

import { useActionState, useCallback, useEffect, useState } from 'react';
import { FlaskConical, Loader2, TrendingUp, TrendingDown, Minus, Plus, ChevronDown, ChevronUp, Check } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { saveLabResult } from '@/lib/dashboard/actions';
import type { LabActionState } from '@/lib/dashboard/actions';

interface LabResult {
  id: string;
  collected_at: string;
  potassium: number | null;
  creatinine: number | null;
  egfr: number | null;
  bun: number | null;
  bnp: number | null;
  nt_probnp: number | null;
  hba1c: number | null;
  glucose: number | null;
  sodium: number | null;
  hemoglobin: number | null;
  ferritin: number | null;
  tsat: number | null;
  ldl: number | null;
  lab_facility: string | null;
  notes: string | null;
}

interface LabField {
  key: keyof LabResult;
  label: string;
  unit: string;
  normalLow: number;
  normalHigh: number;
  category: string;
}

const LAB_FIELDS: LabField[] = [
  { key: 'potassium', label: 'Potassium', unit: 'mEq/L', normalLow: 3.5, normalHigh: 5.0, category: 'Renal Panel' },
  { key: 'creatinine', label: 'Creatinine', unit: 'mg/dL', normalLow: 0.7, normalHigh: 1.3, category: 'Renal Panel' },
  { key: 'egfr', label: 'eGFR', unit: 'mL/min', normalLow: 60, normalHigh: 120, category: 'Renal Panel' },
  { key: 'bun', label: 'BUN', unit: 'mg/dL', normalLow: 7, normalHigh: 20, category: 'Renal Panel' },
  { key: 'bnp', label: 'BNP', unit: 'pg/mL', normalLow: 0, normalHigh: 100, category: 'Cardiac Biomarkers' },
  { key: 'nt_probnp', label: 'NT-proBNP', unit: 'pg/mL', normalLow: 0, normalHigh: 300, category: 'Cardiac Biomarkers' },
  { key: 'sodium', label: 'Sodium', unit: 'mEq/L', normalLow: 136, normalHigh: 145, category: 'Metabolic' },
  { key: 'glucose', label: 'Glucose', unit: 'mg/dL', normalLow: 70, normalHigh: 100, category: 'Metabolic' },
  { key: 'hba1c', label: 'HbA1c', unit: '%', normalLow: 4.0, normalHigh: 5.7, category: 'Metabolic' },
  { key: 'hemoglobin', label: 'Hemoglobin', unit: 'g/dL', normalLow: 12.0, normalHigh: 17.5, category: 'Hematology' },
  { key: 'ferritin', label: 'Ferritin', unit: 'ng/mL', normalLow: 30, normalHigh: 400, category: 'Hematology' },
  { key: 'tsat', label: 'TSAT', unit: '%', normalLow: 20, normalHigh: 50, category: 'Hematology' },
  { key: 'ldl', label: 'LDL', unit: 'mg/dL', normalLow: 0, normalHigh: 100, category: 'Lipids' },
];

function getStatus(value: number | null, low: number, high: number): 'normal' | 'low' | 'high' | null {
  if (value === null) return null;
  if (value < low) return 'low';
  if (value > high) return 'high';
  return 'normal';
}

function StatusIcon({ status }: { status: 'normal' | 'low' | 'high' | null }) {
  if (!status) return null;
  if (status === 'high') return <TrendingUp className="h-3.5 w-3.5 text-red-500" />;
  if (status === 'low') return <TrendingDown className="h-3.5 w-3.5 text-amber-500" />;
  return <Minus className="h-3.5 w-3.5 text-green-500" />;
}

function ValueCell({ value, unit, low, high }: { value: number | null; unit: string; low: number; high: number }) {
  if (value === null) return <span className="text-gray-300">—</span>;
  const status = getStatus(value, low, high);
  const color = status === 'high' ? 'text-red-700 font-semibold' : status === 'low' ? 'text-amber-700 font-semibold' : 'text-gray-900';
  return (
    <span className={`flex items-center gap-1 ${color}`}>
      {value} <span className="text-xs text-gray-400">{unit}</span>
      <StatusIcon status={status} />
    </span>
  );
}

function AddLabForm({ patientId, onSuccess }: { patientId: string; onSuccess: () => void }) {
  const [state, formAction, isPending] = useActionState<LabActionState | null, FormData>(
    saveLabResult,
    null
  );

  useEffect(() => {
    if (state?.success) {
      onSuccess();
    }
  }, [state, onSuccess]);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="patientId" value={patientId} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <label htmlFor="potassium" className="block text-sm font-medium text-gray-700 mb-1">
            K+ (mEq/L)
          </label>
          <input
            id="potassium"
            type="number"
            name="potassium"
            step="0.1"
            min="1"
            max="10"
            placeholder="e.g. 4.5"
            className="w-full rounded-md border border-gray-300 px-3 py-2.5 text-base min-h-[44px] focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label htmlFor="egfr" className="block text-sm font-medium text-gray-700 mb-1">
            eGFR (mL/min)
          </label>
          <input
            id="egfr"
            type="number"
            name="egfr"
            step="1"
            min="1"
            max="200"
            placeholder="e.g. 60"
            className="w-full rounded-md border border-gray-300 px-3 py-2.5 text-base min-h-[44px] focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label htmlFor="creatinine" className="block text-sm font-medium text-gray-700 mb-1">
            Cr (mg/dL)
          </label>
          <input
            id="creatinine"
            type="number"
            name="creatinine"
            step="0.01"
            min="0.1"
            max="20"
            placeholder="e.g. 1.2"
            className="w-full rounded-md border border-gray-300 px-3 py-2.5 text-base min-h-[44px] focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label htmlFor="sodium" className="block text-sm font-medium text-gray-700 mb-1">
            Na (mEq/L)
          </label>
          <input
            id="sodium"
            type="number"
            name="sodium"
            step="1"
            min="100"
            max="170"
            placeholder="e.g. 140"
            className="w-full rounded-md border border-gray-300 px-3 py-2.5 text-base min-h-[44px] focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      {state?.error && (
        <p className="text-sm text-red-600">{state.error}</p>
      )}

      {state?.success && (
        <p className="text-sm text-green-600 flex items-center gap-1">
          <Check className="h-4 w-4" /> Lab result saved
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 min-h-[44px]"
      >
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        Save Lab Result
      </button>
    </form>
  );
}

export function LabResultsTab({ patientId }: { patientId: string }) {
  const [labs, setLabs] = useState<LabResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formKey, setFormKey] = useState(0);

  const fetchLabs = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from('lab_results')
      .select('*')
      .eq('patient_id', patientId)
      .order('collected_at', { ascending: false })
      .limit(10);

    setLabs(data ?? []);
    setLoading(false);
  }, [patientId]);

  useEffect(() => {
    void fetchLabs();
  }, [fetchLabs]);

  const handleFormSuccess = () => {
    setShowForm(false);
    setFormKey((k) => k + 1);
    void fetchLabs();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (labs.length === 0 && !showForm) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 rounded-md border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 min-h-[44px]"
        >
          <Plus className="h-4 w-4" /> Add Lab Result
        </button>
        {showForm && (
          <div className="rounded-lg border bg-white p-4">
            <AddLabForm key={formKey} patientId={patientId} onSuccess={handleFormSuccess} />
          </div>
        )}
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <FlaskConical className="h-10 w-10 text-gray-300 mb-3" />
          <p className="text-gray-600">No lab results recorded</p>
        </div>
      </div>
    );
  }

  // Group fields by category
  const categories = [...new Set(LAB_FIELDS.map(f => f.category))];

  return (
    <div className="space-y-6">
      {/* Add Lab Result toggle */}
      <div className="space-y-3">
        <button
          onClick={() => setShowForm(!showForm)}
          className="inline-flex items-center gap-2 rounded-md border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 min-h-[44px]"
        >
          {showForm ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          Add Lab Result
        </button>
        {showForm && (
          <div className="rounded-lg border bg-white p-4">
            <AddLabForm key={formKey} patientId={patientId} onSuccess={handleFormSuccess} />
          </div>
        )}
      </div>

      <p className="text-sm text-gray-500">
        {labs.length} lab result{labs.length !== 1 ? 's' : ''} — most recent first
      </p>

      {categories.map(cat => {
        const fields = LAB_FIELDS.filter(f => f.category === cat);
        // Only show category if at least one lab has data for it
        const hasData = fields.some(f => labs.some(l => l[f.key] !== null));
        if (!hasData) return null;

        return (
          <div key={cat} className="rounded-lg border bg-white overflow-hidden">
            <div className="bg-gray-50 px-4 py-2 border-b">
              <h3 className="text-sm font-semibold text-gray-700">{cat}</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50/50">
                    <th className="text-left px-4 py-2 font-medium text-gray-600 sticky left-0 bg-gray-50/50">Test</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-400 text-xs">Normal</th>
                    {labs.map(l => (
                      <th key={l.id} className="text-left px-3 py-2 font-medium text-gray-600 whitespace-nowrap min-w-[100px]">
                        {new Date(l.collected_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {fields.map(field => (
                    <tr key={field.key} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="px-4 py-2 font-medium text-gray-900 sticky left-0 bg-white whitespace-nowrap">
                        {field.label}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-400 whitespace-nowrap">
                        {field.normalLow}–{field.normalHigh}
                      </td>
                      {labs.map(l => (
                        <td key={l.id} className="px-3 py-2">
                          <ValueCell
                            value={l[field.key] as number | null}
                            unit={field.unit}
                            low={field.normalLow}
                            high={field.normalHigh}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {/* Lab notes */}
      {labs.some(l => l.notes || l.lab_facility) && (
        <div className="rounded-lg border bg-white p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-700">Lab Details</h3>
          {labs.filter(l => l.notes || l.lab_facility).map(l => (
            <div key={l.id} className="text-sm border-b last:border-0 pb-2">
              <p className="font-medium text-gray-900">
                {new Date(l.collected_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                {l.lab_facility && <span className="text-gray-500 font-normal"> — {l.lab_facility}</span>}
              </p>
              {l.notes && <p className="text-gray-600 mt-0.5">{l.notes}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
