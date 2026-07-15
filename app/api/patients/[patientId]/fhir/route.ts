import { NextResponse } from 'next/server';
import { authorizeProviderForPatient } from '@/lib/auth/authorization';
import { buildFhirR4Collection } from '@/lib/interoperability/fhir-r4';
import { trackProductEvent } from '@/lib/product-analytics/actions';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ patientId: string }> }) {
  const { patientId } = await params;
  const auth = await authorizeProviderForPatient(patientId);
  if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.error === 'Not authenticated' ? 401 : 403 });

  const [profileResult, vitalsResult, labsResult, medicationsResult] = await Promise.all([
    auth.supabase.from('profiles').select('id, full_name, patient_code').eq('id', patientId).single(),
    auth.supabase.from('vitals').select('id, recorded_at, weight_lbs, sbp, dbp, heart_rate, spo2').eq('patient_id', patientId).order('recorded_at', { ascending: false }).limit(100),
    auth.supabase.from('lab_results').select('id, collected_at, potassium, creatinine, egfr, sodium').eq('patient_id', patientId).order('collected_at', { ascending: false }).limit(100),
    auth.supabase.from('medications').select('id, name, dosage, frequency, timing, active, created_at').eq('patient_id', patientId).order('created_at', { ascending: false }).limit(100),
  ]);
  if (profileResult.error || vitalsResult.error || labsResult.error || medicationsResult.error) {
    return NextResponse.json({ error: 'FHIR export could not be assembled' }, { status: 500 });
  }

  const bundle = buildFhirR4Collection({
    patient: {
      id: profileResult.data.id,
      fullName: profileResult.data.full_name ?? 'Patient',
      patientCode: profileResult.data.patient_code,
    },
    vitals: vitalsResult.data ?? [],
    labs: labsResult.data ?? [],
    medications: medicationsResult.data ?? [],
  });
  const resourceCount = bundle.entry.length;
  const { error: auditError } = await auth.supabase.from('data_export_events').insert({
    provider_id: auth.user.id,
    patient_id: patientId,
    format: 'fhir-r4-json',
    resource_count: resourceCount,
  });
  if (auditError) return NextResponse.json({ error: 'Export audit could not be recorded' }, { status: 500 });
  await trackProductEvent({ eventName: 'fhir_export_created', area: 'interoperability' });

  return new NextResponse(JSON.stringify(bundle, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/fhir+json; charset=utf-8',
      'Content-Disposition': `attachment; filename="heartland-fhir-r4-${new Date().toISOString().slice(0, 10)}.json"`,
      'Cache-Control': 'private, no-store, max-age=0, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
