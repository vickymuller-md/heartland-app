/**
 * Copilot tool registry -- every tool the "Ask your queue" agent can call.
 *
 * Each entry pairs the SDK-facing definition with a zod args schema and a
 * read-only deterministic executor. Computing tools (risk, titration, red
 * flags, triage, track, tier, follow-up, comorbidity) run the SAME registered
 * engines the app's modules use, resolved for the current simulation day via
 * lib/sandbox/day-selectors — the model narrates results, it never decides.
 * dayIndex comes from the request context, never from a model-visible arg.
 */

import { z } from 'zod';
import { CLINICAL_RULE_REGISTRY } from '@/lib/clinical-governance/rule-registry';
import { classifyCkmStage } from '@/lib/ckm/engine';
import { evaluateDeviceCriteria, evaluateReferralCriteria } from '@/lib/comorbidity/engine';
import { computeFollowupDates } from '@/lib/discharge/engine';
import { assignTrack } from '@/lib/remote-monitoring/engine';
import { calculateRiskScore } from '@/lib/risk-score/engine';
import {
  activeDrugClassesFor,
  dayFor,
  dischargedAtFor,
  facilityAssessmentFor,
  formatCkmStageLabel,
  redFlagInputsForDay,
  titrationVitalsForDay,
} from '@/lib/sandbox/day-selectors';
import { SANDBOX_PATIENTS } from '@/lib/sandbox/fixtures';
import type { SandboxPatient } from '@/lib/sandbox/types';
import { assessTier } from '@/lib/tier-selector/engine';
import { evaluateSafetyGates, getPerDrugRecommendations, getTitrationAction } from '@/lib/titration/engine';
import { RED_FLAG_CRITERIA } from '@/lib/vitals/constants';
import { evaluateRedFlags } from '@/lib/vitals/red-flags';
import { emptyExtraction } from './engine';
import { draftSbarFromCheckIn } from './sbar';
import type { CheckInExtraction } from './types';

// ── Shared contracts ─────────────────────────────────────────

const copilotWorkItemSchema = z
  .object({
    id: z.string().min(1).max(60),
    patientName: z.string().min(1).max(80),
    disposition: z.enum(['emergency', 'escalated', 'routine', 'no_answer']),
    redFlagMessages: z.array(z.string().max(160)).max(6),
    atLabel: z.string().max(40),
  })
  .strict();

export type CopilotWorkItem = z.infer<typeof copilotWorkItemSchema>;
export { copilotWorkItemSchema };

export interface CopilotTraceEntry {
  tool: string;
  summary: string;
}

/** Everything a tool may read: the client queue snapshot plus the simulation day. */
export interface CopilotToolContext {
  workItems: CopilotWorkItem[];
  dayIndex?: number;
}

interface ToolOutcome {
  result: unknown;
  trace: CopilotTraceEntry;
}

interface RegisteredCopilotTool {
  definition: { name: string; description: string; input_schema: Record<string, unknown> };
  argsSchema: z.ZodType | null;
  run: (args: unknown, ctx: CopilotToolContext) => ToolOutcome;
}

// ── Helpers ──────────────────────────────────────────────────

const patientArgSchema = z.object({ patient: z.string().min(1).max(80) }).strict();
const ruleArgSchema = z.object({ ruleId: z.string().min(1).max(40) }).strict();
const noArgsSchema = z.object({}).strict();

const PATIENT_ARG_INPUT_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['patient'],
  properties: { patient: { type: 'string', maxLength: 80, description: 'Patient id (e.g. demo-maria) or name' } },
};

const NO_ARGS_INPUT_SCHEMA = { type: 'object' as const, additionalProperties: false, properties: {} };

function findPatient(reference: string): SandboxPatient | undefined {
  const needle = reference.trim().toLowerCase();
  return SANDBOX_PATIENTS.find(
    (patient) => patient.id.toLowerCase() === needle || patient.name.toLowerCase().includes(needle),
  );
}

function unknownPatientOutcome(tool: string, reference: string): ToolOutcome {
  return {
    result: { error: 'Unknown tour patient. Live outreach personas have no chart in this demonstration.' },
    trace: { tool, summary: `no chart for "${reference.slice(0, 40)}"` },
  };
}

