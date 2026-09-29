'use server';

import { z } from 'zod';
import { authorize } from '@/lib/auth/authorization';
import { careScopeSchema, type CareScope } from './types';
import { submissionIntentInputSchema, submissionIntentMatches, submissionIntentPageSchema, submissionIntentStateSchema,
  type SubmissionIntentInput, type SubmissionIntentState, type SubmissionIntentPage } from './submission-intent-types';

type Result = { data: SubmissionIntentState; error: null } | { data: null; error: string };
const failure = { data: null, error: 'The follow-up intention could not be confirmed. Recover the same identity without resending values or replacing its frozen request.' } as const;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
function decode(value: unknown, input: SubmissionIntentInput) {
  const parsed = submissionIntentStateSchema.safeParse(value);
  return parsed.success && submissionIntentMatches(parsed.data, input) ? parsed.data : null;
}
async function operation(name: 'prepare' | 'read' | 'cancel', input: SubmissionIntentInput): Promise<Result> {
  if (!submissionIntentInputSchema.safeParse(input).success) return failure;
  try {
    const auth = await authorize('provider');
    if (!auth.authorized || !same(auth.user.id, input.actor_id)) return failure;
    if (name !== 'read') {
      const response = await auth.supabase.rpc('get_lab_followup_intent', { p_intent_id: input.intent_id });
      if (!response.error) {
        const saved = decode(response.data, input);
        if (!saved) return failure;
        if (name === 'prepare') return { data: saved, error: null };
      } else if (name !== 'prepare') return failure;
      // Failed reads never establish absence. SQL resolves same-ID replay/freshness.
    }
    const response = name === 'prepare' ? await auth.supabase.rpc('prepare_lab_followup_intent', {
      p_intent_id: input.intent_id, p_work_item_id: input.work_item_id, p_organization_id: input.organization_id,
      p_patient_id: input.patient_id, p_submission_request_id: input.submission_request_id,
      p_expected_revision: input.expected_revision, p_expected_ownership_revision: input.expected_ownership_revision, p_payload: input.payload,
    }) : await auth.supabase.rpc(name === 'read' ? 'get_lab_followup_intent' : 'cancel_lab_followup_intent', { p_intent_id: input.intent_id });
    const saved = !response.error && decode(response.data, input);
    // A winning save leaves a prepared saved_not_linked intention, not a cancellation.
    if (!saved || (name === 'cancel' && saved.state === 'prepared' && saved.submission.status !== 'saved_not_linked')) return failure;
    return { data: saved, error: null };
  } catch { return failure; }
}
export async function prepareSubmissionIntent(input: SubmissionIntentInput) { return operation('prepare', input); }
export async function recoverSubmissionIntent(input: SubmissionIntentInput) { return operation('read', input); }
export async function cancelSubmissionIntent(input: SubmissionIntentInput) { return operation('cancel', input); }

export async function loadPendingSubmissionIntents(input: CareScope & { after: string | null }): Promise<{ data: SubmissionIntentPage | null; error: string | null }> {
  if (!careScopeSchema.extend({ after: z.guid().nullable() }).strict().safeParse(input).success) return failure;
  try {
    const auth = await authorize('provider');
    if (!auth.authorized || !same(auth.user.id, input.actor_id)) return failure;
    const response = await auth.supabase.rpc('list_pending_lab_followup_intents', {
      p_organization_id: input.organization_id, p_patient_id: input.patient_id, p_after: input.after });
    const page = submissionIntentPageSchema.safeParse(response.data);
    if (response.error || !page.success || page.data.items.some((item) =>
      !(['actor_id', 'organization_id', 'patient_id'] as const).every((key) => same(item[key], input[key]))
      || input.after !== null && item.intent_id.toLowerCase() <= input.after.toLowerCase())) return failure;
    return { data: page.data, error: null };
  } catch { return failure; }
}
