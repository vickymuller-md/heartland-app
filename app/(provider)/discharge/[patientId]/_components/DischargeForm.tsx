'use client';

/**
 * DischargeForm -- Client Component
 * Requirement: DSCH-05 (save discharge event and create follow-up schedule)
 *
 * Renders only when no discharge record exists. Collects discharge date,
 * facility tier, and optional notes, then calls saveDischarge Server Action.
 *
 * Source: HEARTLAND Protocol v3.3 Module 4, Section 4.4
 */

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { CalendarDays } from 'lucide-react';
import { saveDischarge } from '@/lib/discharge/actions';

interface DischargeFormProps {
  patientId: string;
  facilityTier: 1 | 2 | 3;
}

export function DischargeForm({ patientId, facilityTier }: DischargeFormProps) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    startTransition(async () => {
      const result = await saveDischarge(formData);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success('Discharge recorded. Follow-up schedule created.');
        router.refresh();
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4" data-testid="discharge-form">
      <input type="hidden" name="patient_id" value={patientId} />

      <div>
        <label
          htmlFor="discharged_at"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          Discharge Date
        </label>
        <input
          type="date"
          id="discharged_at"
          name="discharged_at"
          required
          defaultValue={new Date().toISOString().split('T')[0]}
          className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        />
      </div>

      <div>
        <label
          htmlFor="facility_tier"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          Facility Tier
        </label>
        <select
          id="facility_tier"
          name="facility_tier"
          defaultValue={facilityTier}
          className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        >
          <option value={1}>Tier 1 (Minimal)</option>
          <option value={2}>Tier 2 (Standard)</option>
          <option value={3}>Tier 3 (Advanced)</option>
        </select>
      </div>

      <div>
        <label
          htmlFor="discharge_notes"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          Notes (optional)
        </label>
        <textarea
          id="discharge_notes"
          name="discharge_notes"
          rows={3}
          placeholder="Additional discharge notes..."
          className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        />
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <CalendarDays className="h-4 w-4" />
        {isPending ? 'Saving...' : 'Record Discharge'}
      </button>
    </form>
  );
}
