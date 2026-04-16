"use server";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function invitePatient(formData: FormData) {
  // 1. Verify the caller is authenticated
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  // 2. Verify the caller is a provider
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "provider") return { error: "Unauthorized" };

  // 3. Validate email input
  const patientEmail = formData.get("email") as string;
  if (!patientEmail || typeof patientEmail !== "string" || !patientEmail.includes("@")) {
    return { error: "Please enter a valid email address" };
  }

  // 4. Create an invite record in provider_patient_links
  const { error: linkError } = await supabaseAdmin
    .from("provider_patient_links")
    .insert({
      provider_id: user.id,
      invite_email: patientEmail,
      status: "invited",
      invite_sent_at: new Date().toISOString(),
    });

  if (linkError) return { error: linkError.message };

  // 5. Send invite email via admin API
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

  const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(
    patientEmail,
    {
      data: {
        role: "patient",
        invited_by_provider: user.id,
        invited_by_name: profile.full_name,
      },
      redirectTo: `${siteUrl}/register?invite_provider=${user.id}`,
    }
  );

  if (error) return { error: error.message };

  revalidatePath("/patients/manage");
  return { success: true };
}
