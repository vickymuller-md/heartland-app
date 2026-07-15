import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { PatientDirectory } from './_components/patient-directory';

const PAGE_SIZE = 25;

function sanitizeSearch(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9@.+\- ']/g, '').slice(0, 80);
}
function maskEmail(value: string | null): string {
  if (!value || !value.includes('@')) return 'Not listed';
  const [local, domain] = value.split('@');
  return `${local.slice(0, 1)}•••@${domain}`;
}

function maskPhone(value: string | null): string {
  if (!value) return 'Not listed';
  const digits = value.replace(/\D/g, '');
  return digits.length >= 4 ? `•••-•••-${digits.slice(-4)}` : 'Masked';
}

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const query = sanitizeSearch(params.q ?? '');
  const requestedPage = Number.parseInt(params.page ?? '1', 10);
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: links, error: linkError } = await supabase
    .from('provider_patient_links')
    .select('patient_id, linked_at')
    .eq('provider_id', user.id)
    .eq('status', 'active');

  if (linkError) {
    return <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-5 text-sm font-medium text-red-900">Patient directory could not be loaded. Do not interpret this as no linked patients.</div>;
  }

  const linkMap = new Map((links ?? []).map((link) => [link.patient_id, link]));
  const patientIds = [...linkMap.keys()];
  let profilesQuery = supabase
    .from('profiles')
    .select('id, full_name, email, phone, patient_code', { count: 'exact' })
    .in('id', patientIds.length ? patientIds : ['00000000-0000-0000-0000-000000000000'])
    .order('full_name', { ascending: true })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (query) {
    const escaped = query.replaceAll('%', '\\%').replaceAll('_', '\\_');
    profilesQuery = profilesQuery.or(`full_name.ilike.%${escaped}%,email.ilike.%${escaped}%,phone.ilike.%${escaped}%,patient_code.ilike.%${escaped}%`);
  }

  const { data: profiles, count, error: profileError } = await profilesQuery;
  if (profileError) {
    return <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-5 text-sm font-medium text-red-900">Patient search failed. Try a shorter name or code.</div>;
  }

  const visibleIds = (profiles ?? []).map((profile) => profile.id);
  const { data: clinicalData } = visibleIds.length
    ? await supabase.from('patients').select('id, risk_tier, track_assignment, facility_tier').in('id', visibleIds)
    : { data: [] };
  const clinicalMap = new Map((clinicalData ?? []).map((clinical) => [clinical.id, clinical]));
  const patients = (profiles ?? []).map((profile) => {
    const clinical = clinicalMap.get(profile.id);
    return {
      id: profile.id,
      code: profile.patient_code ?? '—',
      full_name: profile.full_name ?? 'Unknown',
      email: maskEmail(profile.email),
      phone: maskPhone(profile.phone),
      risk_tier: clinical?.risk_tier ?? null,
      track_assignment: clinical?.track_assignment ?? null,
      facility_tier: clinical?.facility_tier ?? null,
      linked_at: linkMap.get(profile.id)?.linked_at ?? null,
    };
  });
  const total = count ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div><h1 className="text-2xl font-bold tracking-tight text-gray-900">Patients</h1><p className="mt-1 text-sm text-gray-500">{total} matching linked patient{total === 1 ? '' : 's'} · contact fields masked by default</p></div>
        <Link href="/patients/manage" className="inline-flex min-h-11 items-center rounded-lg border px-4 text-sm font-semibold text-blue-700">Manage access</Link>
      </div>
      <PatientDirectory patients={patients} query={query} total={total} page={page} pageSize={PAGE_SIZE} />
    </div>
  );
}
