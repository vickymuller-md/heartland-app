import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { authorizeProviderForPatient } from '@/lib/auth/authorization';
import { buildFhirR4Collection, serializeFhirR4, fhirVitalSchema, fhirMedicationSchema, FhirExportLimitError } from '@/lib/interoperability/fhir-r4';
import { getEffectiveLabObservations } from '@/lib/labs/effective';
import { trackProductEvent } from '@/lib/product-analytics/actions';

export const dynamic = 'force-dynamic';
const noStore = { 'Cache-Control': 'private, no-store, max-age=0, must-revalidate', 'X-Content-Type-Options': 'nosniff' };
const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers: noStore });

/** Complete keyset traversal; separate tables do not claim one transactional snapshot. */
async function readRows<T extends { id: string; patient_id: string }>(
  client: SupabaseClient, table: 'vitals' | 'medications', columns: string, patientId: string, schema: z.ZodType<T>,
): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | null = null;
  for (;;) {
    let query = client.from(table).select(columns).eq('patient_id', patientId).order('id', { ascending: true }).limit(250);
    if (cursor !== null) query = query.gt('id', cursor);
    const { data, error } = await query;
    if (error || !Array.isArray(data) || data.length > 250) throw new Error('Source page unavailable');
    const page = z.array(schema).parse(data);
    for (const row of page) {
      const id = row.id.toLowerCase();
      if (row.patient_id.toLowerCase() !== patientId || (cursor !== null && id <= cursor)) throw new Error('Source page scope mismatch');
      cursor = id;
      rows.push(row);
    }
    if (page.length < 250) return rows;
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ patientId: string }> }) {
  try {
    const { patientId: rawPatientId } = await params;
    const patientId = rawPatientId.toLowerCase();
    const expectedActor = request.headers.get('X-Heartland-Expected-Actor');
    if (!z.guid().safeParse(expectedActor).success) return fail('Reload the patient page before exporting.', 400);
    const auth = await authorizeProviderForPatient(patientId);
    if (!auth.authorized) return fail(auth.error, auth.error === 'Not authenticated' ? 401 : 403);
    if (auth.user.id.toLowerCase() !== expectedActor!.toLowerCase()) return fail('Export session changed. Reload the patient page.', 403);
    const [profileResult, vitals, labs, medications] = await Promise.all([
      auth.supabase.from('profiles').select('id, full_name, patient_code').eq('id', patientId).single(),
      readRows(auth.supabase, 'vitals', 'id, patient_id, recorded_at, weight_lbs, sbp, dbp, heart_rate, spo2', patientId, fhirVitalSchema),
      getEffectiveLabObservations(auth.supabase, [patientId], auth.user.id),
      readRows(auth.supabase, 'medications', 'id, patient_id, name, dosage, frequency, timing, active', patientId, fhirMedicationSchema),
    ]);
    if (profileResult.error || !profileResult.data || profileResult.data.id.toLowerCase() !== patientId) throw new Error('Profile unavailable');
    const bundle = buildFhirR4Collection({
      patient: { id: profileResult.data.id, fullName: profileResult.data.full_name, patientCode: profileResult.data.patient_code },
      vitals, labs, medications, // The builder's quality clock is captured after the complete read.
    });
    const body = serializeFhirR4(bundle);
    const { error: auditError } = await auth.supabase.from('data_export_events').insert({
      provider_id: auth.user.id, patient_id: patientId, format: 'fhir-r4-json', resource_count: bundle.entry.length,
    });
    if (auditError) return fail('Export audit could not be recorded. No file was created.', 500);
    // Preparation analytics, not proof of browser delivery or a substitute for the audit above.
    await trackProductEvent({ eventName: 'fhir_export_created', area: 'interoperability' });
    const finalAuth = await authorizeProviderForPatient(patientId);
    if (!finalAuth.authorized || finalAuth.user.id.toLowerCase() !== auth.user.id.toLowerCase()) return fail('Export authorization changed. Reload the patient page.', 403);
    return new NextResponse(body, {
      status: 200,
      headers: { ...noStore, 'Content-Type': 'application/fhir+json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="heartland-fhir-r4-' + bundle.timestamp.slice(0, 10) + '.json"',
        'X-Heartland-Export-Actor': auth.user.id, 'X-Heartland-Export-Patient': patientId },
    });
  } catch (error) {
    if (error instanceof FhirExportLimitError) return fail(error.message, 413);
    return fail('FHIR export could not be assembled. No partial file was created.', 500);
  }
}
