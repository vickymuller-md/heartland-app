'use client';

/**
 * Teach-Back Card -- Multi-step education module.
 *
 * 3-step flow: content -> question -> result
 * Requirement: EDUC-03 (teach-back format)
 *
 * Step 1 (content): Patient reads common + track-specific paragraphs.
 * Step 2 (question): Patient answers a multiple-choice question.
 * Step 3 (result): Shows correct/incorrect with explanation.
 */

import { useEffect, useRef, useState, useTransition } from 'react';
import { CheckCircle, XCircle, ArrowLeft } from 'lucide-react';
import { readEducationContext, submitEducationResponse, recoverEducationResponse } from '@/lib/education/actions';
import type { EducationDomain, EducationProgress, EducationResponseContext, EducationResponseInput, EducationResponseResult } from '@/lib/education/types';

interface TeachBackCardProps {
  actorId: string;
  contentVersion: string;
  domain: EducationDomain;
  trackAssignment: string;
  progress: EducationProgress | undefined;
  onClose: () => void;
}

type Step = 'content' | 'question' | 'result';

export function TeachBackCard(props: TeachBackCardProps) {
  return <ResponseCard key={`${props.actorId}:${props.domain.id}:${props.contentVersion}`} {...props} />;
}

function ResponseCard({
  actorId,
  contentVersion,
  domain,
  trackAssignment,
  progress,
  onClose,
}: TeachBackCardProps) {
  const [step, setStep] = useState<Step>(
    progress?.completed ? 'result' : 'content'
  );
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(
    progress?.completed ? true : null
  );
  const [isPending, startTransition] = useTransition();
  const [context, setContext] = useState<EducationResponseContext | null>(null);
  const [attempt, setAttempt] = useState<EducationResponseInput | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'unconfirmed' | 'absent' | 'conflict'>('idle');
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  function run(operation: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    startTransition(async () => {
      try { await operation(); }
      catch {
        if (mounted.current) {
          setSaveStatus('unconfirmed');
          setError('Progress could not be confirmed. Check your connection and try again.');
        }
      } finally { busy.current = false; }
    });
  }

  // Determine which track content to show
  const track = trackAssignment === 'track_a' ? 'track_a' : 'track_b';
  const contentParagraphs = [
    ...domain.content.common,
    ...domain.content[track],
  ];

  function handleReadComplete() {
    setStep('question');
    run(async () => {
      setError(null);
      const result = await readEducationContext(actorId, domain.id);
      if (!mounted.current) return;
      if (result?.status === 'ready' && result.context?.actorId === actorId && result.context.domainId === domain.id
        && result.context.contentVersion === contentVersion) {
        setContext(result.context);
        if (result.context.completed) setStep('result');
      } else {
        setError(result?.status === 'error' ? result.error : 'Current progress or question version changed. Reload the page.');
      }
    });
  }

  function handleCheckAnswer() {
    if (selectedOption === null || !context || busy.current || attempt) return;
    const correct = selectedOption === domain.question.correctIndex;
    setIsCorrect(correct);
    const input: EducationResponseInput = {
      actorId, domainId: domain.id, selectedOption, requestId: crypto.randomUUID(),
      expectedRevision: context.revision, contentVersion,
    };
    setAttempt(input);
    setStep('result');
    run(async () => applyResult(await submitEducationResponse(input), input));
  }

  function applyResult(result: EducationResponseResult, input: EducationResponseInput) {
    if (!mounted.current) return;
    const saved = result?.status === 'saved' && result.context;
    const receipt = saved && saved.lastResponse;
    if (saved && receipt && saved.actorId === input.actorId && saved.domainId === input.domainId
      && saved.contentVersion === input.contentVersion && receipt.requestId === input.requestId
      && receipt.selectedOption === input.selectedOption && receipt.baseRevision === input.expectedRevision
      && receipt.contentVersion === input.contentVersion && saved.revision === input.expectedRevision + 1
      && receipt.correct === (input.selectedOption === domain.question.correctIndex)
      && (!receipt.correct || saved.completed)) {
      setContext(saved);
      setSaveStatus('saved');
      setError(null);
    } else if (result?.status === 'absent') {
      setSaveStatus('absent');
      setError('No saved response was found at this revision. You can retry this same answer.');
    } else if (result?.status === 'conflict') {
      setSaveStatus('conflict');
      setError(result.error);
    } else {
      setSaveStatus('unconfirmed');
      setError(result?.status === 'unconfirmed' ? result.error : 'Saving could not be confirmed. Check saved progress.');
    }
  }

  function handleRetry() {
    if (busy.current || saveStatus !== 'saved') return;
    setSelectedOption(null);
    setIsCorrect(null);
    setContext(null);
    setAttempt(null);
    setSaveStatus('idle');
    setError(null);
    setStep('content');
  }

  return (
    <div className="min-h-[60vh]">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <button
          onClick={onClose}
          disabled={isPending}
          className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"
          aria-label="Back to modules"
        >
          <ArrowLeft className="h-6 w-6" />
        </button>
        <h2 className="text-xl font-bold text-gray-900">{domain.title}</h2>
      </div>

      {isPending && <p role="status" className="mb-4 text-gray-700">{attempt ? 'Confirming saved progress...' : 'Loading current progress...'}</p>}
      {error && <p role="alert" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900">{error}</p>}

      {/* Step 1: Content */}
      {step === 'content' && (
        <div>
          {contentParagraphs.map((paragraph, i) => (
            <p
              key={i}
              className="mb-4 text-lg leading-relaxed text-gray-800"
            >
              {paragraph}
            </p>
          ))}
          <button
            onClick={handleReadComplete}
            className="mt-4 min-h-[48px] w-full rounded-lg bg-blue-600 text-lg font-semibold text-white hover:bg-blue-700"
          >
            I&apos;ve Read This
          </button>
        </div>
      )}

      {/* Step 2: Question */}
      {step === 'question' && (
        <div>
          <p className="mb-4 text-xl font-semibold text-gray-900">
            {domain.question.text}
          </p>
          <div className="space-y-3">
            {domain.question.options.map((option, i) => (
              <button
                key={i}
                onClick={() => setSelectedOption(i)}
                disabled={isPending || !context || !!attempt}
                aria-pressed={selectedOption === i}
                className={`min-h-[48px] w-full rounded-lg border-2 p-4 text-left text-lg transition-colors ${
                  selectedOption === i
                    ? 'border-blue-600 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                {option}
              </button>
            ))}
          </div>
          <button
            onClick={handleCheckAnswer}
            disabled={selectedOption === null || isPending || !context || !!attempt}
            className="mt-6 min-h-[48px] w-full rounded-lg bg-blue-600 text-lg font-semibold text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-500"
          >
            {isPending ? 'Checking...' : 'Check Answer'}
          </button>
          {!context && !isPending && (
            <button onClick={handleReadComplete} className="mt-3 min-h-[48px] w-full rounded-lg border-2 p-3 font-semibold">
              Reload current progress
            </button>
          )}
        </div>
      )}

      {/* Step 3: Result */}
      {step === 'result' && (
        <div>
          {!attempt ? (
            <p className="mb-6 rounded-lg border border-green-200 bg-green-50 p-4 text-green-900">
              Self-assessment completion was previously saved. This is not professional teach-back verification.
            </p>
          ) : isCorrect ? (
            <div className="mb-6 rounded-lg bg-green-50 border border-green-200 p-4">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle className="h-6 w-6 text-green-600" />
                <span className="text-lg font-bold text-green-800">
                  Correct!
                </span>
              </div>
              <p className="text-base text-green-700">
                {domain.question.explanation}
              </p>
            </div>
          ) : (
            <div className="mb-6 rounded-lg bg-amber-50 border border-amber-200 p-4">
              <div className="flex items-center gap-2 mb-2">
                <XCircle className="h-6 w-6 text-amber-600" />
                <span className="text-lg font-bold text-amber-800">
                  Not quite. Let&apos;s review.
                </span>
              </div>
              <p className="text-base text-amber-700">
                {domain.question.explanation}
              </p>
            </div>
          )}

          {attempt && saveStatus === 'saved' && <p role="status" className="mb-4 text-green-800">Answer and progress saved. This is a self-assessment, not professional verification.</p>}
          {attempt && saveStatus !== 'saved' && (
            <div className="mb-4 space-y-3">
              <p className="text-gray-700">Your answer is retained here, but its save is not confirmed. Leaving does not cancel a response already submitted.</p>
              {saveStatus !== 'conflict' && (
                <button disabled={isPending} onClick={() => run(async () => applyResult(await recoverEducationResponse(attempt), attempt))}
                  className="min-h-[48px] w-full rounded-lg border-2 p-3 font-semibold disabled:opacity-50">Check saved progress</button>
              )}
              {saveStatus === 'absent' && (
                <button disabled={isPending} onClick={() => run(async () => applyResult(await submitEducationResponse(attempt), attempt))}
                  className="min-h-[48px] w-full rounded-lg border-2 p-3 font-semibold disabled:opacity-50">Retry saving this answer</button>
              )}
            </div>
          )}

          <div className="flex flex-col gap-3">
            {attempt && !isCorrect && saveStatus === 'saved' && (
              <button
                onClick={handleRetry}
                className="min-h-[48px] w-full rounded-lg bg-amber-500 text-lg font-semibold text-white hover:bg-amber-600"
              >
                Try Again
              </button>
            )}
            <button
              onClick={onClose}
              disabled={isPending}
              className="min-h-[48px] w-full rounded-lg border-2 border-gray-200 text-lg font-semibold text-gray-700 hover:bg-gray-50"
            >
              Back to Modules
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
