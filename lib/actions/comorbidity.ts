'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod/v4';

const SaveComorbiditiesSchema = z.object({
  patientId: z.string().uuid(),
  comorbidities: z.array(z.string()),
});

export async function savePatientComorbidities(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Unauthorized' };

  const parsed = SaveComorbiditiesSchema.safeParse({
    patientId: formData.get('patientId'),
    comorbidities: JSON.parse(formData.get('comorbidities') as string),
  });
  if (!parsed.success) return { error: 'Invalid input' };

  const { error } = await supabase
    .from('patients')
    .update({ comorbidities: parsed.data.comorbidities })
    .eq('id', parsed.data.patientId);

  if (error) return { error: error.message };

  revalidatePath(`/patients/${parsed.data.patientId}`);
  return { success: true };
}
