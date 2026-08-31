/**
 * The population engine must be perfectly reproducible (same seed → same
 * numbers on every device and on the server), keep its illustrative rates
 * inside the documented bands, and run the REAL registered red-flag rules —
 * an exception can only exist with a registry rule id or an explicit
 * no-data/adherence reason.
 */

import { describe, expect, it } from 'vitest';
import {
  clearPopulationCachesForTests,
  generatePopulation,
  getPopulationDayEvents,
  POPULATION_SIZES,
  simulatePopulationDay,
} from '@/lib/sandbox/population';
import { RED_FLAG_CRITERIA } from '@/lib/vitals/constants';

const KNOWN_RULE_IDS = new Set(Object.values(RED_FLAG_CRITERIA).map((criteria) => criteria.id));

describe('determinism', () => {
  it('reproduces identical results after a full cache clear', () => {
    clearPopulationCachesForTests();
    const first = simulatePopulationDay(2500, 1);
    clearPopulationCachesForTests();
    const second = simulatePopulationDay(2500, 1);
    expect(second.counts).toEqual(first.counts);
    expect(second.exceptions).toEqual(first.exceptions);
    expect(second.distribution).toEqual(first.distribution);
  });

  it('generates the 500 cohort as an exact prefix of the 5000 cohort', () => {
    clearPopulationCachesForTests();
    const small = generatePopulation(500).map((patient) => patient.name);
    clearPopulationCachesForTests();
    const large = generatePopulation(5000);
    expect(large.slice(0, 500).map((patient) => patient.name)).toEqual(small);
  });

  it('changes the numbers between simulation days', () => {
    const day0 = simulatePopulationDay(2500, 0);
    const day1 = simulatePopulationDay(2500, 1);
    expect(day1.counts).not.toEqual(day0.counts);
  });
});

describe('cohort composition stays inside the documented bands', () => {
  it.each(POPULATION_SIZES.map((size) => [size] as const))('size %i', (size) => {
    const { distribution, counts } = simulatePopulationDay(size, 0);
    const { low, moderate, high } = distribution.tiers;
    expect(low + moderate + high).toBe(size);
    expect(low / size).toBeGreaterThanOrEqual(0.27);
    expect(low / size).toBeLessThanOrEqual(0.4);
    expect(moderate / size).toBeGreaterThanOrEqual(0.38);
    expect(moderate / size).toBeLessThanOrEqual(0.52);
    expect(high / size).toBeGreaterThanOrEqual(0.18);
    expect(high / size).toBeLessThanOrEqual(0.3);
    expect(moderate).toBeGreaterThan(low);
    expect(low).toBeGreaterThan(high);

    const { trackA, hybrid, trackB } = distribution.tracks;
    expect(trackA + hybrid + trackB).toBe(size);
    expect(counts.total).toBe(size);
  });
});

describe('daily funnel', () => {
  it('adds up exactly and keeps the review queue in the illustrative band', () => {
    for (const size of POPULATION_SIZES) {
      for (let day = 0; day < 5; day += 1) {
        const { counts } = simulatePopulationDay(size, day);
        const sum = counts.routine + counts.retriedResolved + counts.unresolvedNoAnswer
          + counts.critical + counts.warning + counts.adherenceLapse;
        expect(sum).toBe(counts.total);
        expect(counts.responded).toBe(counts.routine + counts.retriedResolved
          + counts.critical + counts.warning + counts.adherenceLapse);
        const reviewRate = counts.reviewQueue / counts.total;
        expect(reviewRate).toBeGreaterThan(0.004);
        expect(reviewRate).toBeLessThan(0.035);
        expect(counts.automatedPct).toBeCloseTo(
          Math.round(((counts.total - counts.reviewQueue) / counts.total) * 1000) / 10, 5);
      }
    }
  });

  it('review queue only holds rule-flagged, adherence, or high-risk-unreachable patients', () => {
    const { exceptions } = simulatePopulationDay(5000, 2);
    expect(exceptions.length).toBeGreaterThan(5);
    for (const exception of exceptions) {
      if (exception.category === 'critical' || exception.category === 'warning') {
        expect(exception.ruleIds.length).toBeGreaterThan(0);
        for (const ruleId of exception.ruleIds) expect(KNOWN_RULE_IDS.has(ruleId)).toBe(true);
        expect(exception.reason).toContain('rule ');
      }
      if (exception.category === 'no_answer') {
        expect(exception.riskTier).toBe('High');
      }
    }
    // Severity-ordered: no warning before a critical.
    const firstWarning = exceptions.findIndex((exception) => exception.category === 'warning');
    const lastCritical = exceptions.map((exception) => exception.category).lastIndexOf('critical');
    if (firstWarning >= 0 && lastCritical >= 0) expect(lastCritical).toBeLessThan(firstWarning);
  });
});

describe('replay event stream', () => {
  it('is deterministic, minute-ordered, and inside the overnight window', () => {
    clearPopulationCachesForTests();
    const first = getPopulationDayEvents(500, 1);
    clearPopulationCachesForTests();
    const second = getPopulationDayEvents(500, 1);
    expect(second).toEqual(first);
    for (let index = 1; index < first.length; index += 1) {
      expect(first[index].minute).toBeGreaterThanOrEqual(first[index - 1].minute);
    }
    for (const event of first) {
      expect(event.minute).toBeGreaterThanOrEqual(330);
      expect(event.minute).toBeLessThanOrEqual(450);
      expect(event.detail.length).toBeGreaterThan(0);
    }
  });

  it('sums per category to exactly the aggregate counts', () => {
    const events = getPopulationDayEvents(2500, 0);
    const { counts } = simulatePopulationDay(2500, 0);
    const byCategory = new Map<string, number>();
    for (const event of events) byCategory.set(event.category, (byCategory.get(event.category) ?? 0) + 1);
    expect(events).toHaveLength(counts.total);
    expect(byCategory.get('routine') ?? 0).toBe(counts.routine);
    expect(byCategory.get('retry') ?? 0).toBe(counts.retriedResolved);
    expect(byCategory.get('no_answer') ?? 0).toBe(counts.unresolvedNoAnswer);
    expect(byCategory.get('critical') ?? 0).toBe(counts.critical);
    expect(byCategory.get('warning') ?? 0).toBe(counts.warning);
    expect(byCategory.get('adherence') ?? 0).toBe(counts.adherenceLapse);
  });

  it('attaches values and weight history only to flagged or high-risk-unreachable events', () => {
    const events = getPopulationDayEvents(2500, 0);
    const flagged = events.filter((event) => event.category === 'critical' || event.category === 'warning');
    expect(flagged.length).toBeGreaterThan(0);
    for (const event of flagged) {
      expect(event.values).toBeDefined();
      expect(event.weightHistory).toHaveLength(7);
      expect(event.ruleIds!.length).toBeGreaterThan(0);
      expect(event.detail).toContain('rule ');
    }
    for (const event of events.filter((entry) => entry.category === 'routine').slice(0, 50)) {
      expect(event.values).toBeUndefined();
      expect(event.weightHistory).toBeUndefined();
    }
  });
});

describe('performance', () => {
  it('simulates 5000 patients from cold caches well under the budget', () => {
    clearPopulationCachesForTests();
    const startedAt = performance.now();
    simulatePopulationDay(5000, 3);
    expect(performance.now() - startedAt).toBeLessThan(500);
  });
});
