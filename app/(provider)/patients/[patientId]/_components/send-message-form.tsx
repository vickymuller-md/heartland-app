'use client';

/**
 * SendMessageForm -- Provider compose form for structured messages
 *
 * Template selector auto-populates subject and placeholder.
 * A receipt belongs to one draft, provider, and patient.
 *
 * Requirements: MSG-01, MSG-02, MSG-03
 */

import { type FormEvent, useRef, useState, useTransition } from 'react';
import { Send, MessageSquare } from 'lucide-react';
import { sendMessage, type MessageActionState } from '@/lib/messages/actions';
import { MESSAGE_TEMPLATES } from '@/lib/messages/constants';
import type { MessageTemplateType } from '@/lib/messages/types';
import { Button } from '@/components/ui/button';

interface SendMessageFormProps {
  patientId: string;
  actorId: string;
}

export function SendMessageForm(props: SendMessageFormProps) {
  return <MessageDraft key={props.actorId + ':' + props.patientId} {...props} />;
}

function MessageDraft({ patientId, actorId }: SendMessageFormProps) {
  const [feedback, setFeedback] = useState<MessageActionState | null>(null);
  const [isPending, startTransition] = useTransition();
  const requestId = useRef('');
  const sending = useRef(false);

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

  function editDraft() {
    requestId.current = '';
    setFeedback(null);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;
    const id = requestId.current || crypto.randomUUID();
    requestId.current = id;
    const data = new FormData(event.currentTarget);
    data.set('requestId', id);
    data.set('actorId', actorId);
    sending.current = true;
    setFeedback(null);

    startTransition(async () => {
      try {
        const result = await sendMessage(null, data);
        // The clinician can already be writing the next draft when the reply arrives.
        if (requestId.current !== id) return;
        if (result.success) {
          if (result.receipt !== id) throw new Error('Unconfirmed message');
          setSelectedType(firstTemplate.type);
          setSubject(firstTemplate.defaultSubject);
          setBody('');
          requestId.current = '';
        }
        setFeedback(result);
      } catch {
        if (requestId.current === id) {
          setFeedback({ error: 'Portal save could not be confirmed. Retry this draft.' });
        }
      } finally {
        sending.current = false;
      }
    });
  }

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

      <form onSubmit={submit} onChange={editDraft} className="space-y-3">
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
          {feedback?.errors?.subject && (
            <p className="mt-1 text-xs text-red-600">
              {feedback.errors.subject[0]}
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
          {feedback?.errors?.body && (
            <p className="mt-1 text-xs text-red-600">
              {feedback.errors.body[0]}
            </p>
          )}
        </div>

        {/* Error / Success */}
        {feedback?.error && (
          <p role="alert" className="text-xs text-red-600">{feedback.error}</p>
        )}

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={isPending} className="gap-1.5">
            <Send className="h-4 w-4" />
            {isPending ? 'Sending...' : 'Send Message'}
          </Button>
          {feedback?.success && (
            <p role="status" className="text-sm text-green-700">Message sent</p>
          )}
        </div>
      </form>
    </div>
  );
}
