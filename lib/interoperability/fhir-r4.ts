import { createHash } from 'node:crypto';
import { z } from 'zod';
import { effectiveLabObservationSchema, selectLatestEffectiveLab, type EffectiveLabObservation } from '@/lib/labs/effective';
import { LAB_OBSERVATION_FIELDS, labCollectionMicros } from '@/lib/labs/quality';

export const MAX_FHIR_RESOURCES = 10_000; // Existing data_export_events CHECK, not truncation.
export class FhirExportLimitError extends Error {
  constructor() { super('FHIR export exceeds the 10,000-resource limit. No partial file was created.'); }
}
const guid = z.guid();
const instant = z.string().refine((value) => labCollectionMicros(value) !== null, 'Invalid source instant');
const integer = z.number().int().nonnegative().safe().nullable();
export const fhirVitalSchema = z.object({
  id: guid, patient_id: guid, recorded_at: instant,
  weight_lbs: z.number().finite().nonnegative().max(9999.9).nullable()
    .refine((value) => value === null || Number(value.toFixed(1)) === value, 'Invalid stored weight scale'),
  sbp: integer, dbp: integer, heart_rate: integer, spo2: integer,
}).strict();
export const fhirMedicationSchema = z.object({
  id: guid, patient_id: guid, name: z.string().trim().min(1), dosage: z.string().nullable(),
  frequency: z.string().nullable(), timing: z.string().nullable(), active: z.boolean().nullable(),
}).strict();
type VitalRow = z.infer<typeof fhirVitalSchema>;
type MedicationRow = z.infer<typeof fhirMedicationSchema>;
interface FhirResource { resourceType: string; id: string; [key: string]: unknown }

