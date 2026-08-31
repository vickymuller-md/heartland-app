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

describe('performance', () => {
  it('simulates 5000 patients from cold caches well under the budget', () => {
    clearPopulationCachesForTests();
    const startedAt = performance.now();
    simulatePopulationDay(5000, 3);
    expect(performance.now() - startedAt).toBeLessThan(500);
  });
});