function contextDay(ctx: CopilotToolContext): number {
  return ctx.dayIndex ?? 0;
}

function labSourceDaysAgo(patient: SandboxPatient, dayIndex: number): number {
  const day = dayFor(patient, dayIndex);
  return Math.max(day.labs.potassium.collectedDaysAgo, day.labs.creatinine.collectedDaysAgo);
}

function labSourceNote(patient: SandboxPatient, dayIndex: number): string {
  const daysAgo = labSourceDaysAgo(patient, dayIndex);
  return daysAgo > 3
    ? `Lab source is ${daysAgo} days old — verify the source record before acting.`
    : 'Lab source is current.';
}

function extractionForDay(patient: SandboxPatient, dayIndex: number): CheckInExtraction {
  const day = dayFor(patient, dayIndex);
  const base = emptyExtraction();
  if (!day.vitals || !day.symptoms) return base;
  return {
    ...base,
    weightLbs: day.vitals.weight,
    sbp: day.vitals.sbp,
    spo2: day.vitals.spo2,
    hr: day.vitals.heartRate,
    dyspnea: day.symptoms.dyspnea,
    edema: day.symptoms.edema,
    orthopnea: day.symptoms.orthopnea,
    fatigue: day.symptoms.fatigue,
    adherence: day.symptoms.adherence,
    chestPainOrSyncope: day.symptoms.chestPainOrSyncope,
  };
}

function weightTrendForDay(patient: SandboxPatient, dayIndex: number): Array<{ weightLbs: number; daysAgo: number }> {
  const entries: Array<{ weightLbs: number; daysAgo: number }> = [];
  for (const point of patient.baselineHistory) {
    entries.push({ weightLbs: point.weightLbs, daysAgo: point.daysAgoAtD0 + dayIndex });
  }
  for (const day of patient.days.slice(0, dayIndex + 1)) {
    if (day.vitals) entries.push({ weightLbs: day.vitals.weight, daysAgo: dayIndex - day.dayIndex });
  }
  return entries.sort((a, b) => b.daysAgo - a.daysAgo).slice(-6);
}

// ── Registry ─────────────────────────────────────────────────

