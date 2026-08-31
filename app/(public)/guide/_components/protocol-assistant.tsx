'use client';

import { useState } from 'react';
import { BookOpenCheck, Send } from 'lucide-react';
import { getPublicDisseminationContext } from '@/lib/product-analytics/public-context';
import { requestAssist } from '@/lib/sandbox-ai/assist-client';
import { Button } from '@/components/ui/button';

const SUGGESTED_QUESTIONS = [
  'What are the titration safety gates?',
  'How does the Generic Bridge keep therapy affordable?',
  'When does a red flag escalate a check-in call?',
];

interface Answer { answer: string; citations: string[] }

/**
 * Reference assistant over the published implementation content: answers come
 * only from the versioned clinical-content document and always cite their
 * module/section. Unavailable (assistant off or cap reached) degrades to a
 * plain notice — the guide itself is always fully readable without it.
 */
export function ProtocolAssistant() {
  const [question, setQuestion] = useState('');
  const [asked, setAsked] = useState('');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [status, setStatus] = useState<'idle' | 'busy' | 'unavailable'>('idle');

  async function ask(text: string) {
    const trimmed = text.trim();
    if (trimmed.length < 3 || status === 'busy') return;
    setStatus('busy');
    setAsked(trimmed);
    setAnswer(null);
    const result = await requestAssist({
      kind: 'protocol_qa',
      input: { question: trimmed.slice(0, 300) },
      anonymousSessionId: getPublicDisseminationContext().anonymousSessionId,
    });
    if (result?.kind === 'protocol_qa') {
      setAnswer({ answer: result.answer, citations: result.citations });
      setStatus('idle');
      return;
    }
    setStatus('unavailable');
  }

  return (
    <section className="mb-12 rounded-lg border border-blue-200 bg-blue-50/50 p-6 print:hidden" aria-label="Implementation guide reference assistant" data-testid="protocol-assistant">
      <div className="flex items-center gap-3">
        <BookOpenCheck className="h-6 w-6 shrink-0 text-blue-600" aria-hidden="true" />
        <div>
          <h3 className="font-semibold text-gray-900">Ask the implementation guide</h3>
          <p className="text-xs text-gray-500">AI reference assistant over the published HEARTLAND implementation content — every answer cites its module.</p>
        </div>
      </div>

      <form
        className="mt-4 flex items-center gap-2"
        onSubmit={(event) => { event.preventDefault(); void ask(question); }}
      >
        <label className="sr-only" htmlFor="protocol-assistant-input">Ask about the implementation content</label>
        <input
          id="protocol-assistant-input"
          className="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm"
          value={question}
          maxLength={300}
          placeholder="e.g. What does Module 3 say about holding a titration?"
          onChange={(event) => setQuestion(event.target.value)}
          disabled={status === 'busy'}
        />
        <Button type="submit" className="min-h-11" disabled={status === 'busy' || question.trim().length < 3} aria-label="Ask">
          <Send className="size-4" />
        </Button>
      </form>

      <div className="mt-2 flex flex-wrap gap-2">
        {SUGGESTED_QUESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            disabled={status === 'busy'}
            onClick={() => { setQuestion(suggestion); void ask(suggestion); }}
            className="rounded-full border border-blue-200 bg-white px-3 py-1.5 text-xs text-blue-800 hover:bg-blue-100"
          >
            {suggestion}
          </button>
        ))}
      </div>

      {status === 'busy' && <p className="mt-3 text-sm text-gray-500">Looking that up in the published content…</p>}

      {answer && (
        <div className="mt-3 rounded-lg border border-blue-200 bg-white p-4" data-testid="protocol-assistant-answer">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{asked}</p>
          <p className="mt-2 text-sm leading-6 text-gray-800">{answer.answer}</p>
          {answer.citations.length > 0 && (
            <p className="mt-2 flex flex-wrap gap-1.5">
              {answer.citations.map((citation) => (
                <span key={citation} className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-800">{citation}</span>
              ))}
            </p>
          )}
        </div>
      )}

      {status === 'unavailable' && (
        <p className="mt-3 rounded-lg border border-gray-300 bg-gray-100 p-3 text-sm text-gray-600" data-testid="protocol-assistant-unavailable">
          The reference assistant is unavailable right now (disabled or usage cap reached). Every
          topic it covers is in the sections below.
        </p>
      )}

      <p className="mt-3 text-[11px] leading-4 text-gray-500">
        Educational reference only: answers describe the published implementation content, are
        AI-generated, and may be imperfect — verify against the cited module. Not medical advice,
        not patient-specific guidance, and never a substitute for clinical judgment.
      </p>
    </section>
  );
}
