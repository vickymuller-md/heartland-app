'use client';

/**
 * MessageCards -- Patient-facing message card list with auto read-receipt
 *
 * Renders provider messages as cards above the vitals form.
 * Automatically marks each unread message as read on mount via useEffect.
 *
 * Requirements: MSG-03, MSG-05
 */

import { useEffect } from 'react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { MessageSquare } from 'lucide-react';
import type { ProviderMessage } from '@/lib/messages/types';
import { MESSAGE_TEMPLATE_LABELS } from '@/lib/messages/constants';
import { markMessageRead } from '@/lib/messages/actions';

interface MessageCardsProps {
  messages: ProviderMessage[];
}

function MessageCard({ message }: { message: ProviderMessage }) {
  // Auto-mark as read on mount -- CRITICAL: dependency on message.id only
  useEffect(() => {
    if (!message.read_at) {
      markMessageRead(message.id);
    }
  }, [message.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
