import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ExplainResultButton } from '@/components/ai/explain-result-button';
import { requestAssist } from '@/lib/sandbox-ai/assist-client';
import type { ExplainResultInput } from '@/lib/sandbox-ai/assist';

vi.mock('@/lib/sandbox-ai/assist-client', () => ({ requestAssist: vi.fn() }));

function assessment(totalScore: number): ExplainResultInput {
  return { module: 'risk', result: { totalScore, tier: totalScore ? 'Moderate' : 'Low', presentFactors: [], followUp: '', monitoring: '', support: '' } };
}

it('keeps the current assessment when a superseded explanation arrives last', async () => {
  let finish!: (v: Awaited<ReturnType<typeof requestAssist>>) => void;
  vi.mocked(requestAssist).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  vi.mocked(requestAssist).mockResolvedValueOnce({ kind: 'explain_result', explanation: 'Second assessment.' });
  const { rerender } = render(<ExplainResultButton input={assessment(0)} />);
  fireEvent.click(screen.getByRole('button', { name: 'Explain this result' }));
  const firstSignal = vi.mocked(requestAssist).mock.lastCall?.[1];
  rerender(<ExplainResultButton input={assessment(5)} />);
  expect(firstSignal?.aborted).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Explain this result' }));
  expect(await screen.findByText('Second assessment.')).toBeVisible();
  await act(async () => finish({ kind: 'explain_result', explanation: 'Earlier assessment.' }));
  expect(screen.queryByText('Earlier assessment.')).not.toBeInTheDocument();
  expect(screen.getByText('Second assessment.')).toBeVisible();
});

it('returns an unavailable explanation when the connection never completes', async () => {
  const client = await vi.importActual<typeof import('@/lib/sandbox-ai/assist-client')>('@/lib/sandbox-ai/assist-client');
  vi.useFakeTimers();
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) =>
    new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('Timed out')))));
  try {
    const request = client.requestAssist({ kind:'explain_result', input:assessment(5), anonymousSessionId:'local' });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await request).toBeNull();
  } finally {
    fetcher.mockRestore();
    vi.useRealTimers();
  }
});
