/**
 * Titration Follow-Up Call Script -- Questions & Deterministic Completion
 *
 * Conversational follow-up after a GDMT dose change. Question order and every
 * outcome are deterministic: completion runs the registered titration safety
 * gates (lib/titration/engine.ts, rule set `titration-safety-gates`, source
 * Module 3 §3.3) against the reported home readings plus the synthetic
 * fixture's labs. The AI never decides — hold/reduce and any symptom or
 * adherence signal route to nurse review; only a clean gate pass stays
 * routine, and even that is confirmation-only ("no autonomous dose change").
 */

import { getTitrationAction } from '@/lib/titration/engine';
import { SANDBOX_PATIENTS } from '@/lib/sandbox/fixtures';
import type { SandboxPatient } from '@/lib/sandbox/types';
import type { RedFlag } from '@/lib/vitals/types';
import { demoNoteFor } from './script';
import type { CallLocale, CallScript, CheckInState, CheckInTurnResponse, ScriptQuestion, ScriptQuestionId } from './types';

export const TITRATION_QUESTIONS: Record<string, ScriptQuestion> = {
  t1_safety: {
    id: 't1_safety',
    canonical:
      'First, the important one: any chest pain, or have you fainted or almost fainted since we increased your medicine?',
    canonicalEs:
      'Primero, lo importante: ¿algún dolor de pecho, o se ha desmayado o casi desmayado desde que aumentamos su medicina?',
    extractionKeys: ['chestPainOrSyncope'],
    skippable: false,
  },
  t2_dizziness: {
    id: 't2_dizziness',
    canonical:
      'Since the dose change, any dizziness or lightheadedness — especially when standing up?',
    canonicalEs:
      'Desde el cambio de dosis, ¿algún mareo o aturdimiento — especialmente al ponerse de pie?',
    extractionKeys: ['dizziness'],
    skippable: false,
  },
  t3_sbp: {
    id: 't3_sbp',
    canonical:
      "What was your blood pressure this morning — the top number? It's fine to skip if you don't have a reading.",
    canonicalEs:
      '¿Cuál fue su presión arterial esta mañana — el número de arriba? Está bien saltarse esta si no tiene una lectura.',
    extractionKeys: ['sbp'],
    skippable: true,
  },
  t4_hr: {
    id: 't4_hr',
    canonical:
      "And your heart rate — the pulse number on the monitor? It's fine to skip if you don't have it.",
    canonicalEs:
      '¿Y su frecuencia cardíaca — el número de pulso en el monitor? Está bien saltarse esta si no lo tiene.',
    extractionKeys: ['hr'],
    skippable: true,
  },
  t5_symptoms: {
    id: 't5_symptoms',
    canonical:
      'Any new or worse trouble breathing, or feeling much more tired than usual, since the change?',
    canonicalEs:
      '¿Alguna dificultad para respirar nueva o peor, o se siente mucho más cansado de lo normal, desde el cambio?',
    extractionKeys: ['worseSymptoms'],
    skippable: false,
  },
  t6_adherence: {
    id: 't6_adherence',
    canonical: 'Have you been able to take the new dose every day?',
    canonicalEs: '¿Ha podido tomar la nueva dosis todos los días?',
    extractionKeys: ['adherence'],
    skippable: false,
  },
};

export const TITRATION_ORDER: readonly ScriptQuestionId[] = [
  't1_safety', 't2_dizziness', 't3_sbp', 't4_hr', 't5_symptoms', 't6_adherence',
];

// ── Fixed spoken lines (pre-generated audio per locale) ──────

export const SPOKEN_TITRATION_INTRO =
  'Hi, this is the automated follow-up call from your heart care team about your recent medicine adjustment. A member of your care team reviews everything I collect — I never make medical decisions. This takes about two minutes.';

export const SPOKEN_TITRATION_INTRO_ES =
  'Hola, esta es la llamada automática de seguimiento de su equipo de atención del corazón sobre su ajuste reciente de medicina. Un miembro de su equipo revisa todo lo que recojo — yo nunca tomo decisiones médicas. Esto toma unos dos minutos.';

export const SPOKEN_TITRATION_ROUTINE =
  "Thank you — that's everything I need. Your answers and home readings passed the preset safety checks, so your care team will confirm the next dose step. If anything changes before then, call your care team — and for an emergency, call 911. Take care. Bye-bye.";

export const SPOKEN_TITRATION_ROUTINE_ES =
  'Gracias — eso es todo lo que necesito. Sus respuestas y lecturas en casa pasaron las verificaciones de seguridad preestablecidas, así que su equipo de atención confirmará el siguiente paso de dosis. Si algo cambia antes, llame a su equipo — y en una emergencia, llame al 911. Cuídese. Adiós.';

