'use client';

import { useState } from 'react';
import { HelpCircle } from 'lucide-react';
import { getPublicDisseminationContext } from '@/lib/product-analytics/public-context';
import { requestAssist } from '@/lib/sandbox-ai/assist-client';
import type { CheckInExtraction } from '@/lib/sandbox-ai/types';

const EXPLAINABLE_RULES = new Set([
  'weight_gain_3lb_2d', 'weight_gain_5lb_7d', 'sbp_low_symptomatic', 'spo2_low', 'dyspnea_rest',
]);

/**
 * Per-red-flag "explain" affordance: the AI restates in plain words why the
 * registered rule fired. The rule's own message/action are always visible
 * regardless — an unavailable explanation hides nothing deterministic.
 */
export function ExplainRuleButton({ ruleId, extraction }: {
  ruleId: string;
  extraction?: Partial<CheckInExtraction>;
}) {
  const [status, setStatus] = useState<'idle' | 'busy' | 'shown' | 'unavailable'>('idle');
  const [explanation, setExplanation] = useState('');
  if (!EXPLAINABLE_RULES.has(ruleId)) return null;

  async function explain() {
    if (status === 'busy') return;
    setStatus('busy');
    const result = await requestAssist({
      kind: 'explain_rule',
      input: {
        ruleId: ruleId as 'weight_gain_3lb_2d',
        values: {
          weightLbs: extraction?.weightLbs ?? null,
          sbp: extraction?.sbp ?? null,
          spo2: extraction?.spo2 ?? null,
          dyspnea: extraction?.dyspnea ?? null,
        },
      },
      anonymousSessionId: getPublicDisseminationContext().anonymousSessionId,
    });
    if (result?.kind === 'explain_rule') {
      setExplanation(result.explanation);
      setStatus('shown');
      return;
    }
    setStatus('unavailable');
  }

  if (status === 'shown') {
    return (
      <span className="mt-1 block rounded bg-white/70 p-2 text-[11px] leading-4" data-testid={`explain-rule-${ruleId}`}>
        {explanation}
        <span className="mt-1 block font-semibold opacity-70">AI explanation of the registered rule — the rule itself made the decision.</span>
      </span>
    );
  }
  if (status === 'unavailable') {
    return <span className="mt-1 block text-[11px] opacity-70">Explanation unavailable right now.</span>;
  }
  return (
    <button
      type="button"
      onClick={() => void explain()}
      disabled={status === 'busy'}
      data-testid={`explain-rule-button-${ruleId}`}
      className="mt-1 inline-flex min-h-8 items-center gap-1 text-[11px] font-semibold underline decoration-dotted underline-offset-2 opacity-80 hover:opacity-100"
    >
      <HelpCircle className="size-3" aria-hidden="true" />
      {status === 'busy' ? 'Explaining…' : 'Explain this rule'}
    </button>
  );
}