const REGISTRY: Record<string, RegisteredCopilotTool> = {
  get_queue: {
    definition: {
      name: 'get_queue',
      description: 'The live simulated outreach queue from this browser session, already ordered by the registered clinical rules (emergency, then escalated, then no-answer follow-ups, then routine).',
      input_schema: NO_ARGS_INPUT_SCHEMA,
    },
    argsSchema: null,
    run: (_args, ctx) => {
      const order: Record<CopilotWorkItem['disposition'], number> = {
        emergency: 0, escalated: 1, no_answer: 2, routine: 3,
      };
      const ordered = [...ctx.workItems]
        .sort((a, b) => order[a.disposition] - order[b.disposition])
        .map((item, index) => ({
          position: index + 1,
          patientName: item.patientName,
          disposition: item.disposition,
          redFlags: item.redFlagMessages,
          receivedAt: item.atLabel,
        }));
      return {
        result: { orderNote: 'Order set by the registered clinical rules, never by the assistant.', items: ordered },
        trace: { tool: 'get_queue', summary: `queue (${ordered.length} items)` },
      };
    },
  },

  triage_queue: {
    definition: {
      name: 'triage_queue',
      description: 'The three tour personas triaged for the current simulation day by the registered red-flag rules: triggered flags, missing check-ins, and adherence lapses, priority-ordered.',
      input_schema: NO_ARGS_INPUT_SCHEMA,
    },
    argsSchema: null,
    run: (_args, ctx) => {
      const dayIndex = contextDay(ctx);
      const rows = SANDBOX_PATIENTS.map((patient) => {
        const day = dayFor(patient, dayIndex);
        const inputs = redFlagInputsForDay(patient, dayIndex);
        const flags = inputs
          ? evaluateRedFlags(inputs.current, inputs.recentHistory, inputs.symptoms)
          : [];
        const signals: string[] = [];
        if (!day.checkInReceived) signals.push('Missing scheduled check-in — clinical trend cannot be inferred.');
        if (day.symptoms && day.symptoms.adherence !== 'yes') signals.push('Medication adherence lapse reported.');
        const rank = flags.some((flag) => flag.severity === 'critical') ? 0
          : flags.length > 0 ? 1
          : !day.checkInReceived ? 2
          : signals.length > 0 ? 3
          : 4;
        return { patient, day, flags, signals, rank };
      })
        .sort((a, b) => a.rank - b.rank)
        .map((row, index) => ({
          position: index + 1,
          patientName: row.patient.name,
          status: row.rank === 0 ? 'critical red flag' : row.rank === 1 ? 'red flag' : row.rank === 2 ? 'missing check-in' : row.rank === 3 ? 'adherence signal' : 'clear',
          redFlags: row.flags.map((flag) => ({ id: flag.id, severity: flag.severity, message: flag.message })),
          signals: row.signals,
        }));
      const dayLabel = dayFor(SANDBOX_PATIENTS[0], dayIndex).dayLabel;
      return {
        result: {
          orderNote: 'Priority computed by the registered red-flag rules for the current simulation day, never by the assistant.',
          simulationDay: dayLabel,
          items: rows,
        },
        trace: { tool: 'triage_queue', summary: `day triage (${dayLabel})` },
      };
    },
  },

  get_patient_snapshot: {
    definition: {
      name: 'get_patient_snapshot',
      description: "One synthetic tour patient's chart summary for the current simulation day (vitals, labs, medications, risk tier, track). Works for the named tour patients only; live outreach personas have no chart.",
      input_schema: PATIENT_ARG_INPUT_SCHEMA,
    },
    argsSchema: patientArgSchema,
    run: (args, ctx) => {
      const { patient: reference } = args as z.infer<typeof patientArgSchema>;
      const patient = findPatient(reference);
      if (!patient) return unknownPatientOutcome('get_patient_snapshot', reference);
      const dayIndex = contextDay(ctx);
      const day = dayFor(patient, dayIndex);
      return {
        result: {
          name: patient.name,
          riskTier: patient.riskTier,
          track: patient.track,
          facilityTier: patient.facilityTier,
          simulationDay: day.dayLabel,
          latestSyntheticVitals: day.vitals ?? patient.vitals.at(-1) ?? null,
          checkInReceived: day.checkInReceived,
          labs: patient.labs,
          labsAsOfDay: { ...day.labs, note: labSourceNote(patient, dayIndex) },
          medications: patient.medications,
          careContext: day.narrative,
        },
        trace: { tool: 'get_patient_snapshot', summary: `patient — ${patient.name}` },
      };
    },
  },

  explain_rule: {
    definition: {
      name: 'explain_rule',
      description: 'The registered red-flag rule record: threshold, window, severity, message, and registered action. Raw registry data.',
      input_schema: {
        type: 'object' as const,
        additionalProperties: false,
        required: ['ruleId'],
        properties: { ruleId: { type: 'string', maxLength: 40 } },
      },
    },
    argsSchema: ruleArgSchema,
    run: (args) => {
      const { ruleId } = args as z.infer<typeof ruleArgSchema>;
      const criteria = (RED_FLAG_CRITERIA as Record<string, unknown>)[ruleId];
      if (!criteria) {
        return {
          result: { error: 'Unknown rule id.', knownRules: Object.keys(RED_FLAG_CRITERIA) },
          trace: { tool: 'explain_rule', summary: `unknown rule "${ruleId.slice(0, 30)}"` },
        };
      }
      const ruleSet = CLINICAL_RULE_REGISTRY.find((entry) => entry.id === 'remote-monitoring-alerts');
      return {
        result: { rule: criteria, registryBoundary: ruleSet?.releaseBoundary ?? null },
        trace: { tool: 'explain_rule', summary: `rule ${ruleId}` },
      };
    },
  },

  draft_sbar: {
    definition: {
      name: 'draft_sbar',
      description: "Draft the four SBAR handoff sections from a tour patient's synthetic chart as of the current simulation day (deterministic template).",
      input_schema: PATIENT_ARG_INPUT_SCHEMA,
    },
    argsSchema: patientArgSchema,
    run: (args, ctx) => {
      const { patient: reference } = args as z.infer<typeof patientArgSchema>;
      const patient = findPatient(reference);
      if (!patient) return unknownPatientOutcome('draft_sbar', reference);
      return {
        result: {
          note: 'Deterministic template from the current synthetic chart; provider review required.',
          sbar: draftSbarFromCheckIn(patient, extractionForDay(patient, contextDay(ctx))),
        },
        trace: { tool: 'draft_sbar', summary: `SBAR draft — ${patient.name}` },
      };
    },
  },

  score_risk: {
    definition: {
      name: 'score_risk',
      description: "Run the HEARTLAND risk score engine on the patient's documented raw factors: total score, tier, care pathway, and the factors present. Proposed framework, not validated.",
      input_schema: PATIENT_ARG_INPUT_SCHEMA,
    },
    argsSchema: patientArgSchema,
    run: (args) => {
      const { patient: reference } = args as z.infer<typeof patientArgSchema>;
      const patient = findPatient(reference);
      if (!patient) return unknownPatientOutcome('score_risk', reference);
      const result = calculateRiskScore(patient.engineInputs.risk);
      return {
        result: {
          totalScore: result.totalScore,
          maxScore: result.maxScore,
          tier: result.tierLabel,
          carePathway: {
            followUp: result.carePathway.followUp,
            monitoring: result.carePathway.monitoring,
            support: result.carePathway.support,
          },
          presentFactors: result.breakdown
            .filter((entry) => entry.present)
            .map((entry) => ({ factor: entry.variable, points: entry.points })),
          note: 'Proposed scoring framework under development — not validated against outcomes data.',
        },
        trace: { tool: 'score_risk', summary: `risk score — ${patient.name}` },
      };
    },
  },

  evaluate_red_flags: {
    definition: {
      name: 'evaluate_red_flags',
      description: "Run the registered red-flag rules over the patient's check-in for the current simulation day: triggered flags plus the recent weight trend the rules evaluated.",
      input_schema: PATIENT_ARG_INPUT_SCHEMA,
    },
    argsSchema: patientArgSchema,
    run: (args, ctx) => {
      const { patient: reference } = args as z.infer<typeof patientArgSchema>;
      const patient = findPatient(reference);
      if (!patient) return unknownPatientOutcome('evaluate_red_flags', reference);
      const dayIndex = contextDay(ctx);
      const inputs = redFlagInputsForDay(patient, dayIndex);
      if (!inputs) {
        return {
          result: {
            note: 'No check-in reached the clinic on this simulation day — the rules have nothing to evaluate. Missing data is itself the active signal.',
            checkInReceived: false,
          },
          trace: { tool: 'evaluate_red_flags', summary: `red flags — ${patient.name} (no check-in)` },
        };
      }
      const flags = evaluateRedFlags(inputs.current, inputs.recentHistory, inputs.symptoms);
      return {
        result: {
          flags: flags.map((flag) => ({ id: flag.id, severity: flag.severity, message: flag.message, action: flag.action })),
          recentWeightsLbs: weightTrendForDay(patient, dayIndex),
          note: flags.length === 0 ? 'No registered red-flag rule triggered for this day.' : 'Actions come from the registered rules, not the assistant.',
        },
        trace: { tool: 'evaluate_red_flags', summary: `red flags — ${patient.name} (${flags.length})` },
      };
    },
  },

  evaluate_titration: {
    definition: {
      name: 'evaluate_titration',
      description: "Run the protocol titration algorithm on the day's vitals and labs: the five safety gates, the global action, and per-drug-class recommendations. Uptitration always remains a provider decision.",
      input_schema: PATIENT_ARG_INPUT_SCHEMA,
    },
    argsSchema: patientArgSchema,
    run: (args, ctx) => {
      const { patient: reference } = args as z.infer<typeof patientArgSchema>;
      const patient = findPatient(reference);
      if (!patient) return unknownPatientOutcome('evaluate_titration', reference);
      const dayIndex = contextDay(ctx);
      const vitals = titrationVitalsForDay(patient, dayIndex);
      if (!vitals) {
        return {
          result: {
            note: 'No check-in data for this simulation day — titration cannot be evaluated without current vitals.',
            labSource: labSourceNote(patient, dayIndex),
          },
          trace: { tool: 'evaluate_titration', summary: `titration — ${patient.name} (no data)` },
        };
      }
      return {
        result: {
          vitalsUsed: vitals,
          safetyGates: evaluateSafetyGates(vitals).map((gate) => ({
            parameter: gate.parameter, value: gate.value, status: gate.status, action: gate.action,
          })),
          globalAction: getTitrationAction(vitals),
          perDrugClass: getPerDrugRecommendations(vitals, activeDrugClassesFor(patient)),
          labSource: labSourceNote(patient, dayIndex),
          note: 'Algorithm output only — symptoms and full clinical context are not evaluated here; provider decision required.',
        },
        trace: { tool: 'evaluate_titration', summary: `titration — ${patient.name}` },
      };
    },
  },

  assign_monitoring_track: {
    definition: {
      name: 'assign_monitoring_track',
      description: "Run the remote-monitoring track assignment engine on the patient's documented connectivity answers and compare with the current track.",
      input_schema: PATIENT_ARG_INPUT_SCHEMA,
    },
    argsSchema: patientArgSchema,
    run: (args) => {
      const { patient: reference } = args as z.infer<typeof patientArgSchema>;
      const patient = findPatient(reference);
      if (!patient) return unknownPatientOutcome('assign_monitoring_track', reference);
      const recommendation = assignTrack(patient.engineInputs.connectivity);
      return {
        result: {
          currentTrack: patient.track,
          engineRecommendation: recommendation,
          inputs: patient.engineInputs.connectivity,
        },
        trace: { tool: 'assign_monitoring_track', summary: `track — ${patient.name}` },
      };
    },
  },

  assess_facility_tier: {
    definition: {
      name: 'assess_facility_tier',
      description: "Run the floor-tier algorithm on the 8 documented category levels of the patient's facility: overall tier, limiting categories, and top upgrade actions.",
      input_schema: PATIENT_ARG_INPUT_SCHEMA,
    },
    argsSchema: patientArgSchema,
    run: (args) => {
      const { patient: reference } = args as z.infer<typeof patientArgSchema>;
      const patient = findPatient(reference);
      if (!patient) return unknownPatientOutcome('assess_facility_tier', reference);
      const result = assessTier(facilityAssessmentFor(patient));
      return {
        result: {
          facility: patient.region,
          overallTier: result.overallTier,
          tierLabel: result.tierLabel,
          rationale: result.rationale,
          limitingCategories: result.limitingCategories.map((category) => category.categoryLabel),
          topUpgrades: result.upgradeRecommendations.slice(0, 3),
        },
        trace: { tool: 'assess_facility_tier', summary: `facility tier — ${patient.name}` },
      };
    },
  },

  followup_schedule: {
    definition: {
      name: 'followup_schedule',
      description: 'The protocol post-discharge follow-up schedule for a patient in a discharge window, with due dates relative to the current simulation day.',
      input_schema: PATIENT_ARG_INPUT_SCHEMA,
    },
    argsSchema: patientArgSchema,
    run: (args, ctx) => {
      const { patient: reference } = args as z.infer<typeof patientArgSchema>;
      const patient = findPatient(reference);
      if (!patient) return unknownPatientOutcome('followup_schedule', reference);
      const dayIndex = contextDay(ctx);
      const dischargedAt = dischargedAtFor(patient, dayIndex);
      if (!dischargedAt) {
        return {
          result: { note: 'This patient is not in a post-discharge follow-up window.' },
          trace: { tool: 'followup_schedule', summary: `follow-up — ${patient.name} (n/a)` },
        };
      }
      const tier = assessTier(facilityAssessmentFor(patient)).overallTier;
      const now = Date.now();
      const schedule = computeFollowupDates(dischargedAt, tier).map((row) => {
        const dueInDays = Math.round((row.due_at.getTime() - now) / 86_400_000);
        return {
          label: row.label,
          purpose: row.purpose,
          mode: tier >= 2 ? row.tier23_mode : row.tier1_mode,
          due: dueInDays === 0 ? 'due today' : dueInDays > 0 ? `in ${dueInDays} day(s)` : `${-dueInDays} day(s) ago`,
        };
      });
      return {
        result: { dischargedDaysAgo: patient.engineInputs.dischargedDaysAgo, facilityTier: tier, schedule },
        trace: { tool: 'followup_schedule', summary: `follow-up — ${patient.name}` },
      };
    },
  },

  assess_comorbidity_stage: {
    definition: {
      name: 'assess_comorbidity_stage',
      description: "Run the CKM staging, advanced-HF referral, and device evaluation engines on the patient's documented cardiac inputs (LVEF, QRS, GDMT duration, hospitalizations).",
      input_schema: PATIENT_ARG_INPUT_SCHEMA,
    },
    argsSchema: patientArgSchema,
    run: (args) => {
      const { patient: reference } = args as z.infer<typeof patientArgSchema>;
      const patient = findPatient(reference);
      if (!patient) return unknownPatientOutcome('assess_comorbidity_stage', reference);
      const { comorbidity, ckm } = patient.engineInputs;
      return {
        result: {
          ckmStage: formatCkmStageLabel(classifyCkmStage(ckm)),
          referral: evaluateReferralCriteria(comorbidity),
          device: evaluateDeviceCriteria(comorbidity),
          inputs: comorbidity,
          note: 'Referral and device outputs are the registered protocol gates; electrophysiology and advanced-HF decisions remain with specialists.',
        },
        trace: { tool: 'assess_comorbidity_stage', summary: `comorbidity — ${patient.name}` },
      };
    },
  },
};

