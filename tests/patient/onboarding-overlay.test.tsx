/**
 * OnboardingOverlay Component -- Tests
 * Requirement: PTUX-01
 * Source: HEARTLAND Protocol v3.3 -- Phase 25 Patient Onboarding UX
 *
 * PTUX-01: 3-screen welcome flow on first login
 * - Screen 1: Welcome content with Next button
 * - Screen 2: Daily routine with Next button
 * - Screen 3: Data privacy with Get Started button
 * - Dot progress indicator tracks current screen
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock markOnboardingSeen server action
vi.mock('@/lib/patient/onboarding-actions', () => ({
  markOnboardingSeen: vi.fn().mockResolvedValue(undefined),
}));

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    clear: () => {
      store = {};
    },
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

import { OnboardingOverlay } from '@/app/(patient)/today/_components/onboarding-overlay';

describe('OnboardingOverlay (PTUX-01)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
  });

  it('renders screen 1 of 3 on mount with welcome content and Next button', () => {
    render(<OnboardingOverlay showOnboarding={true} />);

    expect(screen.getByText('Welcome to HEARTLAND')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next/i })).toBeInTheDocument();
  });

  it('advances to screen 2 when Next is clicked on screen 1', () => {
    render(<OnboardingOverlay showOnboarding={true} />);

    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    expect(screen.getByText('Your Daily Routine')).toBeInTheDocument();
  });

  it('advances to screen 3 when Next is clicked on screen 2', () => {
    render(<OnboardingOverlay showOnboarding={true} />);

    // Advance to screen 2
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    // Advance to screen 3
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    expect(screen.getByText('Your Data is Private')).toBeInTheDocument();
  });

  it('calls markOnboardingSeen and sets localStorage when Get Started is clicked on screen 3', async () => {
    const { markOnboardingSeen } = await import(
      '@/lib/patient/onboarding-actions'
    );

    render(<OnboardingOverlay showOnboarding={true} />);

    // Navigate to screen 3
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    // Click Get Started
    fireEvent.click(screen.getByRole('button', { name: /get started/i }));

    expect(markOnboardingSeen).toHaveBeenCalled();
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'heartland_onboarding_seen',
      '1'
    );
  });

  it('shows dot progress indicator with active dot for current screen (1, 2, 3)', () => {
    render(<OnboardingOverlay showOnboarding={true} />);

    // Screen 1: 3 dots, first one is active (bg-blue-600)
    const dots = screen.getAllByTestId('progress-dot');
    expect(dots).toHaveLength(3);
    expect(dots[0].className).toMatch(/bg-blue-600/);
    expect(dots[1].className).toMatch(/bg-gray-300/);
    expect(dots[2].className).toMatch(/bg-gray-300/);

    // Advance to screen 2
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    const dots2 = screen.getAllByTestId('progress-dot');
    expect(dots2[0].className).toMatch(/bg-gray-300/);
    expect(dots2[1].className).toMatch(/bg-blue-600/);
    expect(dots2[2].className).toMatch(/bg-gray-300/);
  });
});
