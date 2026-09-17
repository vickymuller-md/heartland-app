/**
 * Alert accountability join -- migration 00041
 *
 * The alert surfaces report the accountable provider and whether a documented
 * outcome is still required on the derived work item (design O4 §5.3).
 */

import { describe, it, expect } from 'vitest';
import { joinAlertAccountability } from '@/lib/dashboard/queries';

// ---------- joinAlertAccountability ----------

describe('joinAlertAccountability (00041)', () => {
  it('reports the accountable provider when the item names one', () => {
    const result = joinAlertAccountability([
      {
        source_id: 'alert-1',
        assigned_to: 'provider-9',
        status: 'new',
        accountability_source: 'designated',
        underlying_alert_resolved_at: null,
        assignee: { full_name: 'Dana Reyes, NP' },
      },
    ]);

    expect(result.get('alert-1')).toEqual({
      accountable_provider_id: 'provider-9',
      accountable_provider_name: 'Dana Reyes, NP',
      outcome_required: false,
    });
  });

  it('reports no accountable provider for a legacy item without accountability_source', () => {
    const result = joinAlertAccountability([
      {
        source_id: 'alert-2',
        assigned_to: 'provider-9',
        status: 'new',
        accountability_source: null,
        underlying_alert_resolved_at: null,
        assignee: { full_name: 'Dana Reyes, NP' },
      },
    ]);

    expect(result.get('alert-2')?.accountable_provider_id).toBeNull();
    expect(result.get('alert-2')?.accountable_provider_name).toBeNull();
  });

  it('marks an outcome as required when the alert is resolved and the item is open', () => {
    const result = joinAlertAccountability([
      {
        source_id: 'alert-3',
        assigned_to: 'provider-9',
        status: 'actioned',
        accountability_source: 'designated',
        underlying_alert_resolved_at: '2026-09-17T12:00:00Z',
        assignee: { full_name: 'Dana Reyes, NP' },
      },
    ]);

    expect(result.get('alert-3')?.outcome_required).toBe(true);
  });

  it('does not require an outcome once the item is closed', () => {
    const result = joinAlertAccountability([
      {
        source_id: 'alert-4',
        assigned_to: 'provider-9',
        status: 'closed',
        accountability_source: 'designated',
        underlying_alert_resolved_at: '2026-09-17T12:00:00Z',
        assignee: { full_name: 'Dana Reyes, NP' },
      },
    ]);

    expect(result.get('alert-4')?.outcome_required).toBe(false);
  });
});
