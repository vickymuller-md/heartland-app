"use server";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { authorize } from "@/lib/auth/authorization";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const emailSchema = z.string().trim().toLowerCase().email().max(320);

function getInviteRedirect(): string | null {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (!configured && process.env.NODE_ENV === "production") return null;

  try {
    const siteUrl = new URL(configured ?? "http://localhost:3000");
    if (
      siteUrl.protocol !== "https:" &&
      !(process.env.NODE_ENV !== "production" && siteUrl.hostname === "localhost")
    ) return null;

    const confirmationUrl = new URL("/confirm", siteUrl);
    confirmationUrl.searchParams.set("next", "/consent?invited=1");
    return confirmationUrl.toString();
  } catch {
    return null;
  }
}

export async function invitePatient(formData: FormData) {
  const auth = await authorize("provider");
  if (!auth.authorized) return { error: auth.error };

  const parsedEmail = emailSchema.safeParse(formData.get("email"));
  if (!parsedEmail.success) {
    return { error: "Please enter a valid email address" };
  }
  const patientEmail = parsedEmail.data;

  const redirectTo = getInviteRedirect();
  if (!redirectTo) return { error: "Invitation service is not configured" };

  // Create through the caller-scoped client so RLS remains authoritative.
  const { data: link, error: linkError } = await auth.supabase
    .from("provider_patient_links")
    .insert({
      provider_id: auth.user.id,
      invite_email: patientEmail,
      status: "invited",
      invite_sent_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (linkError || !link) return { error: "Unable to send invitation" };

  const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(patientEmail, {
    redirectTo,
  });

  if (error) {
    await supabaseAdmin
      .from("provider_patient_links")
      .delete()
      .eq("id", link.id)
      .eq("status", "invited");
    return { error: "Unable to send invitation" };
  }

  revalidatePath("/patients/manage");
  return { success: true };
}
