/**
 * Deterministic safety checks for public sandbox AI text.
 *
 * These checks run before a visitor reply can reach the model and after any
 * free text comes back from it. They intentionally stay narrow: emergency
 * language, obvious direct identifiers, and prescriptive clinical language.
 */

import type { RedFlag } from '@/lib/vitals/types';
import type { CheckInExtraction, ScriptId } from './types';

function foldText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\u2019']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function foldEmergencyText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\u2019']/g, '')
    // Keep a sentence boundary so an unrelated "no" in the prior sentence
    // cannot suppress a later emergency statement.
    .replace(/[.!?;:\n\u2013\u2014]+/g, ' clausebreak ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const EMERGENCY_MENTION_PATTERNS: readonly RegExp[] = [
  // English: chest pain/pressure/tightness and common patient phrasing.
  /\bchest\s+(?:pain|pressure|tightness|tight|ache|aching|hurt|hurts|discomfort|heaviness|squeezing)\b/g,
  /\b(?:pain|pressure|tightness|tight|ache|aching|discomfort|heaviness|squeezing)\s+(?:right\s+)?(?:in|inside|across|over)\s+(?:(?:the\s+)?(?:middle|center)\s+of\s+)?(?:(?:my|the)\s+)?chest\b/g,
  /\b(?:my|the)\s+chest\s+(?:(?:hurt|hurts|aches)\b|(?:is|feels)\s+(?:tight|heavy|painful|squeezed|hurt|hurting)\b)/g,
  /\bangina\b/g,
  // English: syncope and near-syncope.
  /\b(?:faint|fainted|fainting|pass(?:ed|ing)?\s+out|black(?:ed|ing)?\s+out|(?:lose|lost|losing)\s+consciousness|syncope|syncopal)\b/g,
  /\b(?:feel|felt|feeling)\s+faint\b/g,
  // Spanish: chest pain/pressure and common patient phrasing.
  /\b(?:dolor|presion|opresion|molestia)\s+(?:fuerte\s+)?(?:de|en)\s+(?:(?:el|mi)\s+)?pecho\b/g,
  /\b(?:me|le)\s+duele\s+(?:(?:el|mi)\s+)?pecho\b/g,
  /\b(?:mi|el)\s+pecho\s+(?:me\s+)?(?:duele|aprieta|oprime)\b/g,
  /\bme\s+(?:aprieta|oprime)\s+(?:el\s+)?pecho\b/g,
  /\b(?:siento|tengo)\s+(?:dolor|presion|opresion|molestia)\s+(?:en\s+)?(?:(?:el|mi)\s+)?pecho\b/g,
  /\bpecho\s+(?:apretado|oprimido)\b/g,
  /\b(?:dolor|presion|opresion)\s+toracic[oa]\b/g,
  // Spanish: syncope and near-syncope.
  /\b(?:(?:me|se)\s+)?desmay(?:e|o|a|ado|aba|ando|ar|arme|arse)\b/g,
  /\b(?:tuve|he\s+tenido)\s+un\s+desmayo\b/g,
  /\b(?:perdi|perdio|pierdo|perder)\s+(?:el\s+)?conocimiento\b/g,
  /\b(?:me|se)\s+desvaneci(?:o)?\b/g,
  /\b(?:quede|quedo)\s+inconsciente\b/g,
  /\bsincope\b/g,
];

const NEGATORS = new Set([
  'no', 'not', 'never', 'without', 'neither', 'nor',
  'dont', 'doesnt', 'didnt', 'havent', 'hasnt', 'hadnt',
  'deny', 'denies', 'denied', 'negative', 'free',
  'sin', 'nunca', 'tampoco', 'niega', 'nego', 'ningun', 'ninguna',
]);

const CONTRAST_MARKERS = new Set(['but', 'however', 'though', 'although', 'pero', 'aunque', 'clausebreak']);

function isAffirmativeConjunctionBoundary(tokens: string[], index: number): boolean {
  const token = tokens[index];
  const next = tokens[index + 1];
  if (token === 'and') {
    return ['i', 'im', 'ive', 'my', 'today', 'now', 'then', 'suddenly', 'also', 'almost', 'nearly'].includes(next);
  }
  if (token === 'y') {
    return ['yo', 'me', 'mi', 'hoy', 'ahora', 'luego', 'tambien', 'casi', 'siento', 'tengo', 'tuve', 'he', 'perdi'].includes(next);
  }
  return false;
}

