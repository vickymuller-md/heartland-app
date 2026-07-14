'use server';

import { authorizeProviderForPatient } from '@/lib/auth/authorization';
import { revalidatePath } from 'next/cache';
import { z } from 'zod/v4';

const UpdateCkmStageSchema = z.object({
  patientId: z.string().uuid(),
  stage: z.number().int().min(0).max(4),
});

/**
 * Update a patient's CKM Syndrome Stage.
 * RLS ensures the provider is linked to this patient via provider_patient_links.
 */
export async function updateCkmStage(patientId: string, stage: number) {
  const parsed = UpdateCkmStageSchema.safeParse({ patientId, stage });
  if (!parsed.success) return { error: 'Invalid input' };

  const auth = await authorizeProviderForPatient(parsed.data.patientId);
  if (!auth.authorized) return { error: auth.error };

  const { data, error } = await auth.supabase
    .from('patients')
    .update({ ckm_stage: parsed.data.stage })
    .eq('id', parsed.data.patientId)
    .select('id');

  if (error || !data?.length) return { error: 'Unable to update CKM stage' };

  revalidatePath(`/patients/${parsed.data.patientId}`);
  return { success: true };
}
