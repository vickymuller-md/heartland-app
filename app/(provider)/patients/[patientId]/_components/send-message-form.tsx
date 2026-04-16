'use client';

/**
 * SendMessageForm -- Provider compose form for structured messages
 *
 * Template selector auto-populates subject and placeholder.
 * Uses useActionState with sendMessage server action.
 *
 * Requirements: MSG-01, MSG-02, MSG-03
 */

import { useActionState, useEffect, useRef, useState } from 'react';
import { Send, MessageSquare } from 'lucide-react';
import { sendMessage, type MessageActionState } from '@/lib/messages/actions';
import { MESSAGE_TEMPLATES } from '@/lib/messages/constants';
import type { MessageTemplateType } from '@/lib/messages/types';
import { Button } from '@/components/ui/button';

interface SendMessageFormProps {
  patientId: string;
}

export function SendMessageForm({ patientId }: SendMessageFormProps) {
  const [state, formAction, isPending] = useActionState<
    MessageActionState | null,
    FormData
  >(sendMessage, null);

  const formRef = useRef<HTMLFormElement>(null);

  // Template selection state
  const firstTemplate = MESSAGE_TEMPLATES[0];
  const [selectedType, setSelectedType] = useState<MessageTemplateType>(
    firstTemplate.type
  );
  const [subject, setSubject] = useState(firstTemplate.defaultSubject);
  const [body, setBody] = useState('');

  // Find current template for placeholder
  const currentTemplate =
    MESSAGE_TEMPLATES.find((t) => t.type === selectedType) ?? firstTemplate;

  // Reset form on success
  useEffect(() => {
    if (state?.success) {
      formRef.current?.reset();
      setSelectedType(firstTemplate.type);
      setSubject(firstTemplate.defaultSubject);
      setBody('');
    }
  }, [state?.success, firstTemplate.type, firstTemplate.defaultSubject]);

  function handleTemplateChange(newType: MessageTemplateType) {
    setSelectedType(newType);
    const template = MESSAGE_TEMPLATES.find((t) => t.type === newType);
    if (template) {
      setSubject(template.defaultSubject);
      setBody('');
    }
  }

  return (
    <div className="space-y-4" data-testid="send-message-form">
      <div className="flex items-center gap-2">
        <MessageSquare className="h-5 w-5 text-blue-600" />
        <h3 className="text-sm font-medium text-gray-700">Send Message to Patient</h3>
      </div>

      <form ref={formRef} action={formAction} className="space-y-3">
        <input type="hidden" name="patientId" value={patientId} />
        <input type="hidden" name="templateType" value={selectedType} />

        {/* Template selector */}
        <div>
          <label
            htmlFor="template-type"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Message Type
          </label>
          <select
            id="template-type"
            value={selectedType}
            onChange={(e) =>
              handleTemplateChange(e.target.value as MessageTemplateType)
            }
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {MESSAGE_TEMPLATES.map((t) => (
              <option key={t.type} value={t.type}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        {/* Subject */}
        <div>
          <label
            htmlFor="message-subject"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Subject
          </label>
          <input
            id="message-subject"
            type="text"
            name="subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={200}
            required
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          {state?.errors?.subject && (
            <p className="mt-1 text-xs text-red-600">
              {state.errors.subject[0]}
            </p>
          )}
        </div>

        {/* Body */}
        <div>
          <label
            htmlFor="message-body"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Message
          </label>
          <textarea
            id="message-body"
            name="body"
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={2000}
            required
            placeholder={currentTemplate.bodyPlaceholder}
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          {state?.errors?.body && (
            <p className="mt-1 text-xs text-red-600">
              {state.errors.body[0]}
            </p>
          )}
        </div>

        {/* Error / Success */}
        {state?.error && (
          <p className="text-xs text-red-600">{state.error}</p>
        )}

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={isPending} className="gap-1.5">
            <Send className="h-4 w-4" />
            {isPending ? 'Sending...' : 'Send Message'}
          </Button>
          {state?.success && (
            <p className="text-sm text-green-600">Message sent</p>
          )}
        </div>
      </form>
    </div>
  );
}
