/**
 * Frozen numbers from the v1.6.0 population engine (captured before the
 * evaluatePatientDay refactor). Any PRNG draw that moves — a reordered rng()
 * call, a draw made conditional, a stream reused — changes these numbers and
 * fails here. Regenerate ONLY for a deliberate, clinically-reviewed rate
 * change, never to make a refactor pass.
 */

import { describe, expect, it } from 'vitest';
import { clearPopulationCachesForTests, simulatePopulationDay } from '@/lib/sandbox/population';

const FROZEN: Record<string, {
  counts: Record<string, number>;
  distribution: { tiers: Record<string, number>; tracks: Record<string, number> };
  firstException: string | null;
  exceptionCount: number;
}> = {
  '500:0': { counts: { total: 500, responded: 487, routine: 426, retriedResolved: 51, unresolvedNoAnswer: 13, critical: 5, warning: 2, adherenceLapse: 3, reviewQueue: 15, automatedPct: 97 }, distribution: { tiers: { low: 155, moderate: 222, high: 123 }, tracks: { trackA: 102, hybrid: 122, trackB: 276 } }, firstException: 'Floyd Whitfield', exceptionCount: 15 },
  '500:1': { counts: { total: 500, responded: 495, routine: 430, retriedResolved: 61, unresolvedNoAnswer: 5, critical: 1, warning: 0, adherenceLapse: 3, reviewQueue: 3, automatedPct: 99.4 }, distribution: { tiers: { low: 155, moderate: 222, high: 123 }, tracks: { trackA: 102, hybrid: 122, trackB: 276 } }, firstException: 'Orville Bowles', exceptionCount: 3 },
  '500:2': { counts: { total: 500, responded: 492, routine: 428, retriedResolved: 49, unresolvedNoAnswer: 8, critical: 10, warning: 0, adherenceLapse: 5, reviewQueue: 13, automatedPct: 97.4 }, distribution: { tiers: { low: 155, moderate: 222, high: 123 }, tracks: { trackA: 102, hybrid: 122, trackB: 276 } }, firstException: 'Homer Pruitt', exceptionCount: 13 },
  '500:3': { counts: { total: 500, responded: 487, routine: 425, retriedResolved: 58, unresolvedNoAnswer: 13, critical: 1, warning: 0, adherenceLapse: 3, reviewQueue: 7, automatedPct: 98.6 }, distribution: { tiers: { low: 155, moderate: 222, high: 123 }, tracks: { trackA: 102, hybrid: 122, trackB: 276 } }, firstException: 'Yolanda Delgado', exceptionCount: 7 },
  '500:4': { counts: { total: 500, responded: 486, routine: 419, retriedResolved: 56, unresolvedNoAnswer: 14, critical: 5, warning: 2, adherenceLapse: 4, reviewQueue: 11, automatedPct: 97.8 }, distribution: { tiers: { low: 155, moderate: 222, high: 123 }, tracks: { trackA: 102, hybrid: 122, trackB: 276 } }, firstException: 'Pearl Tillman', exceptionCount: 11 },
  '2500:0': { counts: { total: 2500, responded: 2440, routine: 2113, retriedResolved: 277, unresolvedNoAnswer: 60, critical: 21, warning: 7, adherenceLapse: 22, reviewQueue: 47, automatedPct: 98.1 }, distribution: { tiers: { low: 763, moderate: 1160, high: 577 }, tracks: { trackA: 555, hybrid: 578, trackB: 1367 } }, firstException: 'Floyd Whitfield', exceptionCount: 30 },
  '2500:1': { counts: { total: 2500, responded: 2436, routine: 2123, retriedResolved: 281, unresolvedNoAnswer: 64, critical: 8, warning: 5, adherenceLapse: 19, reviewQueue: 33, automatedPct: 98.7 }, distribution: { tiers: { low: 763, moderate: 1160, high: 577 }, tracks: { trackA: 555, hybrid: 578, trackB: 1367 } }, firstException: 'Orville Bowles', exceptionCount: 30 },
  '2500:2': { counts: { total: 2500, responded: 2431, routine: 2113, retriedResolved: 269, unresolvedNoAnswer: 69, critical: 22, warning: 4, adherenceLapse: 23, reviewQueue: 46, automatedPct: 98.2 }, distribution: { tiers: { low: 763, moderate: 1160, high: 577 }, tracks: { trackA: 555, hybrid: 578, trackB: 1367 } }, firstException: 'Homer Pruitt', exceptionCount: 30 },
  '2500:3': { counts: { total: 2500, responded: 2409, routine: 2099, retriedResolved: 284, unresolvedNoAnswer: 91, critical: 6, warning: 5, adherenceLapse: 15, reviewQueue: 33, automatedPct: 98.7 }, distribution: { tiers: { low: 763, moderate: 1160, high: 577 }, tracks: { trackA: 555, hybrid: 578, trackB: 1367 } }, firstException: 'Yolanda Delgado', exceptionCount: 30 },
  '2500:4': { counts: { total: 2500, responded: 2437, routine: 2108, retriedResolved: 281, unresolvedNoAnswer: 63, critical: 23, warning: 8, adherenceLapse: 17, reviewQueue: 46, automatedPct: 98.2 }, distribution: { tiers: { low: 763, moderate: 1160, high: 577 }, tracks: { trackA: 555, hybrid: 578, trackB: 1367 } }, firstException: 'Pearl Tillman', exceptionCount: 30 },
  '5000:0': { counts: { total: 5000, responded: 4866, routine: 4234, retriedResolved: 546, unresolvedNoAnswer: 134, critical: 36, warning: 10, adherenceLapse: 40, reviewQueue: 92, automatedPct: 98.2 }, distribution: { tiers: { low: 1500, moderate: 2344, high: 1156 }, tracks: { trackA: 1119, hybrid: 1161, trackB: 2720 } }, firstException: 'Floyd Whitfield', exceptionCount: 30 },
  '5000:1': { counts: { total: 5000, responded: 4874, routine: 4228, retriedResolved: 571, unresolvedNoAnswer: 126, critical: 27, warning: 14, adherenceLapse: 34, reviewQueue: 74, automatedPct: 98.5 }, distribution: { tiers: { low: 1500, moderate: 2344, high: 1156 }, tracks: { trackA: 1119, hybrid: 1161, trackB: 2720 } }, firstException: 'Orville Bowles', exceptionCount: 30 },
  '5000:2': { counts: { total: 5000, responded: 4849, routine: 4186, retriedResolved: 568, unresolvedNoAnswer: 151, critical: 44, warning: 8, adherenceLapse: 43, reviewQueue: 95, automatedPct: 98.1 }, distribution: { tiers: { low: 1500, moderate: 2344, high: 1156 }, tracks: { trackA: 1119, hybrid: 1161, trackB: 2720 } }, firstException: 'Homer Pruitt', exceptionCount: 30 },
  '5000:3': { counts: { total: 5000, responded: 4833, routine: 4219, retriedResolved: 542, unresolvedNoAnswer: 167, critical: 31, warning: 13, adherenceLapse: 28, reviewQueue: 89, automatedPct: 98.2 }, distribution: { tiers: { low: 1500, moderate: 2344, high: 1156 }, tracks: { trackA: 1119, hybrid: 1161, trackB: 2720 } }, firstException: 'Yolanda Delgado', exceptionCount: 30 },
  '5000:4': { counts: { total: 5000, responded: 4860, routine: 4181, retriedResolved: 586, unresolvedNoAnswer: 140, critical: 47, warning: 16, adherenceLapse: 30, reviewQueue: 101, automatedPct: 98 }, distribution: { tiers: { low: 1500, moderate: 2344, high: 1156 }, tracks: { trackA: 1119, hybrid: 1161, trackB: 2720 } }, firstException: 'Pearl Tillman', exceptionCount: 30 },
};

describe('population engine regression freeze', () => {
  it('reproduces every frozen (size, day) result exactly', () => {
    clearPopulationCachesForTests();
    for (const [key, expected] of Object.entries(FROZEN)) {
      const [size, day] = key.split(':').map(Number);
      const result = simulatePopulationDay(size as 500 | 2500 | 5000, day);
      expect({ key, value: result.counts }).toEqual({ key, value: expected.counts });
      expect({ key, value: result.distribution }).toEqual({ key, value: expected.distribution });
      expect({ key, value: result.exceptions[0]?.name ?? null }).toEqual({ key, value: expected.firstException });
      expect({ key, value: result.exceptions.length }).toEqual({ key, value: expected.exceptionCount });
    }
  });
});
