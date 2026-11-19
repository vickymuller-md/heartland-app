'use client';

/**
 * MessageCards -- Patient-facing message card list with explicit read confirmation
 *
 * Renders provider messages as cards above the vitals form.
 * Records a read receipt after the patient confirms.
 *
 * Requirements: MSG-03, MSG-05
 */

import { useState, useTransition } from 'react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { MessageSquare } from 'lucide-react';
import type { ProviderMessage } from '@/lib/messages/types';
import { MESSAGE_TEMPLATE_LABELS } from '@/lib/messages/constants';
import { markMessageRead } from '@/lib/messages/actions';

interface MessageCardsProps {
  messages: ProviderMessage[];
}

function MessageCard({ message }: { message: ProviderMessage }) {
  const [pending, startTransition] = useTransition();
  const [confirmation, setConfirmation] = useState<'idle' | 'read' | 'error'>('idle');
  function confirmRead() {
    startTransition(async () => {
      try {
        const result = await markMessageRead(message.id, message.patient_id);
        setConfirmation(result.success ? 'read' : 'error');
      } catch { setConfirmation('error'); }
    });
  }

  let relativeTime: string;
  try {
    relativeTime = formatDistanceToNow(parseISO(message.created_at), {
      addSuffix: true,
    });
  } catch {
    relativeTime = message.created_at;
  }

  const templateLabel = MESSAGE_TEMPLATE_LABELS[message.template_type];

  return (
    <div
      className="rounded-lg border border-blue-200 bg-blue-50 p-4"
      data-testid="message-card"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
            <MessageSquare className="h-3 w-3" />
            {templateLabel}
          </span>
          <span className="text-xs text-gray-500">
            from Dr. {message.provider_name}
          </span>
        </div>
        <span className="text-xs text-gray-500 shrink-0 ml-2">
          {relativeTime}
        </span>
      </div>

      {/* Subject */}
      <p className="text-lg font-semibold text-gray-900 mb-1">
        {message.subject}
      </p>

      {/* Body */}
      <p className="text-lg text-gray-700 whitespace-pre-wrap">
        {message.body}
      </p>
      {!message.read_at && confirmation !== 'read' && <button type="button" onClick={confirmRead} disabled={pending}
        className="mt-3 min-h-11 rounded-md border border-blue-700 px-3 font-medium text-blue-900">
        {pending ? 'Confirming…' : 'Mark as read'}
      </button>}
      {confirmation === 'error' && <p role="alert">Read confirmation unavailable. Try again.</p>}
      {(message.read_at || confirmation === 'read') && <p role="status">Read confirmed in the portal.</p>}
    </div>
  );
}

export function MessageCards({ messages }: MessageCardsProps) {
  if (messages.length === 0) return null;

  return (
    <div className="space-y-3" data-testid="message-cards">
      <h2 className="text-sm font-medium text-gray-700">
        Messages from your provider ({messages.length})
      </h2>
      {messages.map((msg) => (
        <MessageCard key={msg.id} message={msg} />
      ))}
    </div>
  );
}
