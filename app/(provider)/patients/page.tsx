import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { PatientDirectory } from "./_components/patient-directory";

export default async function PatientsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Step 1: Get linked patient IDs
  const { data: links } = await supabase
    .from("provider_patient_links")
    .select("patient_id, linked_at")
    .eq("provider_id", user.id)
    .eq("status", "active");

  if (!links || links.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">Patients</h1>
        <p className="text-gray-500">No patients linked yet.</p>
      </div>
    );
  }

  const patientIds = links.map((l) => l.patient_id);

  // Step 2: Get profiles for those patient IDs
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name, email, phone, address, patient_code")
    .in("id", patientIds);

  // Step 3: Get patient clinical data
  const { data: clinicalData } = await supabase
    .from("patients")
    .select("id, risk_tier, track_assignment, facility_tier")
    .in("id", patientIds);

  // Merge into a single list
  const profileMap = new Map(profiles?.map((p) => [p.id, p]) ?? []);
  const clinicalMap = new Map(clinicalData?.map((c) => [c.id, c]) ?? []);
  const linkMap = new Map(links.map((l) => [l.patient_id, l]));

  const patients = patientIds.map((pid) => {
    const profile = profileMap.get(pid);
    const clinical = clinicalMap.get(pid);
    const link = linkMap.get(pid);

    return {
      id: pid,
      code: profile?.patient_code ?? "—",
      full_name: profile?.full_name ?? "Unknown",
      email: profile?.email ?? "—",
      phone: profile?.phone ?? "—",
      address: profile?.address ?? "—",
      risk_tier: clinical?.risk_tier ?? null,
      track_assignment: clinical?.track_assignment ?? null,
      facility_tier: clinical?.facility_tier ?? null,
      linked_at: link?.linked_at ?? null,
    };
  });

  // Sort by name
  patients.sort((a, b) => a.full_name.localeCompare(b.full_name));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">
          Patients
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          {patients.length} patient{patients.length !== 1 ? "s" : ""} linked to
          your practice
        </p>
      </div>

      <PatientDirectory patients={patients} />
    </div>
  );
}
