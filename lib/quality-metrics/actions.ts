'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod/v4';
import type { MetricKey } from './types';

const VALID_METRIC_KEYS: MetricKey[] = [
  'contact_48_72h',
  'gdmt_discharge_rate',
  'followup_7day',
  'readmission_30day',
  'teachback_documentation',
];

const UpsertSchema = z.object({
  metric_key: z.enum(VALID_METRIC_KEYS as [MetricKey, ...MetricKey[]]),
  period_month: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be yyyy-MM-dd format'),
  numerator: z.number().int().min(0),
  denominator: z.number().int().min(1),
  notes: z.string().optional(),
});

/**
 * Upsert a quality metric record for the authenticated provider.
 * Computes rate_pct from numerator/denominator.
 * Upserts on (provider_id, metric_key, period_month) unique constraint.
 */
export async function upsertQualityMetricRecord(data: {
  metric_key: string;
  period_month: string;
  numerator: number;
  denominator: number;
  notes?: string;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Unauthorized' };

  const parsed = UpsertSchema.safeParse(data);
  if (!parsed.success) return { error: 'Invalid input' };

  const { metric_key, period_month, numerator, denominator, notes } = parsed.data;

  // Compute rate -- denominator already validated >= 1
  const rate_pct = (numerator / denominator) * 100;

  const { error } = await supabase
    .from('quality_metric_records')
    .upsert(
      {
        provider_id: user.id,
        metric_key,
        period_month,
        numerator,
        denominator,
        rate_pct,
        notes: notes ?? null,
      },
      { onConflict: 'provider_id,metric_key,period_month' },
    );

  if (error) return { error: error.message };

  revalidatePath('/quality-metrics');
  return { success: true };
}
