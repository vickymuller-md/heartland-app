'use client';

/**
 * ContactScheduler -- Client Component
 * Requirements: DSCH-03 (auto-scheduled follow-up), DSCH-05 (discharge form)
 *
 * If no discharge record exists: renders DischargeForm to create one.
 * If record exists: renders the follow-up schedule as ContactCard list.
 *
 * Source: HEARTLAND Protocol v3.3 Module 4, Section 4.4
 */

import { Calendar } from 'lucide-react';
import { DischargeForm } from './DischargeForm';
import { ContactCard } from './ContactCard';
import type { DischargeFollowup } from '@/lib/discharge/types';

interface ContactSchedulerProps {
  patientId: string;
  facilityTier: 1 | 2 | 3;
  followups: DischargeFollowup[];
  hasRecord: boolean;
}

export function ContactScheduler({
  patientId,
  facilityTier,
  followups,
  hasRecord,
}: ContactSchedulerProps) {
  const completedCount = followups.filter((f) => f.status === 'completed').length;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 print:hidden">
      <div className="flex items-center gap-2 mb-4">
        <Calendar className="h-5 w-5 text-slate-700" />
        <h2 className="text-lg font-semibold text-gray-900">
          Post-Discharge Follow-Up Schedule
        </h2>
      </div>

      {!hasRecord ? (
        <div>
          <p className="text-sm text-gray-500 mb-4">
            Record the discharge to auto-generate the 5-contact follow-up schedule.
          </p>
          <DischargeForm patientId={patientId} facilityTier={facilityTier} />
        </div>
      ) : (
        <div>
          <p className="text-sm text-gray-500 mb-4">
            <span className="font-medium text-gray-700">{completedCount}</span>{' '}
            of {followups.length} contacts completed
          </p>

          <div className="space-y-3" data-testid="followup-list">
            {followups.map((followup) => (
              <ContactCard
                key={followup.id}
                followup={followup}
                patientId={patientId}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
