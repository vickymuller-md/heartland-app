/**
 * Proactive Alert Detection Functions -- Tests
 * Requirements: ALRT-01 through ALRT-06
 * Source: HEARTLAND Protocol v3.3 -- Phase 14 Intelligent Alerts Engine
 *
 * Tests for time-based detection functions that extend the existing
 * red flag alert engine with proactive monitoring capabilities.
 *
 * INTEGRATION tests (ALRT-07 mute/unmute) require Supabase -- marked it.todo()
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  evaluateNoCheckin,
  evaluateLowAdherence,
  evaluateWeightTrend7d,
  evaluateCriticalLabs,
  evaluateFollowupDue,
  evaluateFollowupOverdue,
  classifyProactiveSeverity,
} from '@/lib/dashboard/alert-engine';
import { SEVERITY_COLORS } from '@/lib/dashboard/constants';
import type { AdherenceDay } from '@/lib/medications/types';

// Mock server-only to prevent import error
vi.mock('server-only', () => ({}));

// Mock Supabase server client for muteAlertType tests
const mockUpsert = vi.fn().mockResolvedValue({ error: null });
const mockGetUser = vi.fn().mockResolvedValue({
  data: { user: { id: 'provider-1' } },
});

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: () => ({ upsert: mockUpsert }),
  }),
}));

// Mock admin client (top-level createClient call)
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {},
}));

// Mock next/cache to prevent server-only errors
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

// Mock next/headers for cookies()
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    getAll: () => [],
    set: vi.fn(),
  }),
}));

// Import muteAlertType AFTER mocks are set up
const { muteAlertType } = await import('@/lib/dashboard/actions');

// ==========================================================================
// evaluateNoCheckin (ALRT-01)
// ==========================================================================
describe('evaluateNoCheckin (ALRT-01)', () => {
  const now = new Date('2026-03-26T12:00:00Z');

  it('returns true when lastVitalsAt is null and patient created > 3 days ago', () => {
    // Patient created 5 days ago, never logged vitals
    const result = evaluateNoCheckin(null, '2026-03-21T12:00:00Z', 3, now);
    expect(result).toBe(true);
  });

  it('returns true when last vitals > 3 days ago', () => {
    // Last vitals 4 days ago
    const result = evaluateNoCheckin('2026-03-22T12:00:00Z', '2026-03-01T00:00:00Z', 3, now);
    expect(result).toBe(true);
  });

  it('returns false when last vitals within 3 days', () => {
    // Last vitals 2 days ago
    const result = evaluateNoCheckin('2026-03-24T12:00:00Z', '2026-03-01T00:00:00Z', 3, now);
    expect(result).toBe(false);
  });

  it('boundary: exactly 3 days does NOT trigger (strictly greater than)', () => {
    // Exactly 3 days = 3 * 86400000 ms
    const exactlyThreeDaysAgo = new Date(now.getTime() - 3 * 86_400_000).toISOString();
    const result = evaluateNoCheckin(exactlyThreeDaysAgo, '2026-03-01T00:00:00Z', 3, now);
    expect(result).toBe(false);
  });

  it('grace period: patient created < 3 days ago with null vitals is not flagged', () => {
    // Patient created 2 days ago, never logged vitals -- give them time
    const result = evaluateNoCheckin(null, '2026-03-24T12:00:00Z', 3, now);
    expect(result).toBe(false);
  });
});

// ==========================================================================
// evaluateLowAdherence (ALRT-02)
// ==========================================================================
describe('evaluateLowAdherence (ALRT-02)', () => {
  it('returns true when adherence rate < 70% (3/10 complete = 30%)', () => {
    const days: AdherenceDay[] = Array.from({ length: 10 }, (_, i) => ({
      date: `2026-03-${String(17 + i).padStart(2, '0')}`,
      totalDoses: 2,
      takenDoses: i < 3 ? 2 : 0,
      status: (i < 3 ? 'complete' : 'missed') as AdherenceDay['status'],
    }));
    expect(evaluateLowAdherence(days, 70)).toBe(true);
  });

  it('returns false when adherence rate >= 70% (8/10 complete = 80%)', () => {
    const days: AdherenceDay[] = Array.from({ length: 10 }, (_, i) => ({
      date: `2026-03-${String(17 + i).padStart(2, '0')}`,
      totalDoses: 2,
      takenDoses: i < 8 ? 2 : 0,
      status: (i < 8 ? 'complete' : 'missed') as AdherenceDay['status'],
    }));
    expect(evaluateLowAdherence(days, 70)).toBe(false);
  });

  it('returns false when all days are no_meds or future (no actionable days)', () => {
    const days: AdherenceDay[] = [
      { date: '2026-03-25', totalDoses: 0, takenDoses: 0, status: 'no_meds' },
      { date: '2026-03-26', totalDoses: 0, takenDoses: 0, status: 'no_meds' },
      { date: '2026-03-27', totalDoses: 0, takenDoses: 0, status: 'future' },
    ];
    expect(evaluateLowAdherence(days, 70)).toBe(false);
  });

  it('returns false when empty array', () => {
    expect(evaluateLowAdherence([], 70)).toBe(false);
  });
});

// ==========================================================================
// evaluateWeightTrend7d (ALRT-03)
// ==========================================================================
describe('evaluateWeightTrend7d (ALRT-03)', () => {
  it('returns true when gain > 2 lbs (150 -> 152.5)', () => {
    const vitals = [
      { weight_lbs: 150, recorded_at: '2026-03-20T10:00:00Z' },
      { weight_lbs: 152.5, recorded_at: '2026-03-26T10:00:00Z' },
    ];
    expect(evaluateWeightTrend7d(vitals, 2)).toBe(true);
  });

  it('returns false when gain exactly 2.0 lbs (threshold is strictly greater than)', () => {
    const vitals = [
      { weight_lbs: 150, recorded_at: '2026-03-20T10:00:00Z' },
      { weight_lbs: 152, recorded_at: '2026-03-26T10:00:00Z' },
    ];
    expect(evaluateWeightTrend7d(vitals, 2)).toBe(false);
  });

  it('returns false when single entry (fewer than 2 data points)', () => {
    const vitals = [
      { weight_lbs: 150, recorded_at: '2026-03-26T10:00:00Z' },
    ];
    expect(evaluateWeightTrend7d(vitals, 2)).toBe(false);
  });

  it('sorts by date to get correct oldest/newest (not array order)', () => {
    // Array order: newest first, oldest second -- should still compute correctly
    const vitals = [
      { weight_lbs: 153, recorded_at: '2026-03-26T10:00:00Z' },
      { weight_lbs: 150, recorded_at: '2026-03-20T10:00:00Z' },
    ];
    expect(evaluateWeightTrend7d(vitals, 2)).toBe(true);
  });
});

// ==========================================================================
// evaluateCriticalLabs (ALRT-04)
// ==========================================================================
describe('evaluateCriticalLabs (ALRT-04)', () => {
  it('returns [hyperkalemia] when K+ > 5.5', () => {
    expect(evaluateCriticalLabs({ potassium: 5.8, egfr: 45 })).toEqual(['hyperkalemia']);
  });

  it('returns [low_egfr] when eGFR < 30', () => {
    expect(evaluateCriticalLabs({ potassium: 4.0, egfr: 28 })).toEqual(['low_egfr']);
  });

  it('returns both flags when both triggered', () => {
    const result = evaluateCriticalLabs({ potassium: 5.8, egfr: 28 });
    expect(result).toEqual(['hyperkalemia', 'low_egfr']);
  });

  it('returns [] when K+ exactly 5.5 and eGFR exactly 30 (boundaries not exceeded)', () => {
    expect(evaluateCriticalLabs({ potassium: 5.5, egfr: 30 })).toEqual([]);
  });

  it('returns [] when both values are null', () => {
    expect(evaluateCriticalLabs({ potassium: null, egfr: null })).toEqual([]);
  });
});

// ==========================================================================
// evaluateFollowupDue (ALRT-05)
// ==========================================================================
describe('evaluateFollowupDue (ALRT-05)', () => {
  const now = new Date('2026-03-26T12:00:00Z');

  it('returns true when scheduledAt is 12 hours from now and not completed', () => {
    const scheduledAt = new Date(now.getTime() + 12 * 3_600_000).toISOString();
    expect(evaluateFollowupDue(scheduledAt, false, 24, now)).toBe(true);
  });

  it('returns false when scheduledAt is 36 hours from now', () => {
    const scheduledAt = new Date(now.getTime() + 36 * 3_600_000).toISOString();
    expect(evaluateFollowupDue(scheduledAt, false, 24, now)).toBe(false);
  });

  it('returns false when scheduledAt is 12 hours from now but completed', () => {
    const scheduledAt = new Date(now.getTime() + 12 * 3_600_000).toISOString();
    expect(evaluateFollowupDue(scheduledAt, true, 24, now)).toBe(false);
  });
});

// ==========================================================================
// AlertSeverity informational & classifyProactiveSeverity (ALRT-06)
// ==========================================================================
describe('AlertSeverity informational (ALRT-06)', () => {
  it('SEVERITY_COLORS has informational key with blue Tailwind classes', () => {
    expect(SEVERITY_COLORS).toHaveProperty('informational');
    expect((SEVERITY_COLORS as Record<string, string>).informational).toBe(
      'text-blue-600 bg-blue-50 border-blue-200'
    );
  });

  it('no_checkin flag maps to informational severity', () => {
    expect(classifyProactiveSeverity('no_checkin')).toBe('informational');
  });

  it('hyperkalemia flag maps to critical severity', () => {
    expect(classifyProactiveSeverity('hyperkalemia')).toBe('critical');
  });

  it('weight_trend_7d flag maps to warning severity', () => {
    expect(classifyProactiveSeverity('weight_trend_7d')).toBe('warning');
  });
});

// ==========================================================================
// evaluateFollowupOverdue (SAFE-05)
// Detects follow-ups that are past their scheduled time
// ==========================================================================
describe('evaluateFollowupOverdue (SAFE-05)', () => {
  const now = new Date('2026-03-26T12:00:00Z');

  it('returns null when completed=true regardless of timing', () => {
    const scheduledAt = new Date(now.getTime() - 80 * 3_600_000).toISOString();
    expect(evaluateFollowupOverdue(scheduledAt, true, now)).toBeNull();
  });

  it('returns null when scheduledAt is 12h ago (not yet 24h overdue)', () => {
    const scheduledAt = new Date(now.getTime() - 12 * 3_600_000).toISOString();
    expect(evaluateFollowupOverdue(scheduledAt, false, now)).toBeNull();
  });

  it('returns warning severity when scheduledAt is 30h ago', () => {
    const scheduledAt = new Date(now.getTime() - 30 * 3_600_000).toISOString();
    const result = evaluateFollowupOverdue(scheduledAt, false, now);
    expect(result).not.toBeNull();
    expect(result!.overdue).toBe(true);
    expect(result!.severity).toBe('warning');
  });

  it('returns critical severity when scheduledAt is 80h ago', () => {
    const scheduledAt = new Date(now.getTime() - 80 * 3_600_000).toISOString();
    const result = evaluateFollowupOverdue(scheduledAt, false, now);
    expect(result).not.toBeNull();
    expect(result!.overdue).toBe(true);
    expect(result!.severity).toBe('critical');
  });

  it('returns null when scheduledAt is in the future', () => {
    const scheduledAt = new Date(now.getTime() + 12 * 3_600_000).toISOString();
    expect(evaluateFollowupOverdue(scheduledAt, false, now)).toBeNull();
  });
});

// ==========================================================================
// muteAlertType guard (SAFE-06)
// Server-side guard preventing muting of critical alert types
// ==========================================================================
describe('muteAlertType guard (SAFE-06)', () => {
  beforeEach(() => {
    mockUpsert.mockClear();
    mockGetUser.mockClear();
    mockGetUser.mockResolvedValue({ data: { user: { id: 'provider-1' } } });
    mockUpsert.mockResolvedValue({ error: null });
  });

  it('rejects sbp_low with error message', async () => {
    const result = await muteAlertType('patient-1', 'sbp_low');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/cannot be muted/i);
  });

  it('rejects spo2_low with error message', async () => {
    const result = await muteAlertType('patient-1', 'spo2_low');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/cannot be muted/i);
  });

  it('rejects hyperkalemia with error message', async () => {
    const result = await muteAlertType('patient-1', 'hyperkalemia');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/cannot be muted/i);
  });

  it('allows no_checkin (non-critical) through', async () => {
    const result = await muteAlertType('patient-1', 'no_checkin');
    expect(result.success).toBe(true);
  });

  it('allows low_adherence (non-critical) through', async () => {
    const result = await muteAlertType('patient-1', 'low_adherence');
    expect(result.success).toBe(true);
  });
});

// ==========================================================================
// muteAlertType server action (ALRT-07) -- INTEGRATION (requires Supabase)
// ==========================================================================
describe('muteAlertType server action (ALRT-07)', () => {
  it.todo('upserts muted=true row to alert_preferences table');
  it.todo('unmuteAlertType upserts muted=false');
});
