'use server';

import { authorizeProviderForPatient } from '@/lib/auth/authorization';
import { revalidatePath } from 'next/cache';
import { z } from 'zod/v4';

const SaveComorbiditiesSchema = z.object({
  patientId: z.string().uuid(),
  comorbidities: z.array(z.string().regex(/^[a-z0-9_]{1,50}$/)).max(20),
});

export async function savePatientComorbidities(formData: FormData) {
  let comorbidities: unknown;
  try {
    comorbidities = JSON.parse(String(formData.get('comorbidities') ?? ''));
  } catch {
    return { error: 'Invalid input' };
  }

  const parsed = SaveComorbiditiesSchema.safeParse({
    patientId: formData.get('patientId'),
    comorbidities,
  });
  if (!parsed.success) return { error: 'Invalid input' };

  const auth = await authorizeProviderForPatient(parsed.data.patientId);
  if (!auth.authorized) return { error: auth.error };

  const { data, error } = await auth.supabase
    .from('patients')
    .update({ comorbidities: parsed.data.comorbidities })
    .eq('id', parsed.data.patientId)
    .select('id');

  if (error || !data?.length) return { error: 'Unable to update comorbidities' };

  revalidatePath(`/patients/${parsed.data.patientId}`);
  return { success: true };
}
