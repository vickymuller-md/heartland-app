import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getEffectiveLabObservations, effectiveLabObservationSchema, selectLatestEffectiveLab } from '@/lib/labs/effective';
import { LAB_ANALYTES, type LabAnalyte } from '@/lib/labs/quality';
import type { SelectedLabs } from './types';

const guid = z.guid();
const profileSchema = z.object({ id: guid, full_name: z.string().nullable(), email: z.string().nullable(),
  phone: z.string().nullable(), patient_code: z.string().nullable() }).strict();
const vitalSchema = z.object({ id: guid, patient_id: guid, weight_lbs: z.number().finite().nullable(),
  sbp: z.number().finite().nullable(), dbp: z.number().finite().nullable(), heart_rate: z.number().finite().nullable(),
  spo2: z.number().finite().nullable(), recorded_at: z.iso.datetime({ offset: true }) }).strict();
const medicationSchema = z.object({ id: guid, patient_id: guid, name: z.string().min(1), dosage: z.string().nullable(), frequency: z.string().nullable() }).strict();
export type PatientMatch = Omit<z.infer<typeof profileSchema>, 'full_name'> & { full_name: string; risk_tier: string | null };
export interface SelectedPatientData {
  patient: PatientMatch;
  actorId: string;
  latestVitals: z.infer<typeof vitalSchema> | null;
  laboratorySnapshots: SelectedLabs | null; // null = not requested by this tool, not missing sources.
  sourceReadAt: string;
  medications: z.infer<typeof medicationSchema>[];
}

function canonicalDecimal(value: string): string | null {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(value);
  if (!match) return null;
  let digits = (match[2] + (match[3] ?? '')).replace(/^0+/, '');
  if (!digits) return '0';
  let exponent = BigInt(match[4] ?? 0) - BigInt(match[3]?.length ?? 0);
  const trailing = /0+$/.exec(digits)?.[0].length ?? 0;
  if (trailing) { digits = digits.slice(0, -trailing); exponent += BigInt(trailing); }
  return match[1] + digits + 'e' + exponent;
}

