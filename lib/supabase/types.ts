/**
 * Shared Supabase relational-query helpers.
 *
 * Supabase-js currently types nested `select('...,profiles(full_name)')` joins
 * as `unknown`, forcing callers to double-cast (`as unknown as T`). These
 * helpers centralize the narrowing so each call site stays readable.
 *
 * When the project adopts `supabase gen types` in the future, replace these
 * with the generated `Database` types and delete this file.
 */

/** Single-row join result: `.profiles(full_name)` comes back as one object (or null). */
export type ProfileJoin = { full_name: string | null } | null;

/** Narrow an unknown relational payload to a shape whose `full_name` we care about. */
export function extractFullName(profile: unknown): string | null {
  if (!profile || typeof profile !== 'object') return null;
  const p = profile as { full_name?: unknown };
  return typeof p.full_name === 'string' ? p.full_name : null;
}

/**
 * Narrow the nested `patients.profiles.full_name` payload used by the alert
 * inbox query. Returns the provider-visible patient name or null.
 */
export function extractPatientFullName(patients: unknown): string | null {
  if (!patients || typeof patients !== 'object') return null;
  const p = patients as { profiles?: unknown };
  return extractFullName(p.profiles);
}
