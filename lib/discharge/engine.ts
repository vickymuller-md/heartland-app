/**
 * Discharge Follow-Up Date Engine -- Pure Function
 * Phase 16: DSCH-03 (post-discharge contact scheduler)
 *
 * Computes the 5-row follow-up schedule from a discharge date and facility tier.
 * Source: HEARTLAND Protocol v3.3 Module 4, Section 4.4
 *
 * NO side effects, NO async, NO DOM -- safe for server or client.
 */

import { addDays, addHours, addWeeks } from 'date-fns';
import type { FollowupSchedule } from './types';

/**
 * Computes 5 follow-up schedule rows from discharge date and tier.
 *
 * Always returns 5 rows regardless of tier:
 *   1. call_48h: discharged_at + 48 hours
 *   2. visit_day7: discharged_at + 7 days
 *   3. call_week2: discharged_at + 14 days (2 weeks)
 *   4. call_week3: discharged_at + 21 days (3 weeks)
 *   5. call_week4: discharged_at + 28 days (4 weeks)
 *
 * Tier affects mode labels only (not row count):
 *   - Tier 1: weeks 2-4 tier1_mode = "As resources allow"
 *   - Tier 2/3: weeks 2-4 tier23_mode = "Structured protocol"
 *
 * Source: reference/clinical_content.md Section 4.4
 */
export function computeFollowupDates(
  dischargedAt: Date,
  tier: 1 | 2 | 3
): FollowupSchedule[] {
  const schedule: FollowupSchedule[] = [
    {
      type: 'call_48h',
      label: '48-72h Contact',
      due_at: addHours(dischargedAt, 48),
      purpose: 'Medication check, side effects, barriers',
      tier1_mode: 'Phone call',
      tier23_mode: 'Phone or video',
    },
    {
      type: 'visit_day7',
      label: 'Day 7 Visit',
      due_at: addDays(dischargedAt, 7),
      purpose: 'Vitals, GDMT tolerability, weight trend',
      tier1_mode: 'Phone acceptable',
      tier23_mode: 'In-person or video preferred',
    },
  ];

  // Weeks 2-4: always 3 rows, tier affects mode labels
  for (let week = 2; week <= 4; week++) {
    schedule.push({
      type: `call_week${week}` as FollowupSchedule['type'],
      label: `Week ${week} Call`,
      due_at: addWeeks(dischargedAt, week),
      purpose: 'Titration, adherence',
      tier1_mode: tier >= 2 ? 'Weekly calls (as resources allow)' : 'As resources allow',
      tier23_mode: 'Structured protocol',
    });
  }

  return schedule;
}
