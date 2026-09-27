import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EDUCATION_DOMAINS } from '@/lib/education/constants';
import type { EducationResponseInput, EducationResponseContext, EducationResponseResult } from '@/lib/education/types';

const { read, submit, recover } = vi.hoisted(() => ({ read: vi.fn(), submit: vi.fn(), recover: vi.fn() }));
vi.mock('@/lib/education/actions', () => ({
  readEducationContext: read, submitEducationResponse: submit, recoverEducationResponse: recover,
}));
import { TeachBackCard } from '@/app/(patient)/education/_components/teach-back-card';

const actorId = '58000000-0000-4000-8000-000000000001';
const otherActor = '58000000-0000-4000-8000-000000000002';
const contentVersion = '0e09e605951318ccbfdd93a53cd2c87e67645c46d859ac022ed4bcb7b32ca03a';
const domain = EDUCATION_DOMAINS[0];
const close = vi.fn();
const context: EducationResponseContext = { actorId, domainId: domain.id, contentVersion, revision: 0, attempts: 0, completed: false, lastResponse: null };
const props = { actorId, contentVersion, domain, trackAssignment: 'track_b', progress: undefined, onClose: close };
function receipt(input: EducationResponseInput): EducationResponseResult {
  const correct = input.selectedOption === EDUCATION_DOMAINS.find((item) => item.id === input.domainId)!.question.correctIndex;
  return { status: 'saved', context: {
    ...context, actorId: input.actorId, domainId: input.domainId, revision: input.expectedRevision + 1,
    attempts: 1, completed: correct,
    lastResponse: { requestId: input.requestId, baseRevision: input.expectedRevision, selectedOption: input.selectedOption, contentVersion, correct },
  } };
}
async function openQuestion() {
  fireEvent.click(screen.getByRole('button', { name: /I've Read This/i }));
  await waitFor(() => expect(screen.getByRole('button', { name: domain.question.options[0] })).toBeEnabled());
}
async function answer(index = domain.question.correctIndex) {
  await openQuestion();
  fireEvent.click(screen.getByRole('button', { name: domain.question.options[index] }));
  fireEvent.click(screen.getByRole('button', { name: 'Check Answer' }));
}
beforeEach(() => {
  vi.resetAllMocks();
  read.mockImplementation(async (id: string, domainId: string) => ({ status: 'ready', context: { ...context, actorId: id, domainId } }));
  submit.mockImplementation(async (input: EducationResponseInput) => receipt(input));
  recover.mockResolvedValue({ status: 'absent' });
});

describe('patient education self-assessment', () => {
  it.each(EDUCATION_DOMAINS)('offers the content and question for $id, without a tier restriction', (item) => {
    expect(item).not.toHaveProperty('tier');
    expect(item.question.options).toHaveLength(4);
    render(<TeachBackCard {...props} domain={item} />);
    expect(screen.getByText(item.content.common[0])).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /I've Read This/i })).toBeInTheDocument();
  });
  it.each(['track_a', 'track_b'] as const)('renders %s content', (track) => {
    render(<TeachBackCard {...props} trackAssignment={track} />);
    expect(screen.getByText(domain.content[track][0])).toBeInTheDocument();
  });
  it('loads context with the fixed page identity before enabling an answer', async () => {
    render(<TeachBackCard {...props} />);
    await openQuestion();
    expect(read).toHaveBeenCalledExactlyOnceWith(actorId, domain.id);
    expect(screen.getByText(domain.question.text)).toBeInTheDocument();
    for (const option of domain.question.options) expect(screen.getByRole('button', { name: option })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Check Answer' })).toBeDisabled();
    expect(submit).not.toHaveBeenCalled();
  });
  it('separates correct feedback from confirmed persistence', async () => {
    let resolve!: (result: EducationResponseResult) => void;
    submit.mockReturnValue(new Promise((done) => { resolve = done; }));
    render(<TeachBackCard {...props} />);
    await answer();
    expect(screen.getByText('Correct!')).toBeInTheDocument();
    expect(screen.queryByText(/Answer and progress saved/)).not.toBeInTheDocument();
    expect(screen.getByText(/save is not confirmed/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check saved progress' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Back to Modules', exact: true })).toBeDisabled();
    await act(async () => resolve(receipt(submit.mock.calls[0][0])));
    expect(screen.getByText(/Answer and progress saved/)).toBeInTheDocument();
    expect(screen.getByText(domain.question.explanation)).toBeInTheDocument();
  });
  it('saves an incorrect attempt before permitting a new attempt', async () => {
    render(<TeachBackCard {...props} />);
    await answer(0);
    expect(await screen.findByRole('button', { name: 'Try Again' })).toBeInTheDocument();
    expect(screen.getByText(/Not quite/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
    expect(screen.getByRole('button', { name: /I've Read This/ })).toBeInTheDocument();
    expect(submit).toHaveBeenCalledTimes(1);
  });
  it.each(['error', 'throw', 'malformed'])('handles a %s on context loading without accepting an answer', async (kind) => {
    if (kind === 'throw') read.mockRejectedValue(new Error('offline'));
    else read.mockResolvedValue(kind === 'error' ? { status: 'error', error: 'Session changed' } : {});
    render(<TeachBackCard {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /I've Read This/ }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check Answer' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reload current progress' })).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
  });
  it.each(['error', 'throw', 'malformed'])('never claims saved progress on a %s from submission', async (kind) => {
    if (kind === 'throw') submit.mockRejectedValue(new Error('response lost'));
    else submit.mockResolvedValue(kind === 'error' ? { status: 'unconfirmed', error: 'Not confirmed' } : { status: 'saved' });
    render(<TeachBackCard {...props} />);
    await answer();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText(/Answer and progress saved/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try Again' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry saving this answer' })).not.toBeInTheDocument();
  });
  it('recovers a lost response without resubmitting', async () => {
    submit.mockRejectedValue(new Error('lost response'));
    recover.mockImplementation(async (input: EducationResponseInput) => receipt(input));
    render(<TeachBackCard {...props} />);
    await answer();
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Check saved progress' }));
    expect(await screen.findByText(/Answer and progress saved/)).toBeInTheDocument();
    expect(recover).toHaveBeenCalledWith(submit.mock.calls[0][0]);
    expect(submit).toHaveBeenCalledTimes(1);
  });
  it('does not label old questions with a newly installed version', async () => {
    read.mockResolvedValue({ status: 'ready', context: { ...context, contentVersion: 'b'.repeat(64) } });
    render(<TeachBackCard {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /I've Read This/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('question version changed');
    expect(screen.getByRole('button', { name: 'Check Answer' })).toBeDisabled();
    expect(submit).not.toHaveBeenCalled();
  });
  it('retries only after absence is read, retaining UUID, option, actor and revision', async () => {
    submit.mockRejectedValueOnce(new Error('lost'));
    render(<TeachBackCard {...props} />);
    await answer();
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Check saved progress' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Retry saving this answer' }));
    expect(await screen.findByText(/Answer and progress saved/)).toBeInTheDocument();
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[0][0]).toEqual(submit.mock.calls[1][0]);
    expect(submit.mock.calls[0][0].requestId).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('stops a synchronous double click and never changes the captured answer', async () => {
    let resolve!: (result: EducationResponseResult) => void;
    submit.mockReturnValue(new Promise((done) => { resolve = done; }));
    render(<TeachBackCard {...props} />);
    await openQuestion();
    fireEvent.click(screen.getByRole('button', { name: domain.question.options[1] }));
    const check = screen.getByRole('button', { name: 'Check Answer' });
    act(() => { check.click(); check.click(); });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0][0].selectedOption).toBe(1);
    await act(async () => resolve(receipt(submit.mock.calls[0][0])));
  });
  it('does not offer retry or automatic rebase after a conflict', async () => {
    submit.mockResolvedValue({ status: 'conflict', error: 'Reopen this module' });
    render(<TeachBackCard {...props} />);
    await answer();
    expect(await screen.findByRole('alert')).toHaveTextContent('Reopen this module');
    expect(screen.queryByRole('button', { name: 'Check saved progress' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Retry/ })).not.toBeInTheDocument();
    expect(submit).toHaveBeenCalledTimes(1);
  });
  it('does not label old completion as a new correct answer or professional verification', () => {
    render(<TeachBackCard {...props} progress={{
      id: 'legacy', patient_id: actorId, domain_id: domain.id, completed: true,
      completed_at: '2026-01-01T00:00:00Z', attempts: 2, created_at: '2026-01-01T00:00:00Z',
    }} />);
    expect(screen.getByText(/completion was previously saved/)).toBeInTheDocument();
    expect(screen.queryByText('Correct!')).not.toBeInTheDocument();
    expect(screen.queryByText(/Answer and progress saved/)).not.toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
  });
  it.each(['actor', 'domain', 'version', 'unmount'])('discards a late response after %s change', async (change) => {
    let resolve!: (result: EducationResponseResult) => void;
    submit.mockReturnValue(new Promise((done) => { resolve = done; }));
    const view = render(<TeachBackCard {...props} />);
    await answer();
    const pendingInput = submit.mock.calls[0][0];
    if (change === 'unmount') view.unmount();
    else view.rerender(<TeachBackCard {...props} actorId={change === 'actor' ? otherActor : actorId} domain={change === 'domain' ? EDUCATION_DOMAINS[1] : domain} contentVersion={change === 'version' ? 'b'.repeat(64) : contentVersion} />);
    await act(async () => resolve(receipt(pendingInput)));
    expect(screen.queryByText(/Answer and progress saved/)).not.toBeInTheDocument();
    expect(submit).toHaveBeenCalledTimes(1);
  });
});
