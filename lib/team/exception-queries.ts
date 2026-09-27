import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { exceptionPageSchema, EXCEPTION_LOAD_ERROR, type ExceptionResult } from './operational-exceptions';

export const exceptionRequestSchema = z.object({
  organizationId: z.uuid(), after: z.string().min(1).max(200).nullable().default(null),
});

export async function getOperationalExceptions(
  supabase: SupabaseClient, input: z.input<typeof exceptionRequestSchema>,
): Promise<ExceptionResult> {
  const request = exceptionRequestSchema.safeParse(input);
  if (!request.success) return { data: null, error: EXCEPTION_LOAD_ERROR };
  try {
    const { data, error } = await supabase.rpc('get_operational_exceptions', {
      p_organization_id: request.data.organizationId, p_after: request.data.after, p_limit: 25,
    });
    if (error) return { data: null, error: EXCEPTION_LOAD_ERROR };
    const parsed = exceptionPageSchema.safeParse(data);
    return parsed.success ? { data: parsed.data, error: null } : { data: null, error: EXCEPTION_LOAD_ERROR };
  } catch {
    return { data: null, error: EXCEPTION_LOAD_ERROR };
  }
}