function negatorIsAmbiguityOrWarning(context: string[], index: number): boolean {
  const token = context[index];
  const previous = context[index - 1];
  const tail = context.slice(index + 1).join(' ');

  // "I don't know if this is chest pain" and "I'm not sure" are ambiguous,
  // not reassuring negatives. "No longer" / "ya no" still reports an event.
  if ((token === 'no' && previous === 'ya') || /^(?:really\s+)?longer\b/.test(tail)) return true;
  return /^(?:really\s+)?(?:know|think|believe|sure|certain|se|creo|puedo\s+(?:decir|saber)|to\s+ignore|ignore|just|only)\b/.test(tail);
}

function mentionIsNegated(normalized: string, start: number, end: number): boolean {
  const before = normalized.slice(0, start).trim();
  const tokens = before.length > 0 ? before.split(/\s+/) : [];
  let boundary = Math.max(0, tokens.length - 10);
  for (let index = boundary; index < tokens.length; index += 1) {
    if (CONTRAST_MARKERS.has(tokens[index]) || isAffirmativeConjunctionBoundary(tokens, index)) {
      boundary = index + 1;
    }
  }

  const context = tokens.slice(boundary);
  for (let index = 0; index < context.length; index += 1) {
    const token = context[index];
    if (!NEGATORS.has(token)) continue;
    if (token === 'free' && context[index + 1] !== 'of') continue;
    if (negatorIsAmbiguityOrWarning(context, index)) continue;
    return true;
  }

  // Also cover terse transcript-style answers such as "Chest pain? No."
  const afterTokens = normalized.slice(end).trim().split(/\s+/);
  while (afterTokens[0] === 'clausebreak') afterTokens.shift();
  const after = afterTokens.slice(0, 4);
  const shortAnswer = after.join(' ');
  if (/^(?:i\s+dont\s+think|im\s+not\s+sure|no\s+(?:creo|se))\b/.test(shortAnswer)) return false;
  return /^(?:no|none|negative|ninguno|ninguna)\b/.test(shortAnswer)
    || /^(?:i\s+)?(?:dont\s+have|do\s+not\s+have|havent|have\s+not)\b/.test(shortAnswer);
}

/**
 * Detect an affirmative or ambiguous chest-pain/syncope mention in English or
 * Spanish. Clear negations are ignored; uncertain wording fails safe.
 */
export function detectEmergencyMention(text: string): boolean {
  const normalized = foldEmergencyText(text);
  if (normalized.length === 0) return false;

  for (const source of EMERGENCY_MENTION_PATTERNS) {
    const pattern = new RegExp(source.source, source.flags);
    for (const match of normalized.matchAll(pattern)) {
      const start = match.index;
      if (start === undefined) continue;
      if (!mentionIsNegated(normalized, start, start + match[0].length)) return true;
    }
  }
  return false;
}

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const FORMATTED_SSN_PATTERN = /\b\d{3}-\d{2}-\d{4}\b/;
const LABELED_SSN_PATTERN = /\b(?:ssn|social\s+security(?:\s+number)?|seguro\s+social)\b[^0-9]{0,16}\d{3}[\s-]?\d{2}[\s-]?\d{4}\b/i;
const FORMATTED_PHONE_PATTERN = /(?:^|[^\d])(?:\+?\d{1,3}[\s.-])?(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}(?:[^\d]|$)/;
const E164_PHONE_PATTERN = /(?:^|[^\d])\+\d(?:[\s.-]?\d){9,14}(?:[^\d]|$)/;
const LABELED_PHONE_PATTERN = /\b(?:phone|telephone|mobile|cell|tel[eé]fono|celular)\b[^0-9+]{0,20}(?:\+?\d[\d().\s-]{8,}\d)/i;

/** Narrow PII guard for identifiers that are unambiguous in public text. */
export function containsObviousIdentifier(text: string): boolean {
  return EMAIL_PATTERN.test(text)
    || FORMATTED_SSN_PATTERN.test(text)
    || LABELED_SSN_PATTERN.test(text)
    || FORMATTED_PHONE_PATTERN.test(text)
    || E164_PHONE_PATTERN.test(text)
    || LABELED_PHONE_PATTERN.test(text);
}

