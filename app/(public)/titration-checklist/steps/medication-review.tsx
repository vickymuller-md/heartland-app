'use client';

import { useEffect, useState } from 'react';
import { useFieldArray, type Control } from 'react-hook-form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Plus, Trash2, AlertOctagon } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  detectAceiInMedications,
  detectArniInMedications,
} from '@/lib/titration/acei';
import type { TitrationFormData } from '@/lib/titration/schema';

interface MedicationReviewProps {
  control: Control<TitrationFormData>;
  patientId?: string | null;
}

export function MedicationReview({ control, patientId }: MedicationReviewProps) {
  const { fields, append, remove } = useFieldArray({
    control,
    name: 'medications',
  });

  // Fetch active patient medications for ACEi/ARNI co-prescription detection
  const [patientMeds, setPatientMeds] = useState<{ name: string }[]>([]);

  useEffect(() => {
    if (!patientId) return;
    const supabase = createClient();
    supabase
      .from('medications')
      .select('id, name')
      .eq('patient_id', patientId)
      .eq('active', true)
      .then(({ data }) => {
        if (data) setPatientMeds(data);
      });
  }, [patientId]);

  const hasAcei = detectAceiInMedications(patientMeds);
  const hasArni = detectArniInMedications(patientMeds);
  const showWashoutWarning = hasAcei && hasArni;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Medication Review</h2>
      <p className="text-sm text-muted-foreground">
        Review current HF medications and doses. Pre-populated with common classes.
      </p>

      {showWashoutWarning && (
        <div
          role="alert"
          className="rounded-lg border-2 border-red-500 bg-red-50 p-4 mb-4"
        >
          <div className="flex items-start gap-3">
            <AlertOctagon
              className="h-6 w-6 text-red-600 flex-shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <div>
              <p className="font-bold text-red-800 text-base">
                ACEi-to-ARNI Washout Required
              </p>
              <p className="text-sm text-red-700 mt-1">
                Patient&apos;s medication list includes both an ACE inhibitor and
                sacubitril/valsartan (ARNI). A minimum{' '}
                <strong>36-hour washout</strong> from the last ACEi dose is
                required before initiating ARNI to reduce risk of angioedema
                (PARADIGM-HF protocol, ACC/AHA 2022).
              </p>
              <p className="text-xs text-red-600 mt-2">
                This is an advisory warning. Clinical judgment required.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {fields.map((field, index) => (
          <div key={field.id} className="flex items-end gap-2">
            <div className="flex-1 space-y-1">
              {index === 0 && <Label>Medication</Label>}
              <Input
                placeholder="Medication name"
                {...control.register(`medications.${index}.name`)}
              />
            </div>
            <div className="w-40 space-y-1">
              {index === 0 && <Label>Current Dose</Label>}
              <Input
                placeholder="e.g. 25 mg BID"
                {...control.register(`medications.${index}.currentDose`)}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => remove(index)}
              aria-label={`Remove ${field.name || 'medication'}`}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => append({ name: '', currentDose: '' })}
        className="gap-1"
      >
        <Plus className="size-4" />
        Add Medication
      </Button>
    </div>
  );
}
