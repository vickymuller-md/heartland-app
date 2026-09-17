'use server';

/**
 * Professional teach-back -- Server Actions (migration 00040)
 *
 * A teach-back is recorded by a professional who holds the `educate`
 * authorization in an organization that serves the patient. It is a separate
 * record from the patient self-assessment in `education_progress`, which this
 * file never touches.
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { authorize } from '@/lib/auth/authorization';
import { EDUCATION_DOMAINS } from './constants';
import {
  TEACHBACK_METHODS,
  TEACHBACK_OUTCOMES,
  TEACHBACK_REASON_REQUIRED,
} from './types';

export interface TeachbackActionState {
  success?: boolean;
  error?: string;
}

const DOMAIN_IDS = EDUCATION_DOMAINS.map((domain) => domain.id);

const teachbackSchema = z
  .object({
    patientId: z.uuid(),
    domainId: z.string().refine((value) => DOMAIN_IDS.includes(value), {
      message: 'Unknown education domain',
    }),
    outcome: z.enum(TEACHBACK_OUTCOMES),
    reason: z.string().trim().max(1000).optional(),
    method: z.enum(TEACHBACK_METHODS).optional(),
    caregiverPresent: z.boolean().optional(),
  })
  .refine(
    (value) =>
      !TEACHBACK_REASON_REQUIRED.includes(value.outcome) ||
      (value.reason?.length ?? 0) >= 3,
    {
      message: 'Deferring or marking not applicable requires a documented reason',
      path: ['reason'],
    },
  );

export type RecordTeachBackInput = z.input<typeof teachbackSchema>;

/**
 * Records one teach-back event. The RPC chooses the organization where the
 * actor actually holds `educate`, writes `verified_by` from the session, and
 * refuses a deferral without a reason.
 */
export async function recordTeachBack(
  input: RecordTeachBackInput,
): Promise<TeachbackActionState> {
  const parsed = teachbackSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid teach-back' };
  }

  const auth = await authorize('provider');
  if (!auth.authorized) return { error: auth.error };

  const { error } = await auth.supabase.rpc('record_education_teachback', {
    p_patient_id: parsed.data.patientId,
    p_domain_id: parsed.data.domainId,
    p_outcome: parsed.data.outcome,
    p_reason: parsed.data.reason ?? null,
    p_method: parsed.data.method ?? null,
    p_caregiver_present: parsed.data.caregiverPresent ?? null,
  });

  if (error) {
    if (error.code === '42501') {
      return {
        error:
          "You do not hold the education authorization for this patient's organization.",
      };
    }
    if (error.code === '22023') {
      return {
        error: 'This teach-back was refused: a documented reason is required.',
      };
    }
    return { error: 'This teach-back could not be recorded.' };
  }

  revalidatePath(`/patients/${parsed.data.patientId}`);
  revalidatePath('/education');
  return { success: true };
}