const CLINICAL_ACTION = [
  'stop', 'start', 'restart', 'resume', 'increase', 'decrease', 'reduce', 'double',
  'hold', 'skip', 'change', 'adjust', 'continue', 'take', 'use', 'avoid', 'limit',
  'rest', 'drink', 'eat', 'elevate', 'raise', 'monitor', 'check', 'wait', 'call',
  'contact', 'go', 'seek', 'stay', 'keep', 'cut', 'get', 'lie', 'hydrate', 'watch',
  'stopping', 'starting', 'restarting', 'resuming', 'increasing', 'decreasing',
  'reducing', 'doubling', 'holding', 'skipping', 'changing', 'adjusting',
  'continuing', 'taking', 'using', 'avoiding', 'limiting', 'resting', 'drinking',
  'eating', 'elevating', 'raising', 'monitoring', 'checking', 'waiting', 'calling',
  'contacting', 'going', 'seeking', 'staying', 'keeping', 'cutting', 'lying',
  'hydrating', 'watching',
  'deje', 'dejar', 'suspenda', 'suspender', 'empiece', 'comience', 'reinicie',
  'reanude', 'aumente', 'reduzca', 'disminuya', 'duplique', 'omita', 'salte',
  'cambie', 'ajuste', 'continue', 'tome', 'tomar', 'use', 'evite', 'limite',
  'descanse', 'beba', 'coma', 'eleve', 'vigile', 'controle', 'espere', 'llame',
  'contacte', 'vaya', 'busque', 'mantenga', 'empezar', 'comenzar', 'reiniciar',
  'reanudar', 'aumentar', 'reducir', 'disminuir', 'duplicar', 'omitir', 'saltar',
  'cambiar', 'ajustar', 'continuar', 'usar', 'evitar', 'limitar', 'descansar',
  'beber', 'comer', 'elevar', 'vigilar', 'controlar', 'esperar', 'llamar',
  'contactar', 'ir', 'buscar', 'mantener', 'acuestese', 'tumbese', 'hidratese',
  'dejando', 'suspendiendo', 'tomando', 'descansando', 'bebiendo', 'elevando',
  'llamando',
].join('|');

const IMPERATIVE_ACTION = new RegExp(
  `^(?:(?:for now|today|tonight|por ahora|hoy|esta noche)\\s+)?(?:${CLINICAL_ACTION})\\b`,
);
const PRESCRIPTIVE_MODAL = new RegExp(
  `\\b(?:you\\s+(?:should|need to|must|ought to|can safely)|i\\s+(?:recommend|suggest)|please|try\\s+to|consider|it\\s+(?:may|might|can)\\s+help\\s+to|deberias?|debe|necesitas?|necesita|tiene\\s+que|puede\\s+(?:dejar|tomar|usar|aumentar|reducir|cambiar|descansar)|recomiendo|sugiero|por favor|trate\\s+de|considere)\\s+(?:${CLINICAL_ACTION})\\b`,
);

const MEDICATION_TERM = [
  'medicine', 'medicines', 'medication', 'medications', 'drug', 'drugs', 'diuretic',
  'furosemide', 'lasix', 'carvedilol', 'lisinopril', 'losartan', 'spironolactone',
  'sacubitril', 'valsartan', 'entresto', 'metoprolol',
  'medicina', 'medicinas', 'medicamento', 'medicamentos', 'pastilla', 'pastillas',
  'farmaco', 'farmacos', 'diuretico',
].join('|');
const MEDICATION_CHANGE = [
  'stop', 'start', 'restart', 'resume', 'increase', 'decrease', 'reduce', 'double',
  'hold', 'skip', 'change', 'adjust', 'continue',
  'deje', 'suspenda', 'empiece', 'comience', 'reinicie', 'reanude', 'aumente',
  'reduzca', 'disminuya', 'duplique', 'omita', 'cambie', 'ajuste', 'continue',
].join('|');
const MEDICATION_ADVICE = new RegExp(
  `\\b(?:${MEDICATION_CHANGE})\\b.{0,48}\\b(?:${MEDICATION_TERM})\\b|\\b(?:${MEDICATION_TERM})\\b.{0,48}\\b(?:${MEDICATION_CHANGE})\\b`,
);

