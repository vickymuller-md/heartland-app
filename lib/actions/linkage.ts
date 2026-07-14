"use server";

import { authorize } from "@/lib/auth/authorization";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const VALID_CODE_CHARS = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;

export async function requestLinkage(formData: FormData) {
  const auth = await authorize("patient");
  if (!auth.authorized) return { error: auth.error };

  // 2. Normalize and validate provider code
  const rawCode = formData.get("provider_code") as string;
  if (!rawCode) return { error: "Please enter a provider code" };
  const code = rawCode.toUpperCase().trim();

  if (!VALID_CODE_CHARS.test(code)) {
    return { error: "Invalid code format" };
  }

  // 3. Look up provider by code
  const { data: providerData, error: providerError } = await auth.supabase
    .rpc("lookup_provider_by_code", { p_code: code })
    .maybeSingle();
  const provider = providerData as { id: string; full_name: string | null } | null;

  if (providerError) return { error: "An error occurred. Please try again." };
  if (!provider) {
    return { error: "Provider not found. Please check the code and try again." };
  }

  // 4. Check for existing link
  const { data: existingLink } = await auth.supabase
    .from("provider_patient_links")
    .select("id, status")
    .eq("provider_id", provider.id)
    .eq("patient_id", auth.user.id)
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
  const { error: insertError } = await auth.supabase
    .from("provider_patient_links")
    .insert({
      provider_id: provider.id,
      patient_id: auth.user.id,
      status: "pending",
    });

  if (insertError) return { error: "Unable to request linkage" };

  revalidatePath("/link-provider");
  return { success: true, provider_name: provider.full_name ?? "Provider" };
}

export async function acceptLinkage(linkId: string) {
  if (!z.string().uuid().safeParse(linkId).success) {
    return { error: "Invalid link ID" };
  }
  const auth = await authorize("provider");
  if (!auth.authorized) return { error: auth.error };

  const { data, error } = await auth.supabase
    .from("provider_patient_links")
    .update({
      status: "active",
      linked_at: new Date().toISOString(),
    })
    .eq("id", linkId)
    .eq("provider_id", auth.user.id)
    .eq("status", "pending")
    .select("id");

  if (error) return { error: "Unable to update linkage" };
  if (!data || data.length === 0) return { error: "Linkage not found" };

  revalidatePath("/patients/manage");
  return { success: true };
}

export async function rejectLinkage(linkId: string) {
  if (!z.string().uuid().safeParse(linkId).success) {
    return { error: "Invalid link ID" };
  }
  const auth = await authorize("provider");
  if (!auth.authorized) return { error: auth.error };

  const { data, error } = await auth.supabase
    .from("provider_patient_links")
    .update({ status: "rejected" })
    .eq("id", linkId)
    .eq("provider_id", auth.user.id)
    .eq("status", "pending")
    .select("id");

  if (error) return { error: "Unable to update linkage" };
  if (!data || data.length === 0) return { error: "Linkage not found" };

  revalidatePath("/patients/manage");
  return { success: true };
}
