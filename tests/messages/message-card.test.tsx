/**
 * MessageCards Component -- Tests
 * Requirement: MSG-03, PTUX-02
 * Source: HEARTLAND Protocol v3.3 -- Phase 19 Structured Provider Messages
 *
 * MSG-03: Patient sees message as a card in their Today view
 * PTUX-02: Subject and body render at text-lg (18px) minimum
 * - Renders card for each unread message with subject and body
 * - Renders nothing when messages array is empty
 * - Calls markMessageRead on mount when read_at is null
 * - Does NOT call markMessageRead if read_at is already set
 * - Subject and body at text-lg class
 */

import { render, screen } from '@testing-library/react';
import { MessageCards } from '@/app/(patient)/today/_components/message-card';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { ProviderMessage } from '@/lib/messages/types';

// Mock markMessageRead server action
const mockMarkMessageRead = vi.fn();
vi.mock('@/lib/messages/actions', () => ({
  markMessageRead: (...args: unknown[]) => mockMarkMessageRead(...args),
}));

// Mock date-fns to avoid relative time issues in tests
vi.mock('date-fns', () => ({
  formatDistanceToNow: () => '2 hours ago',
  parseISO: (s: string) => new Date(s),
}));

// Mock lucide-react MessageSquare icon
vi.mock('lucide-react', () => ({
  MessageSquare: () => <span data-testid="icon-message-square" />,
}));

function createMessage(overrides: Partial<ProviderMessage> = {}): ProviderMessage {
  return {
    id: 'msg-1',
    patient_id: 'patient-1',
    provider_id: 'provider-1',
    provider_name: 'Smith',
    template_type: 'general',
    subject: 'Test Subject',
    body: 'Test body content',
    read_at: null,
    created_at: '2026-03-27T10:00:00Z',
    ...overrides,
  };
}

describe('MessageCards component (MSG-03, PTUX-02)', () => {
  beforeEach(() => {
    mockMarkMessageRead.mockClear();
  });

  it('renders a card for each unread message with subject and body text', () => {
    const msgs = [
      createMessage({ id: 'msg-1', subject: 'Subject One', body: 'Body One' }),
      createMessage({ id: 'msg-2', subject: 'Subject Two', body: 'Body Two' }),
    ];
    render(<MessageCards messages={msgs} />);
    expect(screen.getByText('Subject One')).toBeInTheDocument();
    expect(screen.getByText('Body One')).toBeInTheDocument();
    expect(screen.getByText('Subject Two')).toBeInTheDocument();
    expect(screen.getByText('Body Two')).toBeInTheDocument();
    expect(screen.getAllByTestId('message-card')).toHaveLength(2);
  });

  it('renders nothing when messages array is empty', () => {
    const { container } = render(<MessageCards messages={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('calls markMessageRead on mount when read_at is null', () => {
    const msg = createMessage({ id: 'msg-unread', read_at: null });
    render(<MessageCards messages={[msg]} />);
    expect(mockMarkMessageRead).toHaveBeenCalledWith('msg-unread');
  });

  it('does NOT call markMessageRead if message.read_at is already set', () => {
    const msg = createMessage({
      id: 'msg-read',
      read_at: '2026-03-27T09:00:00Z',
    });
    render(<MessageCards messages={[msg]} />);
    expect(mockMarkMessageRead).not.toHaveBeenCalled();
  });

  it('renders subject at text-lg class (PTUX-02)', () => {
    const msg = createMessage({ subject: 'Big Subject' });
    render(<MessageCards messages={[msg]} />);
    const subjectEl = screen.getByText('Big Subject');
    expect(subjectEl.className).toMatch(/text-lg/);
    expect(subjectEl.className).toMatch(/font-semibold/);
  });

  it('renders body at text-lg class (PTUX-02)', () => {
    const msg = createMessage({ body: 'Big Body Text' });
    render(<MessageCards messages={[msg]} />);
    const bodyEl = screen.getByText('Big Body Text');
    expect(bodyEl.className).toMatch(/text-lg/);
  });
});
