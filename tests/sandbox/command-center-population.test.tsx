/**
 * The population scene must run entirely from the deterministic engine (the
 * displayed numbers ARE simulatePopulationDay's numbers), show the bounded
 * claim with its illustrative-demonstration disclaimer, and surface only
 * rule-backed exceptions to the review queue.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SandboxCommandCenter } from '@/app/(sandbox)/sandbox/_components/sandbox-command-center';
import { simulatePopulationDay } from '@/lib/sandbox/population';

vi.mock('@/lib/product-analytics/actions', () => ({
  trackProductEvent: vi.fn().mockResolvedValue(undefined),
}));

const numberFormat = new Intl.NumberFormat('en-US');

describe('SandboxCommandCenter population scene', () => {
  const onNavigate = vi.fn();
  const onPopulationSize = vi.fn();
  const onMarkPopulationReviewed = vi.fn();
  const onSendToDailyLoop = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // Reduced motion: the replay lands on the final state without any rAF loop.
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(performance.now());
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    render(
      <SandboxCommandCenter
        taskStates={{}}
        visitedSections={['command']}
        dayIndex={0}
        populationSize={500}
        populationReviewedIds={[]}
        sentWorkItemIds={[]}
        onPopulationSize={onPopulationSize}
        onMarkPopulationReviewed={onMarkPopulationReviewed}
        onSendToDailyLoop={onSendToDailyLoop}
        onNavigate={onNavigate}
        automatedCallsCount={4}
      />,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts idle with placeholder counters and the standing disclaimer', () => {
    expect(screen.getByTestId('population-funnel')).toHaveTextContent('—');
    expect(screen.getByTestId('population-disclaimer')).toHaveTextContent(
      'Illustrative workflow demonstration on synthetic data — not a clinical outcome or staffing claim.',
    );
    expect(screen.queryByTestId('population-claim')).toBeNull();
    expect(screen.queryByTestId('population-exceptions')).toBeNull();
  });

  it('runs the round and shows exactly the engine numbers, claim, and review queue', () => {
    fireEvent.click(screen.getByTestId('population-run'));

    const expected = simulatePopulationDay(500, 0);
    const funnel = screen.getByTestId('population-funnel');
    expect(funnel).toHaveTextContent(numberFormat.format(expected.counts.total));
    expect(funnel).toHaveTextContent(String(expected.counts.routine));
    expect(funnel).toHaveTextContent(String(expected.counts.reviewQueue));

    expect(screen.getByTestId('population-claim')).toHaveTextContent(
      `${expected.counts.reviewQueue} of ${numberFormat.format(expected.counts.total)} synthetic check-ins reached the clinician review queue — ${expected.counts.automatedPct}% resolved by the registered rules.`,
    );
    // The metric never phrases capacity as a staffing ratio.
    expect(screen.getByTestId('population-claim')).not.toHaveTextContent('1 clinician');

    const queue = screen.getByTestId('population-exceptions');
    expect(queue).toHaveTextContent(`Today's review queue (${expected.counts.reviewQueue} of ${numberFormat.format(expected.counts.total)})`);
    expect(queue).toHaveTextContent(expected.exceptions[0].name);
    const flagged = expected.exceptions.find((exception) => exception.ruleIds.length > 0);
    if (flagged) expect(queue).toHaveTextContent(`rule ${flagged.ruleIds[0]}`);
  });

  it('expands a queue entry into values, the registered rule, and working actions', () => {
    fireEvent.click(screen.getByTestId('population-run'));

    const firstEntry = screen.getAllByTestId(/^queue-entry-/)[0];
    const ordinal = firstEntry.getAttribute('data-testid')!.replace('queue-entry-', '');
    fireEvent.click(firstEntry);

    const detail = screen.getByTestId(`queue-detail-${ordinal}`);
    expect(detail.textContent).toMatch(/Registered rule|monitoring-gap policy/);

    fireEvent.click(screen.getByTestId(`queue-review-${ordinal}`));
    expect(onMarkPopulationReviewed).toHaveBeenCalledWith(`pop-${ordinal}-d0`);

    fireEvent.click(screen.getByTestId(`queue-send-${ordinal}`));
    expect(onSendToDailyLoop).toHaveBeenCalledTimes(1);
    const run = onSendToDailyLoop.mock.calls[0][0];
    expect(run.id).toBe(`ai-run-pop${ordinal}d0`);
    expect(['escalated', 'no_answer']).toContain(run.disposition);
    expect(run.atLabel).toBe('Overnight round');
    if (run.disposition === 'no_answer') expect(run.note).toBeTruthy();
    else expect(run.redFlagIds.length).toBeGreaterThan(0);
  });

  it('lets the visitor change the population size', () => {
    fireEvent.click(screen.getByTestId('population-size-2500'));
    expect(onPopulationSize).toHaveBeenCalledWith(2500);
    expect(screen.getByTestId('population-size-500')).toHaveAttribute('aria-pressed', 'true');
  });
});
