/**
 * MetricCard Component Tests -- CKM-03
 * Requirements: CKM-03 (Metrics shown per-facility with Tier 1/2/3 targets)
 * Source: HEARTLAND Protocol v3.3 Module 8 Quality Metrics
 *
 * Tests MetricCard displays correct tier-specific target strings
 * and status badges (met/approaching/below).
 */

import { MetricCard } from '@/app/(provider)/quality-metrics/_components/metric-card';
import { METRIC_DEFINITIONS } from '@/lib/quality-metrics/constants';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock MetricTrendChart to avoid Recharts rendering in jsdom
vi.mock('@/app/(provider)/quality-metrics/_components/metric-trend-chart', () => ({
  MetricTrendChart: () => <div data-testid="mock-trend-chart" />,
}));

// Mock upsertQualityMetricRecord server action
vi.mock('@/lib/quality-metrics/actions', () => ({
  upsertQualityMetricRecord: vi.fn(),
}));

const contactMetric = METRIC_DEFINITIONS[0]; // contact_48_72h
const readmissionMetric = METRIC_DEFINITIONS[3]; // readmission_30day

describe('CKM-03 MetricCard tier targets', () => {
  it('Shows tier 1 target string (">70%") for Tier 1 provider with contact_48_72h metric', () => {
    render(
      <MetricCard
        definition={contactMetric}
        latestRecord={null}
        history={[]}
        facilityTier={1}
      />,
    );
    expect(screen.getByText(/>\s*70%/)).toBeDefined();
  });

  it('Shows tier 2/3 target string (">90%") for Tier 2 provider with contact_48_72h metric', () => {
    render(
      <MetricCard
        definition={contactMetric}
        latestRecord={null}
        history={[]}
        facilityTier={2}
      />,
    );
    expect(screen.getByText(/>\s*90%/)).toBeDefined();
  });

  it('Shows "Target: Improvement from baseline" for 30-day readmission metric (Tier 1 special case)', () => {
    render(
      <MetricCard
        definition={readmissionMetric}
        latestRecord={null}
        history={[]}
        facilityTier={1}
      />,
    );
    expect(screen.getByText(/Improvement from baseline/)).toBeDefined();
  });

  it('Shows dash when rate_pct is null', () => {
    render(
      <MetricCard
        definition={contactMetric}
        latestRecord={null}
        history={[]}
        facilityTier={1}
      />,
    );
    const dashEl = screen.getByText('\u2014');
    expect(dashEl).toBeDefined();
  });
});

describe('CKM-03 MetricCard status badges', () => {
  const makeRecord = (numerator: number, denominator: number) => ({
    id: 'rec-1',
    provider_id: 'p-1',
    metric_key: 'contact_48_72h' as const,
    period_month: '2026-03-01',
    numerator,
    denominator,
    rate_pct: (numerator / denominator) * 100,
    notes: null,
    created_at: '2026-03-27T00:00:00Z',
  });

  it('Shows green badge when status is "met"', () => {
    // 80% rate vs 70% target (Tier 1) -> met
    render(
      <MetricCard
        definition={contactMetric}
        latestRecord={makeRecord(80, 100)}
        history={[]}
        facilityTier={1}
      />,
    );
    expect(screen.getByText('Met')).toBeDefined();
  });

  it('Shows amber badge when status is "approaching"', () => {
    // 65% rate vs 70% target (Tier 1) -> approaching (63 <= 65 < 70)
    render(
      <MetricCard
        definition={contactMetric}
        latestRecord={makeRecord(65, 100)}
        history={[]}
        facilityTier={1}
      />,
    );
    expect(screen.getByText('Approaching')).toBeDefined();
  });

  it('Shows red badge when status is "below"', () => {
    // 50% rate vs 70% target (Tier 1) -> below
    render(
      <MetricCard
        definition={contactMetric}
        latestRecord={makeRecord(50, 100)}
        history={[]}
        facilityTier={1}
      />,
    );
    expect(screen.getByText('Below Target')).toBeDefined();
  });
});
