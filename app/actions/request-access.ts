"use server";

import { z } from "zod";
import { createHmac } from "node:crypto";
import { headers } from "next/headers";

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
  website: z.string().max(200).optional().or(z.literal("")),
});

export type RequestAccessInput = z.infer<typeof RequestAccessSchema>;

export type RequestAccessResult =
  | { ok: true }
  | { ok: false; errors: Partial<Record<keyof RequestAccessInput, string>>; formError?: string };

/**
 * Submit a professional-access request.
 * Relies on the write-only, pending-state RLS policy in migration 00025.
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

  // Honeypot submissions are accepted silently so automated clients receive
  // no signal that their request was discarded.
  if (parsed.data.website) return { ok: true };

  const requestHeaders = await headers();
  const forwarded = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim();
  const clientAddress = requestHeaders.get("x-real-ip")?.trim() || forwarded || `email:${row.email}`;
  const rateSecret =
    process.env.ACCESS_REQUEST_RATE_LIMIT_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!rateSecret) {
    return {
      ok: false,
      errors: {},
      formError: "We could not register your request. Please try again shortly.",
    };
  }
  const requesterHash = createHmac("sha256", rateSecret)
    .update(`heartland-access-request:${clientAddress}`)
    .digest("hex");

  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const { error } = await supabaseAdmin.rpc("submit_access_request", {
    p_requester_hash: requesterHash,
    p_full_name: row.full_name,
    p_email: row.email,
    p_npi: row.npi,
    p_state: row.state,
    p_facility: row.facility,
    p_role_claim: row.role_claim,
    p_message: row.message,
  });

  if (error) {
    const limited = error.message.includes("rate limit exceeded");
    console.error("[access-request] controlled RPC failed");
    return {
      ok: false,
      errors: {},
      formError: limited
        ? "Request limit reached. Please wait before submitting again."
        : "We could not register your request. Please try again shortly.",
    };
  }

  return { ok: true };
}