export const COPILOT_TOOLS = Object.values(REGISTRY).map((tool) => tool.definition);

/** Execute one tool call deterministically; the result is JSON handed back to the model. */
export function executeRegisteredCopilotTool(
  name: string,
  args: unknown,
  ctx: CopilotToolContext,
): ToolOutcome {
  const tool = REGISTRY[name];
  if (!tool) {
    return { result: { error: 'unknown tool' }, trace: { tool: name.slice(0, 30), summary: 'unknown tool' } };
  }
  if (tool.argsSchema) {
    const parsed = tool.argsSchema.safeParse(args);
    if (!parsed.success) {
      return { result: { error: 'invalid arguments' }, trace: { tool: name, summary: 'invalid arguments' } };
    }
    return tool.run(parsed.data, ctx);
  }
  const parsed = noArgsSchema.safeParse(args ?? {});
  return tool.run(parsed.success ? parsed.data : {}, ctx);
}

// ── Result serialization (token guard) ───────────────────────

const TOOL_RESULT_CHAR_CAP = 1800;

function capArraysDeep(value: unknown, maxItems: number): { value: unknown; truncated: boolean } {
  if (Array.isArray(value)) {
    let truncated = value.length > maxItems;
    const capped = value.slice(0, maxItems).map((item) => {
      const inner = capArraysDeep(item, maxItems);
      truncated = truncated || inner.truncated;
      return inner.value;
    });
    return { value: capped, truncated };
  }
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    let truncated = false;
    const capped: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      const inner = capArraysDeep(entry, maxItems);
      truncated = truncated || inner.truncated;
      capped[key] = inner.value;
    }
    return { value: capped, truncated };
  }
  return { value, truncated: false };
}

/** Cap arrays BEFORE stringifying (never slice JSON text) and flag truncation. */
export function serializeCopilotToolResult(result: unknown): string {
  for (const maxItems of [8, 3]) {
    const { value, truncated } = capArraysDeep(result, maxItems);
    const wrapped = truncated && value !== null && typeof value === 'object' && !Array.isArray(value)
      ? { ...(value as Record<string, unknown>), resultTruncated: true }
      : value;
    const serialized = JSON.stringify(wrapped);
    if (serialized.length <= TOOL_RESULT_CHAR_CAP) return serialized;
  }
  return JSON.stringify({ error: 'result too large to serialize' });
}
