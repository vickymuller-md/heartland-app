import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SendMessageForm } from '@/app/(provider)/patients/[patientId]/_components/send-message-form';
import type { MessageActionState } from '@/lib/messages/actions';

const mocks = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('@/lib/messages/actions', () => ({ sendMessage: mocks.send }));
const scope = { actorId: 'actor-A', patientId: 'patient-A' };

function draft(text: string) {
  fireEvent.change(screen.getByLabelText('Message', { exact: true }), { target: { value: text } });
}
function submit() { fireEvent.click(screen.getByRole('button', { name: 'Send Message' })); }
function hold() {
  let finish!: (result: MessageActionState) => void;
  const reply = new Promise<MessageActionState>(resolve => { finish = resolve; });
  mocks.send.mockImplementationOnce(() => reply);
  return finish;
}
function lastRequest(): FormData {
  return mocks.send.mock.lastCall![1] as FormData;
}

beforeEach(() => {
  mocks.send.mockReset().mockImplementation(async (_: unknown, data: FormData) => ({
    success: true, receipt: data.get('requestId'),
  }));
});
afterEach(cleanup);

describe('provider message receipts belong to one draft and patient', () => {
  it('clears the previous success when a new draft starts and waits for its own receipt', async () => {
    render(<SendMessageForm {...scope} />);
    draft('First draft'); submit();
    expect(await screen.findByRole('status')).toHaveTextContent('Message sent');
    const first = lastRequest().get('requestId');
    draft('Second draft');
    expect(screen.queryByRole('status')).toBeNull();
    const finish = hold();
    submit();
    const second = String(lastRequest().get('requestId'));
    expect(second).not.toBe(first);
    expect(screen.getByRole('button', { name: 'Sending...' })).toBeDisabled();
    expect(screen.queryByRole('status')).toBeNull();
    await act(async () => { finish({ success: true, receipt: second }); });
    expect(await screen.findByRole('status')).toHaveTextContent('Message sent');
    expect(screen.getByLabelText('Message', { exact: true })).toHaveValue('');
  });

  it('preserves new text and rejects a late receipt after editing during submission', async () => {
    const finish = hold();
    render(<SendMessageForm {...scope} />);
    draft('Initial draft'); submit();
    const first = String(lastRequest().get('requestId'));
    draft('Follow-up still being written');
    await act(async () => { finish({ success: true, receipt: first }); });
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByLabelText('Message', { exact: true })).toHaveValue('Follow-up still being written');
    submit();
    expect(lastRequest().get('requestId')).not.toBe(first);
    expect(await screen.findByRole('status')).toHaveTextContent('Message sent');
  });

  it('keeps the request identity when an unchanged draft needs a retry', async () => {
    mocks.send.mockResolvedValueOnce({ success: true, receipt: 'different-operation' });
    render(<SendMessageForm {...scope} />);
    draft('Unconfirmed draft'); submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('Retry this draft');
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByLabelText('Message', { exact: true })).toHaveValue('Unconfirmed draft');
    const previous = lastRequest().get('requestId');
    submit();
    expect(lastRequest().get('requestId')).toBe(previous);
    expect(await screen.findByRole('status')).toHaveTextContent('Message sent');
  });

  it.each([{ ...scope, actorId: 'actor-B' }, { ...scope, patientId: 'patient-B' }])(
    'discards prior fields and receipts on actor or patient change', async next => {
      const finish = hold();
      const { rerender } = render(<SendMessageForm {...scope} />);
      draft('Previous context'); submit();
      const first = String(lastRequest().get('requestId'));
      rerender(<SendMessageForm {...next} />);
      expect(screen.getByLabelText('Message', { exact: true })).toHaveValue('');
      draft('New context');
      await act(async () => { finish({ success: true, receipt: first }); });
      expect(screen.queryByRole('status')).toBeNull();
      expect(screen.getByLabelText('Message', { exact: true })).toHaveValue('New context');
      submit();
      await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(2));
      expect(lastRequest().get('patientId')).toBe(next.patientId);
      expect(lastRequest().get('actorId')).toBe(next.actorId);
      expect(lastRequest().get('requestId')).not.toBe(first);
      expect(await screen.findByRole('status')).toHaveTextContent('Message sent');
    },
  );
});
