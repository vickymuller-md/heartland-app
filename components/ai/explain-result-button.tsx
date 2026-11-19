'use client';

/**
 * "Explain this result" for the public tool modules. Sends ONLY the
 * deterministic engine output the visitor already sees to the assist endpoint
 * and renders the returned narration. Any failure (assistant disabled, rate
 * limit or discarded response) leaves the original result available.
 */

import { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { getPublicDisseminationContext } from '@/lib/product-analytics/public-context';
import type { ExplainResultInput } from '@/lib/sandbox-ai/assist';
import { requestAssist } from '@/lib/sandbox-ai/assist-client';
import { Button } from '@/components/ui/button';

export function ExplainResultButton({ input }: { input: ExplainResultInput }) {
  // A new result gets its own state, including when the user returns to a previous score.
  return <Explanation key={JSON.stringify(input)} input={input} />;
}

function Explanation({ input }: { input: ExplainResultInput }) {
  const [status, setStatus] = useState<'idle' | 'busy' | 'shown' | 'unavailable'>('idle');
  const [explanation, setExplanation] = useState<string | null>(null);
  const pendingRequest = useRef<AbortController | null>(null);
  useEffect(() => () => pendingRequest.current?.abort(), []);

  async function explain() {
    if (status === 'busy') return;
    setStatus('busy');
    const controller = new AbortController();
    pendingRequest.current = controller;
    const result = await requestAssist({
      kind: 'explain_result',
      input,
      anonymousSessionId: getPublicDisseminationContext().anonymousSessionId,
    }, controller.signal);
    if (controller.signal.aborted) return;
    pendingRequest.current = null;
    if (result?.kind === 'explain_result') {
      setExplanation(result.explanation);
      setStatus('shown');
    } else {
      setStatus('unavailable');
    }
  }

  return (
    <div className="mt-3" data-testid="explain-result" aria-live="polite">
      {status === 'unavailable' && <p className="mb-2 text-sm">The explanation is unavailable. You can still review the calculated result or try again.</p>}
      {status !== 'shown' && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="min-h-11"
          disabled={status === 'busy'}
          onClick={() => void explain()}
          data-testid="explain-result-button"
        >
          <Sparkles className="mr-2 size-4" aria-hidden="true" />
          {status === 'busy' ? 'Explaining…' : status === 'unavailable' ? 'Retry explanation' : 'Explain this result'}
        </Button>
      )}
      {status === 'shown' && explanation && (
        <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-3 text-sm leading-6 text-slate-800" data-testid="explain-result-text">
          {explanation}
          <p className="mt-2 text-[11px] font-semibold text-slate-600">
            AI explanation of a result the deterministic engine already computed — educational
            implementation-support resource, not medical advice.
          </p>
        </div>
      )}
    </div>
  );
}
