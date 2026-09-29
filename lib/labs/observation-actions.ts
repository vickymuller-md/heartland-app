'use server';

import { z } from 'zod';
import { authorize } from '@/lib/auth/authorization';
import { careScopeSchema, type CareScope } from '@/lib/care-workflow/types';
import { observationInputSchema, observationMatches, observationPendingPageSchema, observationStateSchema,
  type ObservationInput, type ObservationState, type ObservationPendingPage } from './observation-types';
import { getLabSourceContext, SOURCE_CONTEXT_UNAVAILABLE, type LabSourceContext } from './source-context';

type Result = { data: ObservationState; error: null } | { data: null; error: string };
const unconfirmed: Result = { data: null, error: 'The source command could not be confirmed. Check the same saved request; do not change its identity, revisions or payload.' };
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const rpc = { read: 'get_lab_observation_request', apply: 'apply_lab_observation',
  cancel: 'cancel_lab_observation', acknowledge: 'acknowledge_lab_observation' } as const;
function decode(data: unknown, input: ObservationInput) {
  const parsed = observationStateSchema.safeParse(data);
  return parsed.success && observationMatches(parsed.data, input) ? parsed.data : null;
}
async function operation(name: 'prepare' | keyof typeof rpc, input: ObservationInput): Promise<Result> {
  if (!observationInputSchema.safeParse(input).success) return unconfirmed;
  try {
    const auth = await authorize('provider');
    if (!auth.authorized || !same(auth.user.id, input.actor_id)) return unconfirmed;
    if (name !== 'read') {
      const current = await auth.supabase.rpc('get_lab_observation_request', { p_request_id: input.request_id });
      if (!current.error) {
        const saved = decode(current.data, input);
        if (!saved) return unconfirmed;
        if (name === 'prepare') return { data: saved, error: null };
      } else if (name !== 'prepare') return unconfirmed;
      if (name === 'prepare') {
        // A read error is NOT absence. Only immutable source identity is checked
        // here; the same-ID RPC decides replay versus fresh clinical/CAS checks.
        const context = await getLabSourceContext(auth.supabase, { actor_id: input.actor_id,
          organization_id: input.organization_id, patient_id: input.patient_id });
        const source = context.items.find(({ observation: o }) => same(o.original_lab_result_id, input.original_lab_result_id) && o.analyte === input.analyte);
        if (!source || (input.command === 'register_source' ? source.observation.root_id !== null
          && (!same(source.observation.root_id, input.root_id) || !source.source_authority_organization_id
            || !same(source.source_authority_organization_id, input.organization_id))
          : source.observation.root_id === null || !same(source.observation.root_id, input.root_id)
            || !source.source_authority_organization_id || !same(source.source_authority_organization_id, input.organization_id))) return unconfirmed;
      }
    }
    const result = name === 'prepare'
      ? input.command === 'register_source'
        ? await auth.supabase.rpc('prepare_lab_observation', { p_request_id: input.request_id, p_root_id: input.root_id,
          p_organization_id: input.organization_id, p_patient_id: input.patient_id,
          p_original_lab_result_id: input.original_lab_result_id, p_analyte: input.analyte, p_payload: input.payload })
        : await auth.supabase.rpc('prepare_lab_observation_change', { p_request_id: input.request_id, p_root_id: input.root_id,
          p_organization_id: input.organization_id, p_patient_id: input.patient_id, p_expected_revision: input.expected_revision,
          p_command: input.command, p_payload: input.payload })
      : await auth.supabase.rpc(rpc[name], { p_request_id: input.request_id });
    const saved = !result.error && decode(result.data, input);
    if (!saved || (name === 'apply' && saved.state !== 'applied') || (name === 'cancel' && saved.state === 'prepared')
      || (name === 'acknowledge' && (saved.state !== 'applied' || !saved.acknowledged_at))) return unconfirmed;
    return { data: saved, error: null };
  } catch { return unconfirmed; }
}
export async function prepareObservation(input: ObservationInput) { return operation('prepare', input); }
export async function recoverObservation(input: ObservationInput) { return operation('read', input); }
export async function applyObservation(input: ObservationInput) { return operation('apply', input); }
export async function cancelObservation(input: ObservationInput) { return operation('cancel', input); }
export async function acknowledgeObservation(input: ObservationInput) { return operation('acknowledge', input); }

export async function loadSourceContext(scope: CareScope): Promise<{ data: LabSourceContext | null; error: string | null }> {
  const failure = { data: null, error: SOURCE_CONTEXT_UNAVAILABLE };
  if (!careScopeSchema.safeParse(scope).success) return failure;
  try {
    const auth = await authorize('provider');
    if (!auth.authorized || !same(auth.user.id, scope.actor_id)) return failure;
    return { data: await getLabSourceContext(auth.supabase, scope), error: null };
  } catch { return failure; }
}
export async function loadPendingObservations(input: CareScope & { after: string | null }): Promise<{ data: ObservationPendingPage | null; error: string | null }> {
  const failure = { data: null, error: 'Your complete pending source requests could not be verified. No new command can be prepared.' };
  if (!careScopeSchema.extend({ after: z.guid().nullable() }).strict().safeParse(input).success) return failure;
  try {
    const auth = await authorize('provider');
    if (!auth.authorized || !same(auth.user.id, input.actor_id)) return failure;
    const result = await auth.supabase.rpc('list_pending_lab_observations', {
      p_organization_id: input.organization_id, p_patient_id: input.patient_id, p_after: input.after });
    const parsed = observationPendingPageSchema.safeParse(result.data);
    if (result.error || !parsed.success || parsed.data.items.some((item) =>
      !(['actor_id', 'organization_id', 'patient_id'] as const).every((key) => same(item[key], input[key]))
      || (input.after !== null && item.request_id.toLowerCase() <= input.after.toLowerCase()))) return failure;
    return { data: parsed.data, error: null };
  } catch { return failure; }
}
