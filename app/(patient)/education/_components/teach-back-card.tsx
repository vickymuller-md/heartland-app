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

import { useState, useTransition } from 'react';
import { CheckCircle, XCircle, ArrowLeft } from 'lucide-react';
import { completeModule, incrementAttempts } from '@/lib/education/actions';
import type { EducationDomain, EducationProgress } from '@/lib/education/types';

interface TeachBackCardProps {
  domain: EducationDomain;
  trackAssignment: string;
  progress: EducationProgress | undefined;
  onClose: () => void;
}

type Step = 'content' | 'question' | 'result';

export function TeachBackCard({
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

  // Determine which track content to show
  const track = trackAssignment === 'track_a' ? 'track_a' : 'track_b';
  const contentParagraphs = [
    ...domain.content.common,
    ...domain.content[track],
  ];

  function handleReadComplete() {
    setStep('question');
  }

  function handleCheckAnswer() {
    if (selectedOption === null) return;

    const correct = selectedOption === domain.question.correctIndex;
    setIsCorrect(correct);

    startTransition(async () => {
      // Always increment attempts
      await incrementAttempts(domain.id);

      if (correct) {
        // Mark module complete via Server Action
        const formData = new FormData();
        formData.set('domain_id', domain.id);
        await completeModule(null, formData);
      }

      setStep('result');
    });
  }

  function handleRetry() {
    setSelectedOption(null);
    setIsCorrect(null);
    setStep('content');
  }

  return (
    <div className="min-h-[60vh]">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <button
          onClick={onClose}
          className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"
          aria-label="Back to modules"
        >
          <ArrowLeft className="h-6 w-6" />
        </button>
        <h2 className="text-xl font-bold text-gray-900">{domain.title}</h2>
      </div>

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
            disabled={selectedOption === null || isPending}
            className="mt-6 min-h-[48px] w-full rounded-lg bg-blue-600 text-lg font-semibold text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-500"
          >
            {isPending ? 'Checking...' : 'Check Answer'}
          </button>
        </div>
      )}

      {/* Step 3: Result */}
      {step === 'result' && (
        <div>
          {isCorrect ? (
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

          <div className="flex flex-col gap-3">
            {!isCorrect && (
              <button
                onClick={handleRetry}
                className="min-h-[48px] w-full rounded-lg bg-amber-500 text-lg font-semibold text-white hover:bg-amber-600"
              >
                Try Again
              </button>
            )}
            <button
              onClick={onClose}
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
