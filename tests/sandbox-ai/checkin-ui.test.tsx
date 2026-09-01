import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SANDBOX_PATIENTS } from '@/lib/sandbox/fixtures';
import { SandboxAiCheckIn } from '@/app/(sandbox)/sandbox/_components/sandbox-ai-checkin';
import { SandboxPatientView } from '@/app/(sandbox)/sandbox/_components/sandbox-patient-view';
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

const COMPLETE_STABLE_ANSWERS = {
  'Chest pain or fainting': 'no',
  'Breathing today': '0',
  'New or worse swelling': '0',
  'Needed extra pillows': 'no',
  'Energy vs normal': '0',
  'All medicines taken': 'yes',
};

describe('SandboxAiCheckIn — deterministic fallback form', () => {
  const onComplete = vi.fn();
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    render(<SandboxAiCheckIn patient={james} onComplete={onComplete} onClose={onClose} />);
  });

  it('completes a stable check-in as routine with the same rule engine', async () => {
    await reachFallbackForm();
    submitForm({ ...COMPLETE_STABLE_ANSWERS, 'Weight this morning': '188' });

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
    submitForm({ ...COMPLETE_STABLE_ANSWERS, 'Weight this morning': '194' });

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

  it('never converts unanswered fields into negative answers and routes missing data to review', async () => {
    await reachFallbackForm();
    submitForm({ 'Weight this morning': '188' });

    const result = await screen.findByTestId('sandbox-ai-result');
    expect(result).toHaveTextContent('Escalated to human review');
    expect(result).toHaveTextContent('unanswered items require human review');
    expect(result).toHaveTextContent('AI did not infer negative answers');
    expect(result).not.toHaveTextContent('Routine');
  });

  it('places the no-real-data warning next to free text and marks Spanish conversation language', () => {
    const input = screen.getByLabelText('Type your check-in answer');
    expect(input).toHaveAttribute('aria-describedby', 'sandbox-ai-synthetic-input-note');
    expect(screen.getByText(/do not enter real patient, personal, or health information/i)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('checkin-locale-es'));
    expect(screen.getByRole('log')).toHaveAttribute('lang', 'es-US');
  });
});

describe('SandboxPatientView — mutually exclusive check-in experiences', () => {
  it('replaces the active daily call when titration opens, then replaces it with chat check-in', () => {
    render(<SandboxPatientView patient={james} patientCheckIns={[]} onCheckIn={vi.fn()} />);

    fireEvent.click(screen.getByTestId('open-live-call'));
    expect(screen.getAllByTestId('sandbox-live-call')).toHaveLength(1);
    expect(screen.getByText(/Automated daily check-in calling/i)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('open-titration-call'));
    expect(screen.getAllByTestId('sandbox-live-call')).toHaveLength(1);
    expect(screen.getByText(/Titration follow-up calling/i)).toBeInTheDocument();
    expect(screen.queryByText(/Automated daily check-in calling/i)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Complete symptom check-in/ }));
    expect(screen.getByTestId('sandbox-ai-checkin')).toBeInTheDocument();
    expect(screen.queryByTestId('sandbox-live-call')).toBeNull();
  });
});