export const SPOKEN_TITRATION_ESCALATION =
  "Thank you. Based on your care plan's preset safety rules, your dose should not change until a nurse reviews this with you — she will call you back today, so please keep your phone nearby. Please don't change anything on your own before that call. If anything suddenly gets worse, call 911. Take care. Bye-bye.";

export const SPOKEN_TITRATION_ESCALATION_ES =
  'Gracias. Según las reglas de seguridad preestablecidas de su plan de atención, su dosis no debe cambiar hasta que una enfermera lo revise con usted — ella le devolverá la llamada hoy, así que por favor mantenga su teléfono cerca. No cambie nada por su cuenta antes de esa llamada. Si algo empeora de repente, llame al 911. Cuídese. Adiós.';

// ── Deterministic completion (registered safety gates decide) ──

function labNumber(patient: SandboxPatient, name: string): number | null {
  const lab = patient.labs.find((entry) => entry.name.toLowerCase() === name.toLowerCase());
  if (!lab) return null;
  const value = Number.parseFloat(lab.value);
  return Number.isFinite(value) ? value : null;
}

function closingMessage(escalated: boolean, flags: RedFlag[], locale: CallLocale): string {
  const note = demoNoteFor(locale);
  if (!escalated) {
    return locale === 'es'
      ? `Sus respuestas y lecturas pasaron las verificaciones de seguridad preestablecidas del plan de titulación. Su equipo de atención confirmará el siguiente paso de dosis — ningún cambio ocurre sin esa confirmación. ${note}`
      : `Your answers and readings passed the titration plan's preset safety checks. Your care team will confirm the next dose step — no change happens without that confirmation. ${note}`;
  }
  const detail = flags.map((flag) => `${flag.message} — ${flag.action}.`).join(' ');
  return locale === 'es'
    ? `Según las reglas de seguridad preestablecidas de su plan, su dosis no debe cambiar todavía: ${detail} Una enfermera le llamará hoy. ${note}`
    : `Based on your plan's preset safety rules, your dose should not change yet: ${detail} A nurse will call you today. ${note}`;
}

/**
 * Registered-rule completion for the titration follow-up. Home readings fall
 * back to the fixture's latest synthetic vitals; potassium/creatinine/eGFR
 * come from the fixture's labs (they are never collected by phone).
 */
export function finalizeTitration(state: CheckInState): CheckInTurnResponse {
  const patient = SANDBOX_PATIENTS.find((entry) => entry.id === state.patientId) ?? SANDBOX_PATIENTS[0];
  const lastSynthetic = patient.vitals.at(-1);
  const extraction = state.extraction;
  const sbp = extraction.sbp ?? lastSynthetic?.sbp ?? 0;
  const hr = extraction.hr ?? lastSynthetic?.heartRate ?? 0;
  const creatinine = labNumber(patient, 'Creatinine') ?? 0;
  const vitals = {
    sbp,
    hr,
    potassium: labNumber(patient, 'Potassium') ?? 0,
    creatinine,
    // One synthetic lab draw: baseline equals current (no interval change).
    creatinineBaseline: creatinine,
    egfr: labNumber(patient, 'eGFR') ?? undefined,
  };

  const flags: RedFlag[] = [];
  const gate = getTitrationAction(vitals);
  if (gate.action !== 'uptitrate') {
    flags.push({
      id: `titration_gate_${gate.action}`,
      severity: 'critical',
      message: gate.details,
      action: 'Nurse review before any dose change',
    });
  }
  // Module 3 §3.3: SBP <90 OR symptomatic hypotension -> reduce/hold. The
  // symptomatic arm is reported dizziness (>= moderate) with SBP below 100.
  if ((extraction.dizziness ?? 0) >= 2 && sbp < 100) {
    flags.push({
      id: 'titration_symptomatic_hypotension',
      severity: 'critical',
      message: 'Symptomatic low blood pressure since the dose change',
      action: 'Hold the new dose; nurse callback today',
    });
  }
  if (extraction.worseSymptoms === true) {
    flags.push({
      id: 'titration_worse_symptoms',
      severity: 'warning',
      message: 'New or worse symptoms since the dose change',
      action: 'Nurse review before any dose change',
    });
  }
  if (extraction.adherence === 'missed_some' || extraction.adherence === 'no') {
    flags.push({
      id: 'titration_adherence',
      severity: 'warning',
      message: 'The new dose was not taken every day',
      action: 'Nurse review of barriers before any dose change',
    });
  }

  const escalated = flags.length > 0;
  return {
    assistantMessages: [closingMessage(escalated, flags, state.locale)],
    state: { ...state, phase: 'complete' },
    done: true,
    disposition: escalated ? 'escalated' : 'routine',
    redFlags: flags,
    fallback: false,
  };
}

export const TITRATION_SCRIPT: CallScript = {
  id: 'titration_followup',
  questions: TITRATION_QUESTIONS,
  order: TITRATION_ORDER,
  finalize: finalizeTitration,
};
