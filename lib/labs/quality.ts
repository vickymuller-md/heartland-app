import { differenceInDays, parseISO } from 'date-fns';
import { z } from 'zod';

/** Stored units, not reference intervals or a declaration of clinical suitability. */
export const LAB_ANALYTES = {
  potassium: { label: 'Potassium', unit: 'mEq/L' },
  creatinine: { label: 'Creatinine', unit: 'mg/dL' },
  egfr: { label: 'eGFR', unit: 'mL/min/1.73m²' },
} as const;
export type LabAnalyte = keyof typeof LAB_ANALYTES;
export type LabQualityStatus = 'missing' | 'invalid' | 'stale' | 'current' | 'recency_unassessed';
export interface QualityPanel extends Partial<Record<LabAnalyte, number | null>> {
  id: string;
  collected_at: string;
  units?: Partial<Record<LabAnalyte, string>>;
}
export interface LabQuality {
  status: LabQualityStatus;
  value: number | null;
  collectedAt: string | null;
  resultId: string | null;
  unit: string;
  contextId: string;
  reason: string;
}
export interface LabQualityContext {
  id: string;
  now: Date;
  /** Caller supplies the applicable recency rule. No universal clinical cutoff. */
  isStale?: (collectedAt: string) => boolean;
}

/** Preserve the existing worklist advisory (>14 complete local days), not a medication gate. */
export function worklistLabContext(now = new Date()): LabQualityContext {
  return { id: 'legacy-worklist-advisory', now,
    isStale: (collectedAt) => differenceInDays(now, parseISO(collectedAt)) > 14 };
}

const instantSchema = z.iso.datetime({ offset: true });
function timestamp(value: string): bigint | null {
  // A timestamp must identify an instant; never silently assume the viewer's timezone.
  if (!instantSchema.safeParse(value).success) return null;
  const fraction = /\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/.exec(value)?.[1] ?? '';
  if (fraction.length > 6) return null; // PostgreSQL timestamptz precision.
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) return null;
  return BigInt(millis) * BigInt(1000) + BigInt(fraction.padEnd(6, '0').slice(3));
}

/** Normalize the offset for display without truncating the source microseconds. */
export function labCollectionUTC(value: string): string {
  if (timestamp(value) === null) throw new Error('Invalid collection timestamp');
  const fraction = /\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/.exec(value)?.[1] ?? '000';
  return new Date(value).toISOString().replace(/\.\d{3}Z$/, `.${fraction}Z`);
}

/**
 * Select per analyte, never per panel. A recent sodium-only panel cannot refresh K/Cr/eGFR.
 * Invalid newer evidence and conflicting same-time results are not replaced by an older good value.
 * Null values in partial panels do not supersede an earlier recorded value.
 */
export function assessLabAnalyte(panels: QualityPanel[], analyte: LabAnalyte, context: LabQualityContext): LabQuality {
  if (!Number.isFinite(context.now.getTime()) || !context.id) throw new Error('Invalid laboratory quality context');
  const base = { value: null, collectedAt: null, resultId: null,
    unit: LAB_ANALYTES[analyte].unit, contextId: context.id };
  const candidates = panels.filter((panel) => panel[analyte] != null);
  if (!candidates.length) return { ...base, status: 'missing', reason: 'No recorded value for this analyte.' };
  if (candidates.some((panel) => timestamp(panel.collected_at) === null)) {
    return { ...base, status: 'invalid', reason: 'Collection time is invalid or has no timezone; verify the source.' };
  }
  candidates.sort((a, b) => {
    const first = timestamp(a.collected_at)!; const second = timestamp(b.collected_at)!;
    return first === second ? a.id.localeCompare(b.id) : first > second ? -1 : 1;
  });
  const latest = candidates[0];
  const value = latest[analyte]!;
  const selected = { ...base, collectedAt: latest.collected_at, resultId: latest.id };
  if (timestamp(latest.collected_at)! > BigInt(context.now.getTime()) * BigInt(1000)) {
    return { ...selected, status: 'invalid', reason: 'Collection time is in the future; verify the source.' };
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return { ...selected, status: 'invalid', reason: 'Recorded value is invalid; verify the source.' };
  }
  const sameTime = candidates.filter((panel) => timestamp(panel.collected_at) === timestamp(latest.collected_at));
  if (sameTime.some((panel) => panel.units?.[analyte] !== undefined && panel.units[analyte] !== base.unit)) {
    return { ...selected, status: 'invalid', reason: 'Unit does not match the stored analyte unit; no conversion was assumed.' };
  }
  if (sameTime.some((panel) => panel[analyte] !== value)) {
    return { ...selected, status: 'invalid', reason: 'Conflicting values have the same collection time; reconcile the source.' };
  }
  if (!context.isStale) return { ...selected, value, status: 'recency_unassessed',
    reason: 'A recency rule for this clinical context has not been supplied.' };
  return context.isStale(latest.collected_at)
    ? { ...selected, value, status: 'stale', reason: 'Outside the stated recency window; clinical review is needed.' }
    : { ...selected, value, status: 'current', reason: 'Within the stated recency window; not confirmation of clinical suitability.' };
}

export const LAB_QUALITY_LABELS: Record<LabQualityStatus, string> = {
  missing: 'Missing', invalid: 'Invalid — verify source', stale: 'Stale (advisory)',
  current: 'Current (advisory)', recency_unassessed: 'Recency not assessed',
};

/** Missing/invalid evidence is not buried behind patients with a full recent panel. Not clinical triage. */
export function labAttentionRank(qualities: LabQuality[]): number {
  const rank: Record<LabQualityStatus, number> = { invalid: 0, missing: 0, stale: 1, recency_unassessed: 2, current: 3 };
  return Math.min(...qualities.map((quality) => rank[quality.status]));
}
