/**
 * CKM Badge Component Tests -- CKM-01
 * Requirements: CKM-01 (CKM Stage displayed on patient profile)
 * Source: reference/clinical_content.md 1.1 -- AHA 2023 CKM Staging
 *
 * Tests CkmBadge renders correct label and color for each stage 0-4.
 */

import { CkmBadge } from '@/app/(provider)/patients/[patientId]/_components/ckm-badge';

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock the Server Action module
vi.mock('@/lib/actions/ckm-actions', () => ({
  updateCkmStage: vi.fn(),
}));

describe('CKM-01 CkmBadge', () => {
  it('Renders "Stage 0 — No CKM Factors" with gray styling when stage=0', () => {
    render(<CkmBadge stage={0} patientId="test-id" />);
    const badge = screen.getByText(/Stage 0/);
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toContain('No CKM Factors');
    expect(badge.className).toContain('bg-gray-100');
  });

  it('Renders "Stage 1 — Excess Adiposity" with blue styling when stage=1', () => {
    render(<CkmBadge stage={1} patientId="test-id" />);
    const badge = screen.getByText(/Stage 1/);
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toContain('Excess Adiposity');
    expect(badge.className).toContain('bg-blue-100');
  });

  it('Renders "Stage 2 — Metabolic Risk" with amber styling when stage=2', () => {
    render(<CkmBadge stage={2} patientId="test-id" />);
    const badge = screen.getByText(/Stage 2/);
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toContain('Metabolic Risk');
    expect(badge.className).toContain('bg-amber-100');
  });

  it('Renders "Stage 3 — Subclinical CVD" with orange styling when stage=3', () => {
    render(<CkmBadge stage={3} patientId="test-id" />);
    const badge = screen.getByText(/Stage 3/);
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toContain('Subclinical CVD');
    expect(badge.className).toContain('bg-orange-100');
  });

  it('Renders "Stage 4 — Clinical CVD/HF" with red styling when stage=4', () => {
    render(<CkmBadge stage={4} patientId="test-id" />);
    const badge = screen.getByText(/Stage 4/);
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toContain('Clinical CVD/HF');
    expect(badge.className).toContain('bg-red-100');
  });

  it('Renders dash when stage is null', () => {
    render(<CkmBadge stage={null} patientId="test-id" />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