/** FHIR decimals are JSON numbers whose precision includes trailing zeros. Never use Number. */
export class FhirDecimal {
  readonly #token: string;
  constructor(value: string) {
    if (!/^-?\d+(?:\.\d+)?$/.test(value)) throw new Error('Invalid FHIR decimal');
    this.#token = value.replace(/^(-?)0+(?=\d)/, '$1');
    Object.freeze(this);
  }
  get token() { return this.#token; }
  toJSON(): never { throw new Error('Use serializeFhirR4 to preserve decimal precision'); }
}

/** No placeholder substitution or numeric roundtrip. Invalid/empty FHIR elements fail closed. */
export function serializeFhirR4(value: unknown): string {
  const ancestors = new Set<object>();
  const encode = (item: unknown): string => {
    if (item instanceof FhirDecimal) return item.token;
    if (typeof item === 'string' && item.trim().length) return JSON.stringify(item);
    if (typeof item === 'boolean') return String(item);
    if (typeof item === 'number' && Number.isSafeInteger(item)) return String(item);
    if (!item || typeof item !== 'object' || ancestors.has(item)) throw new Error('Invalid FHIR JSON element');
    ancestors.add(item);
    try {
      if (Array.isArray(item)) {
        if (!item.length) throw new Error('Empty FHIR array');
        return '[' + Array.from(item, encode).join(',') + ']';
      }
      if (Object.getPrototypeOf(item) !== Object.prototype) throw new Error('Unsupported FHIR object');
      const entries = Object.entries(item).filter(([, child]) => child !== undefined);
      if (!entries.length) throw new Error('Empty FHIR object');
      return '{' + entries.map(([key, child]) => JSON.stringify(key) + ':' + encode(child)).join(',') + '}';
    } finally { ancestors.delete(item); }
  };
  return encode(value);
}

// RFC4122 UUIDv5, standard URL namespace. Stable business identity, not anonymization.
function resourceId(resourceType: string, source: string): string {
  const namespace = Buffer.from('6ba7b8119dad11d180b400c04fd430c8', 'hex');
  const digest = createHash('sha1').update(namespace)
    .update('https://app.heartlandprotocol.org/fhir/identity/' + resourceType + '/' + source).digest().subarray(0, 16);
  digest[6] = (digest[6] & 0x0f) | 0x50; digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = digest.toString('hex');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}
function coding(system: string, code: string, display: string) {
  return { coding: [{ system, code, display }], text: display };
}
function quantity(value: string, unit: string, code?: string) {
  return { value: new FhirDecimal(value), unit,
    ...(code ? { system: 'http://unitsofmeasure.org', code } : {}) };
}
function identifier(kind: string, value: string) {
  return { system: 'https://app.heartlandprotocol.org/identifier/' + kind, value };
}
function validateScope(rows: { id: string; patient_id: string }[], patientId: string) {
  if (rows.some((row) => row.patient_id.toLowerCase() !== patientId)
    || new Set(rows.map((row) => row.id.toLowerCase())).size !== rows.length) {
    throw new Error('Invalid FHIR source scope or duplicate identity');
  }
}

/** A collection of read sources, not an EHR transaction, clinical review or global snapshot. */
export function buildFhirR4Collection(input: {
  patient: { id: string; fullName: string | null; patientCode: string | null };
  vitals: VitalRow[]; labs: EffectiveLabObservation[]; medications: MedicationRow[]; generatedAt?: string;
}) {
  const generatedAt = instant.parse(input.generatedAt ?? new Date().toISOString());
  const now = new Date(generatedAt);
  const patientId = guid.parse(input.patient.id).toLowerCase();
  const fullName = z.string().nullable().parse(input.patient.fullName)?.trim();
  const patientCode = z.string().nullable().parse(input.patient.patientCode)?.trim();
  const vitals = z.array(fhirVitalSchema).parse(input.vitals);
  const labs = z.array(effectiveLabObservationSchema).parse(input.labs);
  const medications = z.array(fhirMedicationSchema).parse(input.medications);
  validateScope(vitals, patientId); validateScope(labs, patientId); validateScope(medications, patientId);
  const patient: FhirResource = {
    resourceType: 'Patient', id: resourceId('Patient', patientId),
    identifier: patientCode ? [identifier('patient-code', patientCode)] : undefined,
    name: fullName ? [{ text: fullName }] : undefined,
  };
  const subject = { reference: 'urn:uuid:' + patient.id };
  const resources: FhirResource[] = [patient];
  const vitalBase = (vital: VitalRow, kind: string, code: ReturnType<typeof coding>) => ({
    resourceType: 'Observation', id: resourceId('Observation', vital.id.toLowerCase() + ':' + kind),
    identifier: [identifier('vital-observation', vital.id.toLowerCase() + ':' + kind)], status: 'unknown',
    category: [coding('http://terminology.hl7.org/CodeSystem/observation-category', 'vital-signs', 'Vital Signs')],
    code, subject, effectiveDateTime: vital.recorded_at,
    note: [{ text: 'Recorded vital sign; verification and clinical review are not confirmed.' }],
  });
  for (const vital of vitals) {
    if (vital.weight_lbs !== null) resources.push({
      ...vitalBase(vital, 'weight', coding('http://loinc.org', '29463-7', 'Body weight')),
      // The known database numeric(5,1) scale is restored, not an original lexical claim.
      valueQuantity: quantity(vital.weight_lbs.toFixed(1), 'lb', '[lb_av]'),
    });
    if (vital.heart_rate !== null) resources.push({
      ...vitalBase(vital, 'heart-rate', coding('http://loinc.org', '8867-4', 'Heart rate')),
      valueQuantity: quantity(String(vital.heart_rate), 'beats/minute', '/min'),
    });
    if (vital.spo2 !== null) resources.push({
      ...vitalBase(vital, 'spo2', coding('http://loinc.org', '59408-5', 'Oxygen saturation in Arterial blood by Pulse oximetry')),
      valueQuantity: quantity(String(vital.spo2), '%', '%'),
    });
    if (vital.sbp !== null || vital.dbp !== null) resources.push({
      ...vitalBase(vital, 'blood-pressure', coding('http://loinc.org', '85354-9', 'Blood pressure panel')),
      component: ([['sbp', '8480-6', 'Systolic blood pressure'], ['dbp', '8462-4', 'Diastolic blood pressure']] as const)
        .map(([key, code, display]) => ({ code: coding('http://loinc.org', code, display),
          ...(vital[key] === null ? { dataAbsentReason: { text: 'Not recorded in this source.' } }
            : { valueQuantity: quantity(String(vital[key]), 'mmHg', 'mm[Hg]') }) })),
    });
  }
  const groups = new Map<string, EffectiveLabObservation[]>();
  const groupKey = (lab: EffectiveLabObservation) => lab.analyte + ':' + labCollectionMicros(lab.collected_at);
  for (const lab of labs) {
    const key = groupKey(lab); const group = groups.get(key);
    if (group) group.push(lab); else groups.set(key, [lab]);
  }
  const qualities = new Map([...groups].map(([key, group]) =>
    [key, selectLatestEffectiveLab(group, patientId, group[0].analyte, now)]));
  for (const lab of labs) {
    const quality = qualities.get(groupKey(lab))!;
    const { label, unit } = LAB_OBSERVATION_FIELDS[lab.analyte];
    const identifiers = [identifier('laboratory-original-observation', lab.id)];
    if (lab.root_id) identifiers.push(identifier('laboratory-root', lab.root_id.toLowerCase()));
    if (lab.version_id) identifiers.push(identifier('laboratory-version', lab.version_id.toLowerCase()));
    if (lab.effective_lab_result_id) identifiers.push(identifier('laboratory-effective-observation', lab.effective_lab_result_id.toLowerCase() + ':' + lab.analyte));
    resources.push({
      resourceType: 'Observation', id: resourceId('Observation', lab.id), identifier: identifiers,
      status: 'unknown', category: [coding('http://terminology.hl7.org/CodeSystem/observation-category', 'laboratory', 'Laboratory')],
      code: { text: label }, subject, effectiveDateTime: lab.collected_at,
      ...(quality.state === 'available' ? { valueQuantity: quantity(lab.value!, unit) }
        : { dataAbsentReason: { text: quality.reason } }),
      note: [
        { text: 'Source status: ' + lab.status + '; ' + (lab.revision ? 'revision ' + lab.revision : 'unregistered source') + '; alert processing: ' + (lab.evaluation_status ?? 'not supplied') + '.' },
        { text: 'Source quality: ' + quality.state + '. ' + quality.reason + ' Recency, laboratory finalization and clinical review are not confirmed.' },
        ...(lab.lab_facility?.trim() ? [{ text: 'Recorded laboratory facility: ' + lab.lab_facility }] : []),
        ...(lab.notes?.trim() ? [{ text: 'Recorded source note: ' + lab.notes }] : []),
      ],
    });
  }
  for (const medication of medications) {
    const instruction = [medication.dosage, medication.frequency, medication.timing].map((part) => part?.trim()).filter(Boolean).join(' · ');
    resources.push({
      resourceType: 'MedicationStatement', id: resourceId('MedicationStatement', medication.id.toLowerCase()),
      identifier: [identifier('medication-list-record', medication.id.toLowerCase())], status: 'unknown',
      medicationCodeableConcept: { text: medication.name }, subject,
      dosage: instruction ? [{ text: instruction }] : undefined,
      note: [{ text: 'Medication-list entry; catalog active flag: ' + (medication.active === null ? 'not supplied' : medication.active) + '. Actual use, prescription, adherence and discontinuation are not confirmed.' }],
    });
  }
  if (resources.length > MAX_FHIR_RESOURCES) throw new FhirExportLimitError();
  if (new Set(resources.map((resource) => resource.id)).size !== resources.length) throw new Error('Duplicate FHIR identity');
  return {
    resourceType: 'Bundle', type: 'collection', timestamp: generatedAt,
    meta: { tag: [{ system: 'https://app.heartlandprotocol.org/fhir/tags', code: 'educational-export', display: 'HEARTLAND read-only export' }] },
    entry: resources.map((resource) => ({ fullUrl: 'urn:uuid:' + resource.id, resource })),
  };
}
