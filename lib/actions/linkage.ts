"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

const VALID_CODE_CHARS = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;

export async function requestLinkage(formData: FormData) {
  // 1. Verify caller is authenticated
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  // 2. Normalize and validate provider code
  const rawCode = formData.get("provider_code") as string;
  if (!rawCode) return { error: "Please enter a provider code" };
  const code = rawCode.toUpperCase().trim();

  if (!VALID_CODE_CHARS.test(code)) {
    return { error: "Invalid code format" };
  }

  // 3. Look up provider by code
  const { data: provider, error: providerError } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("provider_code", code)
    .eq("role", "provider")
    .maybeSingle();

  if (providerError) return { error: "An error occurred. Please try again." };
  if (!provider) {
    return { error: "Provider not found. Please check the code and try again." };
  }

  // 4. Check for existing link
  const { data: existingLink } = await supabase
    .from("provider_patient_links")
    .select("id, status")
    .eq("provider_id", provider.id)
    .eq("patient_id", user.id)
    .maybeSingle();

  if (existingLink) {
    if (existingLink.status === "active") {
      return { error: "You are already linked to this provider" };
    }
    if (existingLink.status === "pending") {
      return { error: "A linkage request is already pending with this provider" };
    }
  }

  // 5. Create pending linkage request
  const { error: insertError } = await supabase
    .from("provider_patient_links")
    .insert({
      provider_id: provider.id,
      patient_id: user.id,
      status: "pending",
    });

  if (insertError) return { error: insertError.message };

  revalidatePath("/link-provider");
  return { success: true, provider_name: provider.full_name };
}

export async function acceptLinkage(linkId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { error, count } = await supabase
    .from("provider_patient_links")
    .update({
      status: "active",
      linked_at: new Date().toISOString(),
    })
    .eq("id", linkId)
    .eq("provider_id", user.id)
    .eq("status", "pending");

  if (error) return { error: error.message };

  revalidatePath("/patients/manage");
  return { success: true };
}

export async function rejectLinkage(linkId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("provider_patient_links")
    .update({ status: "rejected" })
    .eq("id", linkId)
    .eq("provider_id", user.id)
    .eq("status", "pending");

  if (error) return { error: error.message };

  revalidatePath("/patients/manage");
  return { success: true };
}
