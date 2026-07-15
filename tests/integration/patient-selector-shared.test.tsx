// INTG-06: PatientSelector extracted to components/shared/ and used by all tools
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';

// Mock next/image
vi.mock('next/image', () => ({ default: (props: Record<string, unknown>) => null }));

// Mock supabase client
vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'p1' } } }) },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      data: [],
    })),
  })),
}));

describe('PatientSelector shared component (INTG-06)', () => {
  it('can be imported from @/components/shared/patient-selector', async () => {
    // This import will fail until the file exists at the shared location
    const mod = await import('@/components/shared/patient-selector');
    expect(mod.PatientSelector).toBeDefined();
  });

  it('renders search input when no patient is selected', async () => {
    const { PatientSelector } = await import('@/components/shared/patient-selector');
    const onSelect = vi.fn();
    const onClear = vi.fn();
    render(<PatientSelector onSelect={onSelect} selectedPatient={null} onClear={onClear} />);
    // Should have a text input for search
    const input = screen.getByPlaceholderText(/loading patients|link to patient/i);
    expect(input).toBeDefined();
  });

  it('renders selected patient name when selectedPatient is provided', async () => {
    const { PatientSelector } = await import('@/components/shared/patient-selector');
    const onSelect = vi.fn();
    const onClear = vi.fn();
    const patient = { id: '123', full_name: 'John Doe', email: null, phone: null, patient_code: 'PT001', risk_tier: 'low' };
    render(<PatientSelector onSelect={onSelect} selectedPatient={patient} onClear={onClear} />);
    expect(screen.getByText('John Doe')).toBeDefined();
  });

  it('re-exports correctly from titration-checklist patient-selector (backward compat)', async () => {
    const shared = await import('@/components/shared/patient-selector');
    const reExport = await import('@/app/(public)/titration-checklist/patient-selector');
    // Both should export PatientSelector
    expect(reExport.PatientSelector).toBe(shared.PatientSelector);
  });
});
