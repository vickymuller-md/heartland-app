import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SANDBOX_PATIENTS } from '@/lib/sandbox/fixtures';
import { SandboxAiCheckIn } from '@/app/(sandbox)/sandbox/_components/sandbox-ai-checkin';
import { trackProductEvent } from '@/lib/product-analytics/actions';

vi.mock('@/lib/product-analytics/actions', () => ({
  trackProductEvent: vi.fn().mockResolvedValue(undefined),
}));

const james = SANDBOX_PATIENTS.find((patient) => patient.id === 'demo-james')!;

function trackedEventNames(): string[] {
  return vi.mocked(trackProductEvent).mock.calls.map(([input]) => input.eventName);
}

async function reachFallbackForm() {
  // The chat endpoint reports fallback (feature disabled) -> form mode.
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ fallback: true }),
  }));
  fireEvent.change(screen.getByLabelText('Type your check-in answer'), { target: { value: 'no chest pain' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send answer' }));
  await waitFor(() => expect(screen.getByTestId('sandbox-ai-form')).toBeInTheDocument());
}

function submitForm(fields: Record<string, string>) {
  for (const [label, value] of Object.entries(fields)) {
    fireEvent.change(screen.getByLabelText(new RegExp(label)), { target: { value } });
  }
  fireEvent.submit(screen.getByTestId('sandbox-ai-form'));
}

describe('SandboxAiCheckIn — deterministic fallback form', () => {
  const onComplete = vi.fn();
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    render(<SandboxAiCheckIn patient={james} onComplete={onComplete} onClose={onClose} />);
  });

  it('completes a stable check-in as routine with the same rule engine', async () => {
    await reachFallbackForm();
    submitForm({ 'Weight this morning': '188' });

    expect(await screen.findByTestId('sandbox-ai-result')).toHaveTextContent('Routine');
    expect(screen.getByRole('log').textContent).toContain('Nothing you reported needs urgent attention');
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(trackedEventNames()).toEqual(
      expect.arrayContaining(['ai_checkin_started', 'ai_checkin_fallback', 'ai_checkin_completed']),
    );
    expect(trackedEventNames()).not.toContain('ai_escalation_demonstrated');
  });

  it('escalates a weight-gain trend with the registered red-flag texts', async () => {
    await reachFallbackForm();
    submitForm({ 'Weight this morning': '194' });

    expect(await screen.findByTestId('sandbox-ai-result')).toHaveTextContent('Escalated to human review');
    expect(screen.getByTestId('sandbox-ai-result').textContent).toContain('Weight gain of 5+ lbs in 1 week detected');
    expect(trackedEventNames()).toContain('ai_escalation_demonstrated');
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('routes chest pain to the emergency template without running trend rules', async () => {
    await reachFallbackForm();
    fireEvent.change(screen.getByLabelText(/Chest pain or fainting/), { target: { value: 'yes' } });
    submitForm({ 'Weight this morning': '188' });

    expect(await screen.findByTestId('sandbox-ai-result')).toHaveTextContent('Emergency pathway demonstrated');
    expect(screen.getByRole('log').textContent).toContain('call 911');
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
