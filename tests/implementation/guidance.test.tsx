import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ImplementationPrinciples, LocalReadinessGuide, ReferralContextGuide } from '@/components/implementation/implementation-guidance';
import { ReferralCriteriaForm } from '@/app/(provider)/comorbidity-manager/_components/referral-criteria-form';
import { BUNDLE_COMPONENTS, TASK_SHIFTING_ROWS } from '@/lib/discharge/constants';
import { computeFollowupDates } from '@/lib/discharge/engine';

afterEach(cleanup);

describe('operational clarification boundaries', () => {
  it('makes pharmacy and professional authority visible together', () => {
    render(<ImplementationPrinciples />);
    expect(screen.getByText(/Community, ambulatory or remote pharmacists/)).toBeVisible();
    expect(screen.getByText(/A job title, certificate or software permission alone/)).toBeVisible();
    expect(screen.getByText(/not a lower treatment goal/)).toBeVisible();
  });
  it('requires complete reconciliation in both delivery tiers', () => {
    const reconciliation = BUNDLE_COMPONENTS.find((row) => row.id === 'med_reconciliation')!;
    for (const text of [reconciliation.tier1, reconciliation.tier23]) {
      expect(text).toContain('Complete reconciliation, teach-back and access check');
      expect(text).toContain('pharmacist');
    }
  });
  it('distinguishes trained recognition from authorized disposition', () => {
    const row = TASK_SHIFTING_ROWS.find((row) => row.id === 'red_flag_triage')!;
    expect(row.optimal).toContain('Trained observer reports');
    expect(row.alternatives).toContain('disposition requires documented authority');
    expect(row.no_chw).toContain('confirm acceptance');
  });
  it('shows three referral contexts and retained ownership', () => {
    render(<ReferralContextGuide />);
    expect(screen.getAllByRole('heading', { level: 4 })).toHaveLength(3);
    expect(screen.getByText(/does not assess acute stability or exclude an emergency/)).toBeVisible();
    expect(screen.getByText(/current owner retains responsibility until an accepted transfer/)).toBeVisible();
  });
  it('keeps urgent-context warning visible before any form data or result', () => {
    render(<ReferralCriteriaForm />);
    expect(screen.getByText('Incomplete Data')).toBeVisible();
    expect(screen.getByText(/does not assess acute stability or exclude an emergency/)).toBeVisible();
  });
  it('provides an actual downloadable rehearsal pack without implying approval', () => {
    render(<LocalReadinessGuide />);
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByRole('link', { name: /12 synthetic scenarios/ })).toHaveAttribute('href', '/resources/heartland-local-readiness-training.md');
    expect(screen.getByText(/No worksheet or exercise authorizes clinical operation/)).toBeVisible();
    expect(screen.getByText(/respectfully, politely and gratefully/)).toBeVisible();
  });
  it('preserves all five calculated dates independently of resource tier', () => {
    const date = new Date('2026-01-01T12:00:00Z');
    const expected = [48, 168, 336, 504, 672].map((hours) => date.getTime() + hours * 3_600_000);
    for (const tier of [1, 2, 3] as const) {
      expect(computeFollowupDates(date, tier).map((row) => row.due_at.getTime())).toEqual(expected);
      expect(computeFollowupDates(date, tier).map((row) => row.tier1_mode).join(' ')).not.toContain('As resources allow');
    }
  });
});
