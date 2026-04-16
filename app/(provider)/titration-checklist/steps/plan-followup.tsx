'use client';

import type { UseFormRegister, FieldErrors } from 'react-hook-form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DualTrackCard } from '@/components/titration/dual-track-card';
import { EvidenceCard } from '@/components/titration/evidence-card';
import type { TitrationFormData } from '@/lib/titration/schema';

interface PlanFollowupProps {
  register: UseFormRegister<TitrationFormData>;
  errors: FieldErrors<TitrationFormData>;
}

export function PlanFollowup({ register, errors }: PlanFollowupProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Plan & Follow-Up</h2>
        <p className="text-sm text-muted-foreground">
          Schedule the next titration call and add any follow-up notes.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="nextCallDate">Next Call Date</Label>
          <Input id="nextCallDate" type="date" {...register('nextCallDate')} />
          {errors.nextCallDate && (
            <p className="text-xs text-destructive">{errors.nextCallDate.message}</p>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="notes">Follow-Up Notes</Label>
        <textarea
          id="notes"
          className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          rows={3}
          placeholder="Additional notes for follow-up..."
          {...register('notes')}
        />
        {errors.notes && (
          <p className="text-xs text-destructive">{errors.notes.message}</p>
        )}
      </div>

      {/* Reference cards below the form */}
      <div className="space-y-4 border-t pt-6">
        <h3 className="text-sm font-semibold text-muted-foreground">Reference Material</h3>
        <DualTrackCard />
        <EvidenceCard />
      </div>
    </div>
  );
}
