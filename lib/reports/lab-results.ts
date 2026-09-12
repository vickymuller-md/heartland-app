/** Shared laboratory report projection. Uses the caller's authenticated client and RLS. */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { LabResultRow, ReportDateRange } from './types';

// Stored units from the lab_results schema and existing lab display; no reference ranges or inferred flags.
const ANALYTES = [
  ['potassium', 'Potassium', 'mEq/L'],
  ['creatinine', 'Creatinine', 'mg/dL'],
  ['egfr', 'eGFR', 'mL/min/1.73m²'],
  ['bun', 'BUN', 'mg/dL'],
  ['bnp', 'BNP', 'pg/mL'],
  ['nt_probnp', 'NT-proBNP', 'pg/mL'],
  ['sodium', 'Sodium', 'mEq/L'],
  ['glucose', 'Glucose', 'mg/dL'],
  ['hba1c', 'HbA1c', '%'],
  ['hemoglobin', 'Hemoglobin', 'g/dL'],
  ['ferritin', 'Ferritin', 'ng/mL'],
  ['tsat', 'TSAT', '%'],
  ['ldl', 'LDL', 'mg/dL'],
] as const;
type Analyte = typeof ANALYTES[number][0];

export interface LabPanelRow extends Partial<Record<Analyte, number | null>> {
  id: string;
  patient_id: string;
  collected_at: string;
}

const LAB_COLUMNS = ['id', 'patient_id', 'collected_at', ...ANALYTES.map(([field]) => field)].join(',');
const DAY_MS = 86_400_000;

/** Date-only controls select whole UTC calendar days, including the final day. */
export function labDateBounds(range: ReportDateRange) {
  const parseDay = (value: string) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime())
      || date.toISOString().slice(0, 10) !== value) throw new Error('Invalid laboratory date range');
    return date.getTime();
  };
  const from = parseDay(range.from);
  const to = parseDay(range.to);
  if (from > to || to - from > 366 * DAY_MS) throw new Error('Invalid laboratory date range');
  return { fromInclusive: new Date(from).toISOString(), toExclusive: new Date(to + DAY_MS).toISOString() };
}

/** One report row per recorded analyte; collection timestamps are carried through unchanged. */
export function projectLabResults(panels: LabPanelRow[]): LabResultRow[] {
  for (const panel of panels) {
    if (!Number.isFinite(Date.parse(panel.collected_at))) throw new Error('Invalid laboratory collection timestamp');
  }
  return [...panels].sort((a, b) => Date.parse(b.collected_at) - Date.parse(a.collected_at) || a.id.localeCompare(b.id))
    .flatMap((panel) => ANALYTES.flatMap(([field, test_name, unit]) => {
      const value = panel[field];
      if (value == null) return [];
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid recorded laboratory value');
      return [{
        id: `${panel.id}:${field}`, patient_id: panel.patient_id, test_name, value, unit,
        collected_at: panel.collected_at, flag: null,
      }];
    }));
}

/**
 * Read all visible panels using an ID cursor, then present them by collection time.
 * Continue through short pages because a service may cap rows below our requested limit.
 * Each page remains subject to current RLS; this is not a database snapshot transaction.
 */
export async function getReportLabResults(
  supabase: SupabaseClient,
  patientIds: string[],
  range: ReportDateRange,
): Promise<LabResultRow[]> {
  if (patientIds.length === 0) return [];
  const { fromInclusive, toExclusive } = labDateBounds(range);
  const panels: LabPanelRow[] = [];
  let cursor: string | undefined;
  for (;;) {
    let query = supabase.from('lab_results').select(LAB_COLUMNS)
      .in('patient_id', [...new Set(patientIds)])
      .gte('collected_at', fromInclusive).lt('collected_at', toExclusive)
      .order('id', { ascending: true });
    if (cursor) query = query.gt('id', cursor);
    const { data, error } = await query.limit(500);
    if (error) throw error;
    const page = (data ?? []) as unknown as LabPanelRow[];
    if (page.length === 0) break;
    const nextCursor = page[page.length - 1].id;
    if (!nextCursor || (cursor && nextCursor <= cursor)) throw new Error('Laboratory pagination did not advance');
    panels.push(...page);
    cursor = nextCursor;
  }
  return projectLabResults(panels);
}
