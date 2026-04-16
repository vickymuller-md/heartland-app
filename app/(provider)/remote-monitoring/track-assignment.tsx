'use client';

import { useMemo, useState, useEffect, useActionState } from 'react';
import { useForm, useWatch, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { RotateCcw } from 'lucide-react';
import { toast } from 'sonner';

import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import {
  trackAssessmentSchema,
  type TrackAssessmentInput,
} from '@/lib/remote-monitoring/schema';
import { assignTrack } from '@/lib/remote-monitoring/engine';
import type { TrackAssessment } from '@/lib/remote-monitoring/types';
import { PatientSelector, type SelectedPatientData } from '@/components/shared/patient-selector';
import { saveTrackAssignment } from '@/lib/integration/actions';
import { TrackResult } from './track-result';

const QUESTIONS = [
  {
    key: 'smartphoneConnectivity' as const,
    label: 'Does the patient have a smartphone with reliable connectivity?',
  },
  {
    key: 'comfortableWithApps' as const,
    label: 'Is the patient comfortable using apps?',
  },
  {
    key: 'reliableTelephone' as const,
    label: 'Does the patient have reliable telephone access?',
  },
];

export function TrackAssignment() {
  const { control, reset, register } = useForm<TrackAssessmentInput>({
    resolver: zodResolver(trackAssessmentSchema),
    defaultValues: {
      smartphoneConnectivity: false,
      comfortableWithApps: false,
      reliableTelephone: false,
      patientName: '',
      mrn: '',
      riskScore: '',
    },
  });

  const watchedValues = useWatch({ control });

  // Patient integration state
  const [selectedPatient, setSelectedPatient] = useState<SelectedPatientData['patient'] | null>(null);
  const [saveState, saveAction, isSaving] = useActionState(saveTrackAssignment, null);

  // Toast on save result
  useEffect(() => {
    if (!saveState) return;
    if (saveState.success) {
      toast.success('Saved to patient record');
      setSelectedPatient(null);
    } else {
      toast.error(saveState.error ?? 'Save failed');
    }
  }, [saveState]);

  const recommendation = useMemo(() => {
    const assessment: TrackAssessment = {
      smartphoneConnectivity: watchedValues.smartphoneConnectivity ?? false,
      comfortableWithApps: watchedValues.comfortableWithApps ?? false,
      reliableTelephone: watchedValues.reliableTelephone ?? false,
    };
    return assignTrack(assessment);
  }, [watchedValues.smartphoneConnectivity, watchedValues.comfortableWithApps, watchedValues.reliableTelephone]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Track Assignment Questionnaire</CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => reset()}
              className="print:hidden"
            >
              <RotateCcw className="mr-1 size-4" />
              Reset
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Optional patient info */}
          <div className="mb-6 grid gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="patientName">Patient Name (optional)</Label>
              <Input
                id="patientName"
                placeholder="Patient name"
                {...register('patientName')}
              />
            </div>
            <div>
              <Label htmlFor="mrn">MRN (optional)</Label>
              <Input id="mrn" placeholder="Medical Record #" {...register('mrn')} />
            </div>
            <div>
              <Label htmlFor="riskScore">Risk Score (optional)</Label>
              <Input
                id="riskScore"
                placeholder="From risk calculator"
                {...register('riskScore')}
              />
            </div>
          </div>

          {/* Toggle questions */}
          <div className="space-y-4">
            {QUESTIONS.map((q) => (
              <Controller
                key={q.key}
                name={q.key}
                control={control}
                render={({ field }) => {
                  const switchId = `switch-${q.key}`;
                  return (
                    <div className="flex items-center gap-3 rounded-lg border p-4">
                      <Switch
                        id={switchId}
                        checked={field.value}
                        onCheckedChange={(val: boolean) => field.onChange(val)}
                      />
                      <label htmlFor={switchId} className="flex-1 cursor-pointer text-sm font-medium">
                        {q.label}
                      </label>
                      <span className="shrink-0 rounded bg-muted px-2 py-0.5 text-xs font-medium">
                        {field.value ? 'Yes' : 'No'}
                      </span>
                    </div>
                  );
                }}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Result always visible -- updates in real time */}
      <TrackResult
        recommendation={recommendation}
        patientName={watchedValues.patientName || undefined}
      />

      {/* Patient record integration */}
      <div className="border-t pt-6 print:hidden">
        <h3 className="text-sm font-medium text-gray-700 mb-3">Save to Patient Record</h3>
        <PatientSelector
          onSelect={(data) => setSelectedPatient(data.patient)}
          selectedPatient={selectedPatient}
          onClear={() => setSelectedPatient(null)}
        />
        {selectedPatient && recommendation && (
          <form action={saveAction} className="mt-3">
            <input type="hidden" name="patientId" value={selectedPatient.id} />
            <input type="hidden" name="track" value={recommendation.track} />
            <Button type="submit" disabled={isSaving} size="sm">
              {isSaving ? 'Saving...' : `Save Track Assignment to ${selectedPatient.full_name}`}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
