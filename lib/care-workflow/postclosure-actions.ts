'use server';

import { z } from 'zod';
import { authorize } from '@/lib/auth/authorization';
import { careScopeSchema, type CareScope } from './types';
import { labCollectionMicros } from '@/lib/labs/quality';
import { postclosureContextSchema, postclosureHistoryCursorSchema, postclosureHistoryPageSchema, postclosureInputSchema,
  postclosureMatches, postclosureNeedsPageSchema, postclosurePendingPageSchema, postclosureStateSchema,
  postclosureSuccessorsPageSchema, type PostclosureInput, type PostclosureState, type PostclosurePatientPage } from './postclosure-types';

const failure = { data: null, error: 'Routing could not be verified. Recover the exact saved request and evidence before retrying; do not create a replacement ID.' } as const;
const readFailure = { data: null, error: 'The authorized routing view could not be completely verified. No conclusion about an absent need can be made. Retry the read.' } as const;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const scopeMatches = (actual: CareScope, expected: CareScope) =>
  (['actor_id', 'organization_id', 'patient_id'] as const).every((key) => same(actual[key], expected[key]));
const rpcNames = { read: 'get_care_postclosure_request', apply: 'apply_care_postclosure_request',
  cancel: 'cancel_care_postclosure_request', acknowledge: 'acknowledge_care_postclosure_request' } as const;
async function current(scope: CareScope) {
  const auth = await authorize('provider');
  return auth.authorized && same(auth.user.id, scope.actor_id) ? auth.supabase : null;
}
function decode(value: unknown, input: PostclosureInput) {
  const parsed = postclosureStateSchema.safeParse(value);
  return parsed.success && postclosureMatches(parsed.data, input) ? parsed.data : null;
}
async function operation(name: 'prepare' | keyof typeof rpcNames, input: PostclosureInput):
Promise<{ data: PostclosureState; error: null } | typeof failure> {
  if (!postclosureInputSchema.safeParse(input).success) return failure;
  try {
    const client = await current(input);
    if (!client) return failure;
    if (name !== 'read') {
      const response = await client.rpc(rpcNames.read, { p_request_id: input.request_id });
      if (!response.error) {
        const saved = decode(response.data, input);
        if (!saved) return failure;
        if (name === 'prepare') return { data: saved, error: null };
      } else if (name !== 'prepare') return failure;
    }
    const response = name === 'prepare' ? await client.rpc('prepare_care_postclosure_request', {
      p_request_id: input.request_id, p_invalidation_id: input.invalidation_id, p_work_item_id: input.work_item_id,
      p_organization_id: input.organization_id, p_patient_id: input.patient_id,
      p_expected_revision: input.expected_revision, p_expected_ownership_revision: input.expected_ownership_revision,
      p_expected_routing_revision: input.expected_routing_revision, p_previous_event_id: input.previous_event_id, p_payload: input.payload,
    }) : await client.rpc(rpcNames[name], { p_request_id: input.request_id });
    const saved = !response.error && decode(response.data, input);
    if (!saved || name === 'apply' && saved.state !== 'applied' || name === 'cancel' && saved.state === 'prepared'
      || name === 'acknowledge' && (saved.state !== 'applied' || saved.acknowledged_at === null)) return failure;
    return { data: saved, error: null };
  } catch { return failure; }
}
export async function preparePostclosure(input: PostclosureInput) { return operation('prepare', input); }
export async function recoverPostclosure(input: PostclosureInput) { return operation('read', input); }
export async function applyPostclosure(input: PostclosureInput) { return operation('apply', input); }
export async function cancelPostclosure(input: PostclosureInput) { return operation('cancel', input); }
export async function acknowledgePostclosure(input: PostclosureInput) { return operation('acknowledge', input); }

