'use server';

import { createHash } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { authorize } from '@/lib/auth/authorization';
import { EDUCATION_DOMAINS } from './constants';
import type {
  EducationContextResult, EducationResponseContext, EducationResponseInput,
  EducationResponseResult,
} from './types';

// Version ordered question content, not a hand-edited release label.
const contentVersion = createHash('sha256').update(JSON.stringify(
  EDUCATION_DOMAINS.map(({ id, question }) => ({ id, question })),
)).digest('hex');
const revision = z.number().int().min(0).max(9007199254740990);
const inputSchema = z.object({
  actorId: z.string().uuid(), domainId: z.string(), requestId: z.string().uuid(),
  selectedOption: z.number().int().min(0).max(3), expectedRevision: revision,
  contentVersion: z.literal(contentVersion),
}).strict();
const contextSchema = z.object({
  actorId: z.string().uuid(), domainId: z.string(), contentVersion: z.literal(contentVersion),
  revision, attempts: z.number().int().min(0).max(32767), completed: z.boolean(),
  lastResponse: z.object({
    requestId: z.string().uuid(), baseRevision: revision,
    selectedOption: z.number().int().min(0).max(3), contentVersion: z.string().regex(/^[a-f0-9]{64}$/),
    correct: z.boolean(),
  }).strict().nullable(),
}).strict().refine((value) => value.lastResponse
  ? value.lastResponse.baseRevision + 1 === value.revision && value.attempts > 0
  : value.revision === 0);
const unknownSave = 'Saving could not be confirmed. Check saved progress before trying again.';
const conflict = 'Progress changed in another session. Reopen this module to read its current progress.';

function knownDomain(domainId: string) {
  return EDUCATION_DOMAINS.find((domain) => domain.id === domainId);
}

function parseContext(data: unknown, actorId: string, domainId: string): EducationResponseContext | null {
  const parsed = contextSchema.safeParse(data);
  return parsed.success && parsed.data.actorId === actorId && parsed.data.domainId === domainId
    ? parsed.data : null;
}

function matches(context: EducationResponseContext, input: EducationResponseInput) {
  const receipt = context.lastResponse;
  const correct = input.selectedOption === knownDomain(input.domainId)?.question.correctIndex;
  return receipt !== null && receipt.requestId === input.requestId
    && receipt.baseRevision === input.expectedRevision && receipt.selectedOption === input.selectedOption
    && receipt.contentVersion === input.contentVersion && receipt.correct === correct
    && (!correct || context.completed);
}

/** Refresh failure must not turn a known commit into an invitation to duplicate it. */
function refreshEducation() {
  try { revalidatePath('/education'); } catch { /* The receipt remains authoritative. */ }
}

export async function readEducationContext(actorId: string, domainId: string): Promise<EducationContextResult> {
  if (!z.string().uuid().safeParse(actorId).success || !knownDomain(domainId)) {
    return { status: 'error', error: 'Invalid education context.' };
  }
  try {
    const auth = await authorize('patient');
    if (!auth.authorized || auth.user.id !== actorId) {
      return { status: 'error', error: 'Your session changed or education access is unavailable. Reload the page.' };
    }
    const { data, error } = await auth.supabase.rpc('get_education_response_context', {
      p_expected_actor: actorId, p_domain_id: domainId,
    });
    const context = !error && parseContext(data, actorId, domainId);
    return context ? { status: 'ready', context }
      : { status: 'error', error: 'Current progress could not be loaded. No answer has been submitted.' };
  } catch {
    return { status: 'error', error: 'Current progress could not be loaded. Check your connection and try again.' };
  }
}

export async function submitEducationResponse(input: EducationResponseInput): Promise<EducationResponseResult> {
  if (!inputSchema.safeParse(input).success || !knownDomain(input.domainId)) {
    return { status: 'unconfirmed', error: 'Invalid response or outdated question. Reload the page.' };
  }
  try {
    const auth = await authorize('patient');
    if (!auth.authorized || auth.user.id !== input.actorId) {
      return { status: 'unconfirmed', error: 'Your session changed or education access is unavailable. Reload the page.' };
    }
    const { data, error } = await auth.supabase.rpc('submit_education_response', {
      p_expected_actor: input.actorId, p_domain_id: input.domainId, p_request_id: input.requestId,
      p_selected_option: input.selectedOption, p_expected_revision: input.expectedRevision,
      p_content_version: input.contentVersion,
    });
    if (!error && data?.status === 'conflict') return { status: 'conflict', error: conflict };
    const context = !error && data?.status === 'saved' && parseContext(data.context, input.actorId, input.domainId);
    if (!context || !matches(context, input)) return { status: 'unconfirmed', error: unknownSave };
    refreshEducation();
    return { status: 'saved', context };
  } catch {
    return { status: 'unconfirmed', error: unknownSave };
  }
}

/** Read-only: absence or a superseding response never automatically triggers a write. */
export async function recoverEducationResponse(input: EducationResponseInput): Promise<EducationResponseResult> {
  if (!inputSchema.safeParse(input).success || !knownDomain(input.domainId)) {
    return { status: 'unconfirmed', error: 'Invalid response or outdated question. Reload the page.' };
  }
  const result = await readEducationContext(input.actorId, input.domainId);
  if (result.status !== 'ready') return { status: 'unconfirmed', error: unknownSave };
  if (matches(result.context, input)) {
    refreshEducation();
    return { status: 'saved', context: result.context };
  }
  if (result.context.revision === input.expectedRevision) return { status: 'absent' };
  return { status: 'conflict', error: conflict };
}
