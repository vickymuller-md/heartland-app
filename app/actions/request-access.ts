"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const US_STATE = /^[A-Z]{2}$/;

const RequestAccessSchema = z.object({
  full_name: z.string().trim().min(2, "Please enter your full name.").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(254),
  npi: z
    .string()
    .trim()
    .regex(/^\d{10}$/, "NPI must be 10 digits.")
    .optional()
    .or(z.literal("")),
  state: z
    .string()
    .trim()
    .toUpperCase()
    .regex(US_STATE, "Use a two-letter US state code (e.g. NM).")
    .optional()
    .or(z.literal("")),
  facility: z.string().trim().max(160).optional().or(z.literal("")),
  role_claim: z.string().trim().max(40).optional().or(z.literal("")),
  message: z.string().trim().max(1200).optional().or(z.literal("")),
});

export type RequestAccessInput = z.infer<typeof RequestAccessSchema>;

export type RequestAccessResult =
  | { ok: true }
  | { ok: false; errors: Partial<Record<keyof RequestAccessInput, string>>; formError?: string };

/**
 * Submit a professional-access request.
 * Relies on the public INSERT RLS policy on access_requests (migration 00022).
 * Returns a normalized result so the client form can render field-level errors.
 */
export async function submitAccessRequest(
  input: RequestAccessInput,
): Promise<RequestAccessResult> {
  const parsed = RequestAccessSchema.safeParse(input);
  if (!parsed.success) {
    const errors: Partial<Record<keyof RequestAccessInput, string>> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof RequestAccessInput;
      if (!errors[key]) errors[key] = issue.message;
    }
    return { ok: false, errors };
  }

  const row = {
    full_name: parsed.data.full_name,
    email: parsed.data.email,
    npi: parsed.data.npi || null,
    state: parsed.data.state || null,
    facility: parsed.data.facility || null,
    role_claim: parsed.data.role_claim || null,
    message: parsed.data.message || null,
  };

  const supabase = await createClient();
  const { error } = await supabase.from("access_requests").insert(row);

  if (error) {
    console.error("[access-request] insert failed", error);
    return {
      ok: false,
      errors: {},
      formError: "We could not register your request. Please try again shortly.",
    };
  }

  return { ok: true };
}
