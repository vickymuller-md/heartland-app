/**
 * Engine-backed copilot tools: every computed result must come from the
 * registered deterministic engines resolved for the request's simulation day,
 * missing-data days must never be filled with fabricated values, and tool
 * results must serialize inside the token cap without slicing JSON text.
 */

import { describe, expect, it } from 'vitest';
import {
  COPILOT_TOOLS,
  copilotRequestSchema,
  executeCopilotTool,
  serializeCopilotToolResult,
} from '@/lib/sandbox-ai/copilot';
import { RED_FLAG_CRITERIA } from '@/lib/vitals/constants';

const DAY0 = { workItems: [] };
const day = (dayIndex: number) => ({ workItems: [], dayIndex });

describe('tool definitions', () => {
  it('stays within the 12-tool cap with short descriptions', () => {
    expect(COPILOT_TOOLS.length).toBeLessThanOrEqual(12);
    for (const tool of COPILOT_TOOLS) {
      expect(tool.description.length).toBeLessThanOrEqual(220);
    }
  });
});

describe('triage_queue', () => {
  it('ranks the missing check-in first on day 1', () => {
    const { result } = executeCopilotTool('triage_queue', {}, DAY0);
    const items = (result as { items: Array<{ patientName: string; status: string }> }).items;
    expect(items[0]).toMatchObject({ patientName: 'Robert Lee', status: 'missing check-in' });
  });

  it('ranks the critical weight flag first on day 2', () => {
    const { result } = executeCopilotTool('triage_queue', {}, day(1));
    const items = (result as {
      items: Array<{ patientName: string; status: string; redFlags: Array<{ id: string }> }>;
    }).items;
    expect(items[0].patientName).toBe('Maria Santos');
    expect(items[0].status).toBe('critical red flag');
    expect(items[0].redFlags.map((flag) => flag.id)).toContain(RED_FLAG_CRITERIA.weight_gain_5lb_7d.id);
  });
});

describe('score_risk', () => {
  it('runs the risk engine over the documented factors', () => {
    const { result } = executeCopilotTool('score_risk', { patient: 'demo-maria' }, DAY0);
    expect(result).toMatchObject({ totalScore: 10, tier: 'High' });
    expect((result as { presentFactors: unknown[] }).presentFactors).toHaveLength(6);
  });

  it('rejects unknown personas', () => {
    const { result } = executeCopilotTool('score_risk', { patient: 'Earl Hutchins' }, DAY0);
    expect((result as { error: string }).error).toContain('Unknown tour patient');
  });
});

describe('evaluate_red_flags', () => {
  it('reports the missing check-in as the signal instead of fabricating values', () => {
    const { result } = executeCopilotTool('evaluate_red_flags', { patient: 'demo-robert' }, DAY0);
    expect(result).toMatchObject({ checkInReceived: false });
    expect((result as { note: string }).note).toContain('No check-in');
  });

  it('returns the triggered rule with the weight trend on Maria day 2', () => {
    const { result } = executeCopilotTool('evaluate_red_flags', { patient: 'demo-maria' }, day(1));
    const flags = (result as { flags: Array<{ id: string }> }).flags;
    expect(flags.map((flag) => flag.id)).toEqual([RED_FLAG_CRITERIA.weight_gain_5lb_7d.id]);
    expect((result as { recentWeightsLbs: unknown[] }).recentWeightsLbs.length).toBeGreaterThan(2);
  });
});

describe('evaluate_titration', () => {
  it('holds on borderline potassium for Maria day 3, MRA specifically', () => {
    const { result } = executeCopilotTool('evaluate_titration', { patient: 'demo-maria' }, day(2));
    const typed = result as {
      globalAction: { action: string };
      perDrugClass: Array<{ drugClass: string; action: string }>;
      labSource: string;
    };
    expect(typed.globalAction.action).toBe('hold');
    expect(typed.perDrugClass.find((entry) => entry.drugClass === 'MRA')?.action).toBe('hold');
    expect(typed.labSource).toBe('Lab source is current.');
  });

  it('declines to evaluate without a check-in and flags the stale lab source', () => {
    const { result } = executeCopilotTool('evaluate_titration', { patient: 'demo-robert' }, DAY0);
    expect((result as { note: string }).note).toContain('cannot be evaluated');
    expect((result as { labSource: string }).labSource).toContain('12 days old');
  });
});

describe('remaining engine tools', () => {
  it('assign_monitoring_track reproduces the analog assignment', () => {
    const { result } = executeCopilotTool('assign_monitoring_track', { patient: 'demo-robert' }, DAY0);
    expect(result).toMatchObject({ currentTrack: 'Analog Track B' });
    expect((result as { engineRecommendation: { track: string } }).engineRecommendation.track).toBe('track-b');
  });

  it('assess_facility_tier applies the floor-tier algorithm', () => {
    const { result } = executeCopilotTool('assess_facility_tier', { patient: 'demo-james' }, DAY0);
    expect(result).toMatchObject({ overallTier: 1 });
    expect((result as { limitingCategories: string[] }).limitingCategories.length).toBeGreaterThan(0);
  });

  it('followup_schedule places James at the Day 7 milestone and skips Maria', () => {
    const james = executeCopilotTool('followup_schedule', { patient: 'demo-james' }, DAY0);
    const schedule = (james.result as { schedule: Array<{ label: string; due: string }> }).schedule;
    expect(schedule).toHaveLength(5);
    expect(schedule.find((row) => row.label === 'Day 7 Visit')?.due).toBe('due today');
    const maria = executeCopilotTool('followup_schedule', { patient: 'demo-maria' }, DAY0);
    expect((maria.result as { note: string }).note).toContain('not in a post-discharge');
  });

  it('assess_comorbidity_stage surfaces the ICD gate for Maria', () => {
    const { result } = executeCopilotTool('assess_comorbidity_stage', { patient: 'demo-maria' }, DAY0);
    expect(result).toMatchObject({ ckmStage: 'Stage 4' });
    expect((result as { device: { result: string } }).device.result).toBe('icd_only');
  });
});

describe('serializeCopilotToolResult', () => {
  it('passes small results through untouched', () => {
    expect(serializeCopilotToolResult({ ok: true })).toBe('{"ok":true}');
  });

  it('caps arrays before stringifying and flags the truncation', () => {
    const big = { items: Array.from({ length: 40 }, (_, index) => ({ index, text: 'x'.repeat(80) })) };
    const serialized = serializeCopilotToolResult(big);
    expect(serialized.length).toBeLessThanOrEqual(1800);
    const parsed = JSON.parse(serialized) as { items: unknown[]; resultTruncated?: boolean };
    expect(parsed.resultTruncated).toBe(true);
    expect(parsed.items.length).toBeLessThanOrEqual(8);
  });
});

describe('request schema day plumbing', () => {
  it('accepts an in-range dayIndex and rejects out-of-range values', () => {
    const base = { question: 'Who first?', snapshot: { workItems: [] } };
    expect(copilotRequestSchema.safeParse({ ...base, dayIndex: 4 }).success).toBe(true);
    expect(copilotRequestSchema.safeParse(base).success).toBe(true);
    expect(copilotRequestSchema.safeParse({ ...base, dayIndex: 5 }).success).toBe(false);
    expect(copilotRequestSchema.safeParse({ ...base, dayIndex: -1 }).success).toBe(false);
    expect(copilotRequestSchema.safeParse({ ...base, dayIndex: 1.5 }).success).toBe(false);
  });
});
