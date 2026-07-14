import { describe, expect, it } from 'vitest';
import { groupDailyLoopItems } from '@/lib/daily-loop/queries';
import type { WorkItem } from '@/lib/daily-loop/types';

const NOW = new Date('2026-07-14T12:00:00.000Z');

function item(overrides: Partial<WorkItem>): WorkItem {
  return {
    id: crypto.randomUUID(),
    patient_id: crypto.randomUUID(),
    patient_name: 'Patient',
    provider_id: crypto.randomUUID(),
    assigned_to: crypto.randomUUID(),
    owner_name: 'Provider',
    source_type: 'manual',
    source_id: null,
    title: 'Follow up',
    reason: 'Needs review',
    change_summary: null,
    priority: 'watching',
    severity: 'informational',
    status: 'new',
    due_at: null,
    freshness_at: NOW.toISOString(),
    data_quality: 'verified',
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    ...overrides,
  };
}

describe('Daily Loop grouping', () => {
  it('promotes overdue and due-state work to Now', () => {
    const overdue = item({ due_at: '2026-07-14T11:59:00.000Z' });
    const returned = item({ status: 'due', priority: 'watching' });
    const grouped = groupDailyLoopItems([overdue, returned], NOW);

    expect(grouped.now.map((entry) => entry.id)).toEqual([overdue.id, returned.id]);
  });

  it('uses Today, This week, and Watching as mutually exclusive sections', () => {
    const today = item({ priority: 'today' });
    const week = item({ due_at: '2026-07-18T12:00:00.000Z' });
    const watching = item({});
    const grouped = groupDailyLoopItems([today, week, watching], NOW);

    expect(grouped.today).toEqual([today]);
    expect(grouped.week).toEqual([week]);
    expect(grouped.watching).toEqual([watching]);
  });

  it('sorts critical work before warning and informational work', () => {
    const info = item({ severity: 'informational' });
    const warning = item({ severity: 'warning' });
    const critical = item({ severity: 'critical' });
    const grouped = groupDailyLoopItems([info, warning, critical], NOW);

    expect(grouped.watching.map((entry) => entry.severity)).toEqual([
      'critical',
      'warning',
      'informational',
    ]);
  });
});
