/**
 * Teach-Back Education Tests
 * Requirements: EDUC-01, EDUC-03, EDUC-05
 *
 * Verifies: teach-back card renders content, question, result steps.
 * Correct answer shows success. Incorrect answer shows retry option.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EDUCATION_DOMAINS } from '@/lib/education/constants';

// Mock server actions
vi.mock('@/lib/education/actions', () => ({
  completeModule: vi.fn(async () => ({ success: true })),
  incrementAttempts: vi.fn(async () => ({ success: true })),
  resetModule: vi.fn(async () => ({ success: true })),
}));

import { TeachBackCard } from '@/app/(patient)/education/_components/teach-back-card';

const mockOnClose = vi.fn();
const dailyWeight = EDUCATION_DOMAINS[0]; // daily_weight domain

describe('TeachBackCard', () => {
  beforeEach(() => {
    mockOnClose.mockClear();
  });

  describe('Core Domains (EDUC-01)', () => {
    it('daily_weight domain has title, content, and question', () => {
      expect(dailyWeight.title).toBe('Daily Weight Monitoring');
      expect(dailyWeight.content.common.length).toBeGreaterThan(0);
      expect(dailyWeight.question.text).toBeTruthy();
    });

    it('medications domain has title, content, and question', () => {
      const meds = EDUCATION_DOMAINS.find((d) => d.id === 'medications')!;
      expect(meds.title).toBe('Taking Your Heart Medications');
      expect(meds.content.common.length).toBeGreaterThan(0);
      expect(meds.question.text).toBeTruthy();
    });

    it('warning_signs domain has title, content, and question', () => {
      const ws = EDUCATION_DOMAINS.find((d) => d.id === 'warning_signs')!;
      expect(ws.title).toBe('Warning Signs to Watch For');
      expect(ws.content.common.length).toBeGreaterThan(0);
      expect(ws.question.text).toBeTruthy();
    });

    it('all 3 core domains have tier set to core', () => {
      const coreDomains = EDUCATION_DOMAINS.filter((d) => d.tier === 'core');
      expect(coreDomains).toHaveLength(3);
      coreDomains.forEach((d) => expect(d.tier).toBe('core'));
    });
  });

  describe('Teach-Back Flow (EDUC-03)', () => {
    it('initially shows content paragraphs', () => {
      render(
        <TeachBackCard
          domain={dailyWeight}
          trackAssignment="track_b"
          progress={undefined}
          onClose={mockOnClose}
        />
      );

      // Should show first common paragraph
      expect(
        screen.getByText(/Weighing yourself every day/i)
      ).toBeInTheDocument();
      // Should show "I've Read This" button
      expect(
        screen.getByRole('button', { name: /I've Read This/i })
      ).toBeInTheDocument();
    });

    it('after reading content, user sees verification question', () => {
      render(
        <TeachBackCard
          domain={dailyWeight}
          trackAssignment="track_b"
          progress={undefined}
          onClose={mockOnClose}
        />
      );

      fireEvent.click(
        screen.getByRole('button', { name: /I've Read This/i })
      );

      // Should show question text
      expect(
        screen.getByText(dailyWeight.question.text)
      ).toBeInTheDocument();
    });

    it('question shows multiple choice options', () => {
      render(
        <TeachBackCard
          domain={dailyWeight}
          trackAssignment="track_b"
          progress={undefined}
          onClose={mockOnClose}
        />
      );

      fireEvent.click(
        screen.getByRole('button', { name: /I've Read This/i })
      );

      // All options should be visible
      dailyWeight.question.options.forEach((option) => {
        expect(screen.getByText(option)).toBeInTheDocument();
      });
    });

    it('selecting correct answer shows success with explanation', async () => {
      render(
        <TeachBackCard
          domain={dailyWeight}
          trackAssignment="track_b"
          progress={undefined}
          onClose={mockOnClose}
        />
      );

      // Navigate to question
      fireEvent.click(
        screen.getByRole('button', { name: /I've Read This/i })
      );

      // Select correct answer
      const correctOption =
        dailyWeight.question.options[dailyWeight.question.correctIndex];
      fireEvent.click(screen.getByText(correctOption));

      // Submit answer
      fireEvent.click(
        screen.getByRole('button', { name: /Check Answer/i })
      );

      // Should show success
      await waitFor(() => {
        expect(screen.getByText(/Correct!/i)).toBeInTheDocument();
      });
      expect(
        screen.getByText(dailyWeight.question.explanation)
      ).toBeInTheDocument();
    });

    it('selecting incorrect answer shows explanation and allows retry', async () => {
      render(
        <TeachBackCard
          domain={dailyWeight}
          trackAssignment="track_b"
          progress={undefined}
          onClose={mockOnClose}
        />
      );

      // Navigate to question
      fireEvent.click(
        screen.getByRole('button', { name: /I've Read This/i })
      );

      // Select an incorrect answer (pick one that is NOT correctIndex)
      const wrongIndex =
        dailyWeight.question.correctIndex === 0 ? 1 : 0;
      fireEvent.click(
        screen.getByText(dailyWeight.question.options[wrongIndex])
      );

      // Submit answer
      fireEvent.click(
        screen.getByRole('button', { name: /Check Answer/i })
      );

      // Should show "Not quite" message
      await waitFor(() => {
        expect(
          screen.getByText(/Not quite/i)
        ).toBeInTheDocument();
      });

      // Should have "Try Again" button
      expect(
        screen.getByRole('button', { name: /Try Again/i })
      ).toBeInTheDocument();
    });
  });

  describe('Track Content (EDUC-04)', () => {
    it('Track B content is shown when trackAssignment is track_b', () => {
      render(
        <TeachBackCard
          domain={dailyWeight}
          trackAssignment="track_b"
          progress={undefined}
          onClose={mockOnClose}
        />
      );

      // Track B content should be visible
      expect(
        screen.getByText(/paper diary/i)
      ).toBeInTheDocument();
    });

    it('Track A content is shown when trackAssignment is track_a', () => {
      render(
        <TeachBackCard
          domain={dailyWeight}
          trackAssignment="track_a"
          progress={undefined}
          onClose={mockOnClose}
        />
      );

      // Track A content should mention the app
      expect(
        screen.getByText(/HEARTLAND app/i)
      ).toBeInTheDocument();
    });
  });

  describe('Completed State', () => {
    it('already completed modules show result state on open', () => {
      render(
        <TeachBackCard
          domain={dailyWeight}
          trackAssignment="track_b"
          progress={{
            id: '1',
            patient_id: 'p1',
            domain_id: 'daily_weight',
            completed: true,
            completed_at: '2026-01-01T00:00:00Z',
            attempts: 1,
            created_at: '2026-01-01T00:00:00Z',
          }}
          onClose={mockOnClose}
        />
      );

      // Should show correct result directly
      expect(screen.getByText(/Correct!/i)).toBeInTheDocument();
    });
  });
});