/** Admit only an exact decimal roundtrip; retained source text still includes its original scale. */
export function losslessLabNumber(value: string): number | null {
  if (!/^-?\d+(?:\.\d+)?$/.test(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && canonicalDecimal(value) === canonicalDecimal(String(number)) ? number : null;
}

export function selectChecklistLabs(raw: unknown, patientId: string, now = new Date()): SelectedLabs {
  const labs = z.array(effectiveLabObservationSchema).parse(raw);
  if (!guid.safeParse(patientId).success || labs.some((lab) => lab.patient_id.toLowerCase() !== patientId.toLowerCase())
    || new Set(labs.map((lab) => lab.id)).size !== labs.length) throw new Error('Invalid laboratory source scope');
  return Object.fromEntries((Object.keys(LAB_ANALYTES) as LabAnalyte[]).map((analyte) => {
    const selected = selectLatestEffectiveLab(labs, patientId, analyte, now);
    const observation = selected.observation ? { ...selected.observation, notes: null, lab_facility: null } : null;
    const prefill = selected.state === 'available' ? losslessLabNumber(observation!.value!) : null;
    return [analyte, { state: selected.state === 'available' && prefill === null ? 'precision-withheld' : selected.state,
      reason: selected.state === 'available' && prefill === null
        ? 'Automatic prefill withheld: this numeric form cannot preserve the recorded decimal value. Verify the source before manual entry.' : selected.reason,
      observation, prefill }];
  })) as SelectedLabs;
}

export class PatientSelectionSessionError extends Error {}
export async function verifySelectionActor(client: SupabaseClient, actorId: string) {
  const { data, error } = await client.auth.getUser();
  if (!guid.safeParse(actorId).success || error || data.user?.id !== actorId) throw new PatientSelectionSessionError('Patient selection session changed. Reload the page.');
}

async function verifyClinicalReadAuthority(client: SupabaseClient, patientId?: string) {
  const { data, error } = patientId
    ? await client.rpc('provider_has_patient', { p_patient_id: patientId })
    : await client.rpc('provider_aal2');
  if (error || data !== true) throw new PatientSelectionSessionError('Patient access could not be verified. Reload the page.');
}

async function pages<T extends { id: string }>(client: SupabaseClient, table: string, columns: string,
  schema: z.ZodType<T>, filter: (query: ReturnType<ReturnType<SupabaseClient['from']>['select']>) => ReturnType<ReturnType<SupabaseClient['from']>['select']>) {
  const rows: T[] = []; let cursor: string | null = null;
  for (;;) {
    let query = filter(client.from(table).select(columns)).order('id', { ascending: true }).limit(250);
    if (cursor) query = query.gt('id', cursor);
    const { data, error } = await query;
    if (error || !Array.isArray(data) || data.length > 250) throw new Error('Patient sources unavailable');
    const page = z.array(schema).parse(data);
    for (const row of page) {
      if (cursor && row.id.toLowerCase() <= cursor) throw new Error('Patient source ordering mismatch');
      cursor = row.id.toLowerCase(); rows.push(row);
    }
    if (page.length < 250) return rows;
  }
}

export async function readPatientDirectory(client: SupabaseClient, actorId: string): Promise<PatientMatch[]> {
  await verifySelectionActor(client, actorId);
  await verifyClinicalReadAuthority(client);
  const readLinks = () => pages(client, 'provider_patient_links', 'id, provider_id, patient_id',
    z.object({ id: guid, provider_id: guid, patient_id: guid }).strict(),
    (query) => query.eq('provider_id', actorId).eq('status', 'active'));
  const links = await readLinks();
  if (links.some((link) => link.provider_id !== actorId) || new Set(links.map((link) => link.patient_id)).size !== links.length) throw new Error('Patient directory scope mismatch');
  const directory: PatientMatch[] = [];
  for (let offset = 0; offset < links.length; offset += 250) {
    const ids = links.slice(offset, offset + 250).map((link) => link.patient_id);
    const [profiles, patients] = await Promise.all([
      pages(client, 'profiles', 'id, full_name, email, phone, patient_code', profileSchema, (query) => query.in('id', ids)),
      pages(client, 'patients', 'id, risk_tier', z.object({ id: guid, risk_tier: z.string().nullable() }).strict(), (query) => query.in('id', ids)),
    ]);
    if (profiles.length !== ids.length || profiles.some((profile) => !ids.includes(profile.id))
      || patients.some((patient) => !ids.includes(patient.id))) throw new Error('Patient directory incomplete');
    const risks = new Map(patients.map((patient) => [patient.id, patient.risk_tier]));
    directory.push(...profiles.map((profile) => ({ ...profile, full_name: profile.full_name || 'Name not recorded', risk_tier: risks.get(profile.id) ?? null })));
  }
  const currentLinks = await readLinks();
  if (JSON.stringify(links) !== JSON.stringify(currentLinks)) throw new PatientSelectionSessionError('Patient links changed during the read. Reload the page.');
  await verifyClinicalReadAuthority(client);
  await verifySelectionActor(client, actorId);
  return directory;
}

export async function readPatientSelection(client: SupabaseClient, patient: PatientMatch, actorId: string,
  includeLaboratories = false): Promise<SelectedPatientData> {
  await verifySelectionActor(client, actorId);
  await verifyClinicalReadAuthority(client, patient.id);
  const [vitalResult, medications, laboratories] = await Promise.all([
    client.from('vitals').select('id, patient_id, weight_lbs, sbp, dbp, heart_rate, spo2, recorded_at')
      .eq('patient_id', patient.id).order('recorded_at', { ascending: false }).order('id', { ascending: true }).limit(1),
    pages(client, 'medications', 'id, patient_id, name, dosage, frequency', medicationSchema,
      (query) => query.eq('patient_id', patient.id).eq('active', true)),
    includeLaboratories ? getEffectiveLabObservations(client, [patient.id], actorId) : Promise.resolve(null),
  ]);
  if (vitalResult.error || !Array.isArray(vitalResult.data)) throw new Error('Patient vitals unavailable');
  const vitals = z.array(vitalSchema).max(1).parse(vitalResult.data);
  if ([...vitals, ...medications].some((row) => row.patient_id !== patient.id)) throw new Error('Patient source scope mismatch');
  const sourceReadAt = new Date().toISOString();
  const laboratorySnapshots = laboratories === null ? null : selectChecklistLabs(laboratories, patient.id, new Date(sourceReadAt));
  await verifyClinicalReadAuthority(client, patient.id);
  await verifySelectionActor(client, actorId);
  return { patient, actorId, latestVitals: vitals[0] ?? null, laboratorySnapshots, sourceReadAt, medications };
}
