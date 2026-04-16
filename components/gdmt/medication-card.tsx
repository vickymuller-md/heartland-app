import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { EvidenceLabel } from './evidence-label';
import type { Medication } from '@/lib/gdmt/types';

interface MedicationCardProps {
  medication: Medication;
  showPriority?: boolean;
}

export function MedicationCard({ medication, showPriority }: MedicationCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div>
          {showPriority && medication.priority != null && (
            <span className="text-sm font-medium text-muted-foreground">
              Priority {medication.priority}
            </span>
          )}
          <CardTitle className="text-lg">{medication.drugClass}</CardTitle>
          <p className="text-sm text-muted-foreground">{medication.agent}</p>
        </div>
        <EvidenceLabel level={medication.evidenceLevel} />
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="font-medium">Starting Dose</dt>
          <dd>{medication.startingDose}</dd>
          <dt className="font-medium">Target Dose</dt>
          <dd>{medication.targetDose}</dd>
        </dl>
        {medication.safetyGates.length > 0 && (
          <div className="mt-3 rounded-md bg-amber-50 p-2 text-sm">
            <span className="font-medium text-amber-800">Safety Gates:</span>
            <ul className="ml-4 list-disc text-amber-700">
              {medication.safetyGates.map((gate) => (
                <li key={gate}>{gate}</li>
              ))}
            </ul>
          </div>
        )}
        {medication.evidenceContext && (
          <p className="mt-3 text-xs text-muted-foreground italic">
            {medication.evidenceContext}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
