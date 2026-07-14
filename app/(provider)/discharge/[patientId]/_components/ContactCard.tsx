'use client';

/**
 * ContactCard -- Client Component
 * Requirement: DSCH-04 (follow-up contact with mark-complete action)
 *
 * Renders a single follow-up card with label, due date, purpose,
 * and status. Pending cards show Mark Complete with inline notes.
 *
 * Source: HEARTLAND Protocol v3.3 Module 4, Section 4.4
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { format, parseISO } from 'date-fns';
import { toast } from 'sonner';
import { Check, Clock, SkipForward } from 'lucide-react';
import { markContactComplete } from '@/lib/discharge/actions';
import type { DischargeFollowup } from '@/lib/discharge/types';

interface ContactCardProps {
  followup: DischargeFollowup;
  patientId: string;
}

const STATUS_CONFIG = {
  pending: {
    badge: 'bg-amber-100 text-amber-700',
    label: 'Pending',
    icon: Clock,
  },
  completed: {
    badge: 'bg-emerald-100 text-emerald-700',
    label: 'Completed',
    icon: Check,
  },
  skipped: {
    badge: 'bg-slate-100 text-slate-600',
    label: 'Skipped',
    icon: SkipForward,
  },
} as const;

export function ContactCard({ followup, patientId: _patientId }: ContactCardProps) {
  const [showNotes, setShowNotes] = useState(false);
  const [notes, setNotes] = useState('');
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const config = STATUS_CONFIG[followup.status];
  const StatusIcon = config.icon;
  const dueDate = format(parseISO(followup.due_at), 'MMM d, yyyy');

  const handleMarkComplete = () => {
    startTransition(async () => {
      const result = await markContactComplete(followup.id, notes);
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success(`${followup.label} marked as completed`);
        setShowNotes(false);
        router.refresh();
      }
    });
  };

  return (
    <div
      className={`rounded-lg border p-4 ${
        followup.status === 'completed'
          ? 'border-emerald-200 bg-emerald-50/50'
          : followup.status === 'skipped'
            ? 'border-gray-200 bg-gray-50'
            : 'border-gray-200 bg-white'
      }`}
      data-testid={`contact-card-${followup.type}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-semibold text-gray-900">
              {followup.label}
            </h3>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${config.badge}`}
              data-testid={`status-badge-${followup.type}`}
            >
              <StatusIcon className="h-3 w-3" />
              {config.label}
            </span>
          </div>

          <p className="text-sm text-gray-500">
            Due: {dueDate}
          </p>

          {followup.purpose && (
            <p className="mt-1 text-sm text-gray-600">{followup.purpose}</p>
          )}

          {/* Completed state: show timestamp and notes */}
          {followup.status === 'completed' && (
            <div className="mt-2 space-y-1">
              {followup.completed_at && (
                <p className="text-xs text-emerald-700">
                  Completed: {format(parseISO(followup.completed_at), 'MMM d, yyyy h:mm a')}
                </p>
              )}
              {followup.contact_notes && (
                <p className="text-xs text-gray-600 italic">
                  Notes: {followup.contact_notes}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Mark Complete button for pending items */}
        {followup.status === 'pending' && !showNotes && (
          <button
            type="button"
            onClick={() => setShowNotes(true)}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 transition-colors"
            data-testid={`mark-complete-${followup.type}`}
          >
            <Check className="h-3.5 w-3.5" />
            Mark Complete
          </button>
        )}
      </div>

      {/* Inline notes + confirm */}
      {followup.status === 'pending' && showNotes && (
        <div className="mt-3 space-y-2" data-testid={`notes-form-${followup.type}`}>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Contact notes (optional)..."
            rows={2}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleMarkComplete}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
            >
              {isPending ? 'Saving...' : 'Confirm'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowNotes(false);
                setNotes('');
              }}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
