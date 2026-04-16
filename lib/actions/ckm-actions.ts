'use server';

import { createClient } from '@/lib/supabase/server';
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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Unauthorized' };

  const parsed = UpdateCkmStageSchema.safeParse({ patientId, stage });
  if (!parsed.success) return { error: 'Invalid input' };

  // Verify provider is linked to patient
  const { data: link } = await supabase
    .from('provider_patient_links')
    .select('id')
    .eq('provider_id', user.id)
    .eq('patient_id', parsed.data.patientId)
    .eq('status', 'active')
    .maybeSingle();

  if (!link) return { error: 'Not linked to this patient' };

  const { error } = await supabase
    .from('patients')
    .update({ ckm_stage: parsed.data.stage })
    .eq('id', parsed.data.patientId);

  if (error) return { error: error.message };

  revalidatePath(`/patients/${parsed.data.patientId}`);
  return { success: true };
}