const CARE_SEEKING_ADVICE = /\b(?:(?:call|contact|tell|notify|see|visit)\s+(?:(?:your|the|a)\s+)?(?:doctor|nurse|clinic|cardiologist|care\s+team)|go\s+to\s+(?:the\s+)?(?:er|emergency\s+room|hospital|urgent\s+care)|seek\s+(?:medical|urgent|emergency)\s+care|(?:llame|contacte|avise|vea|visite)\s+(?:(?:a|al|a\s+la|su)\s+)?(?:medico|doctor|enfermera|clinica|cardiologo|equipo\s+de\s+atencion)|vaya\s+(?:(?:a|al)\s+)?(?:urgencias|hospital)|busque\s+atencion\s+(?:medica|urgente))\b/;
const REASSURANCE = /\b(?:nothing\s+to\s+worry\s+about|no\s+need\s+to\s+(?:call|seek|worry)|youre\s+(?:fine|safe|all\s+clear)|you\s+are\s+(?:fine|safe|all\s+clear)|everything\s+is\s+(?:fine|safe|normal)|your\s+(?:symptoms?|breathing|swelling|pain|pressure|reading)\s+(?:is|are)\s+(?:fine|safe|normal|not\s+serious)|no\s+(?:hay|tiene)\s+(?:nada\s+)?que\s+preocuparse|todo\s+esta\s+bien|usted\s+esta\s+bien|sus\s+(?:sintomas|lecturas?)\s+(?:son|estan)\s+(?:normales|bien))\b/;
const CLINICAL_DIAGNOSIS = /\b(?:you\s+(?:have|may\s+have|probably\s+have|dont\s+have)|it\s+(?:sounds|looks)\s+like|usted\s+(?:tiene|puede\s+tener)|parece\s+que\s+tiene)\b.{0,60}\b(?:heart|failure|fluid|retention|infection|dehydration|symptom|swelling|breath|dizziness|pain|pressure|condition|problem|emergency|corazon|insuficiencia|liquido|retencion|infeccion|deshidratacion|sintoma|hinchazon|respiracion|mareo|dolor|presion|problema|urgencia)\b/;

/**
 * Reject general clinical advice and reassurance in all model-authored text,
 * including advice that contains no dose or link.
 */
export function containsClinicalAdvice(text: string): boolean {
  const normalized = foldText(text);
  if (normalized.length === 0) return false;
  if (PRESCRIPTIVE_MODAL.test(normalized)) return true;
  if (MEDICATION_ADVICE.test(normalized)) return true;
  if (CARE_SEEKING_ADVICE.test(normalized)) return true;
  if (REASSURANCE.test(normalized) || CLINICAL_DIAGNOSIS.test(normalized)) return true;

  const sentenceText = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\u2019']/g, '')
    .replace(/[\u2013\u2014]/g, ';')
    .replace(/[^a-z0-9.!?;]+/g, ' ');
  return sentenceText.split(/[.!?;]+/).some((sentence) => IMPERATIVE_ACTION.test(sentence.trim()));
}

const REQUIRED_FIELDS: Record<ScriptId, ReadonlyArray<keyof CheckInExtraction>> = {
  daily_checkin: [
    'chestPainOrSyncope', 'weightLbs', 'dyspnea', 'edema',
    'orthopnea', 'fatigue', 'adherence',
  ],
  titration_followup: [
    'chestPainOrSyncope', 'dizziness', 'sbp', 'hr', 'worseSymptoms', 'adherence',
  ],
};

const FIELD_LABELS: Record<keyof CheckInExtraction, string> = {
  weightLbs: 'weight',
  sbp: 'systolic blood pressure',
  spo2: 'oxygen saturation',
  dyspnea: 'breathing',
  edema: 'swelling',
  orthopnea: 'sleeping position',
  fatigue: 'energy/fatigue',
  adherence: 'medication adherence',
  chestPainOrSyncope: 'chest pain/fainting',
  hr: 'heart rate',
  dizziness: 'dizziness',
  worseSymptoms: 'new or worse symptoms',
};

/** Missing required answers always become human review, never reassurance. */
export function incompleteClinicalDataFlag(
  scriptId: ScriptId,
  extraction: CheckInExtraction,
): RedFlag | null {
  const missing = REQUIRED_FIELDS[scriptId].filter((field) => extraction[field] === null);
  if (missing.length === 0) return null;

  return {
    id: 'needs_human_review',
    severity: 'warning',
    message: `Required clinical answers are missing or unclear: ${missing.map((field) => FIELD_LABELS[field]).join(', ')}`,
    action: scriptId === 'titration_followup'
      ? 'Nurse review required before confirming any dose step'
      : 'Human review required before closing this check-in',
  };
}
