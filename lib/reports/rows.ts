export { readRowsById as readReportRows } from '@/lib/supabase/rows';

export function exactCount(result: { count: number | null; error: unknown }): number {
  if (result.error || result.count === null) throw new Error('Report count unavailable.');
  return result.count;
}