const pagedScope = careScopeSchema.extend({ after: z.guid().nullable() }).strict();
const contextInput = careScopeSchema.extend({ invalidation_id: z.guid(), work_item_id: z.guid() }).strict();
const targetInput = careScopeSchema.extend({ invalidation_id: z.guid() }).strict();
export async function loadPostclosureContext(input: z.infer<typeof contextInput>) {
  if (!contextInput.safeParse(input).success) return readFailure;
  try {
    const client = await current(input); if (!client) return readFailure;
    const response = await client.rpc('get_care_postclosure_context', { p_invalidation_id: input.invalidation_id, p_work_item_id: input.work_item_id });
    const parsed = postclosureContextSchema.safeParse(response.data);
    if (response.error || !parsed.success || !scopeMatches(parsed.data, input) || !same(parsed.data.work_item_id, input.work_item_id)
      || !same(parsed.data.snapshot.invalidation_id, input.invalidation_id)) return readFailure;
    return { data: parsed.data, error: null };
  } catch { return readFailure; }
}
export async function loadPendingPostclosure(input: CareScope & { after: string | null }) {
  if (!pagedScope.safeParse(input).success) return readFailure;
  try {
    const client = await current(input); if (!client) return readFailure;
    const response = await client.rpc('list_pending_care_postclosure_requests', {
      p_organization_id: input.organization_id, p_patient_id: input.patient_id, p_after: input.after });
    const parsed = postclosurePendingPageSchema.safeParse(response.data);
    if (response.error || !parsed.success || parsed.data.items.some((row) => !scopeMatches(row, input)
      || input.after !== null && row.request_id.toLowerCase() <= input.after.toLowerCase())) return readFailure;
    return { data: parsed.data, error: null };
  } catch { return readFailure; }
}
type Client = NonNullable<Awaited<ReturnType<typeof current>>>;
async function rawNeeds(client: Client, scope: CareScope, after: string | null) {
  const response = await client.rpc('list_care_postclosure_needs', { p_organization_id: scope.organization_id, p_after: after });
  const parsed = postclosureNeedsPageSchema.safeParse(response.data);
  if (response.error || !parsed.success || !same(parsed.data.organization_id, scope.organization_id)
    || parsed.data.items.some((row) => after !== null && row.invalidation_id.toLowerCase() <= after.toLowerCase())
    || after !== null && parsed.data.next_cursor !== null && parsed.data.next_cursor.toLowerCase() <= after.toLowerCase()) return null;
  return parsed.data;
}
export async function loadPostclosureNeeds(input: CareScope & { after: string | null }):
Promise<{ data: PostclosurePatientPage; error: null } | typeof readFailure> {
  if (!pagedScope.safeParse(input).success) return readFailure;
  try {
    const client = await current(input); if (!client) return readFailure;
    const page = await rawNeeds(client, input, input.after); if (!page) return readFailure;
    return { data: { organization_id: page.organization_id, patient_id: input.patient_id,
      items: page.items.filter((row) => same(row.patient_id, input.patient_id)), next_cursor: page.next_cursor,
      organization_counts: page.counts }, error: null };
  } catch { return readFailure; }
}
async function exactNeed(client: Client, input: z.infer<typeof targetInput>) {
  let cursor: string | null = null;
  // A bounded failure is not evidence of absence. Do not fall back to the former owner's private workflow.
  for (let pageNumber = 0; pageNumber < 128; pageNumber++) {
    const page = await rawNeeds(client, input, cursor); if (!page) return null;
    const need = page.items.find((row) => same(row.invalidation_id, input.invalidation_id));
    if (need) return same(need.patient_id, input.patient_id) ? need : null;
    if (page.next_cursor === null) return null;
    cursor = page.next_cursor;
  }
  return null;
}
export async function loadPostclosureHistory(input: CareScope & { invalidation_id: string; after: string | null }) {
  if (!targetInput.extend({ after: postclosureHistoryCursorSchema }).strict().safeParse(input).success) return readFailure;
  try {
    const client = await current(input); if (!client) return readFailure;
    const need = await exactNeed(client, input); if (!need) return readFailure;
    const response = await client.rpc('list_care_postclosure_history', { p_invalidation_id: input.invalidation_id, p_after: input.after });
    const parsed = postclosureHistoryPageSchema.safeParse(response.data);
    if (response.error || !parsed.success || !same(parsed.data.invalidation_id, input.invalidation_id)
      || parsed.data.items.some((row) => JSON.stringify(row.payload.snapshot) !== JSON.stringify(need.snapshot))
      || parsed.data.items.length > 0 && BigInt(parsed.data.items[0].receipt.routing_revision) !== BigInt(input.after ?? '0') + BigInt(1)) return readFailure;
    return { data: parsed.data, error: null };
  } catch { return readFailure; }
}
export async function loadPostclosureSuccessors(input: CareScope & { invalidation_id: string; after: string | null }) {
  if (!targetInput.extend({ after: z.guid().nullable() }).strict().safeParse(input).success) return readFailure;
  try {
    const client = await current(input); if (!client) return readFailure;
    const need = await exactNeed(client, input); if (!need) return readFailure;
    const response = await client.rpc('list_care_postclosure_successors', { p_invalidation_id: input.invalidation_id, p_after: input.after });
    const parsed = postclosureSuccessorsPageSchema.safeParse(response.data);
    if (response.error || !parsed.success || !same(parsed.data.invalidation_id, input.invalidation_id)
      || parsed.data.items.some((row) => same(row.work_item_id, need.predecessor_work_item_id)
        || input.after !== null && row.work_item_id.toLowerCase() <= input.after.toLowerCase()
        || (labCollectionMicros(row.created_at) ?? BigInt(-1)) < (labCollectionMicros(need.recorded_at) ?? BigInt(0)))) return readFailure;
    return { data: parsed.data, error: null };
  } catch { return readFailure; }
}
