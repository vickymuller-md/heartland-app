"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { Eye, EyeOff, UserCheck } from "lucide-react";
import { registerSchema, type RegisterInput } from "@/lib/schemas/auth";
import { createClient } from "@/lib/supabase/client";
import { ConsentDialog } from "@/components/auth/consent-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

interface RegisterFormProps {
  inviteProviderId?: string;
  inviterName?: string | null;
}

export function RegisterForm({ inviteProviderId, inviterName }: RegisterFormProps) {
  const isInvited = !!inviteProviderId;

  const [showPassword, setShowPassword] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      email: "",
      password: "",
      full_name: "",
      role: "patient",
      consent_accepted: false,
    },
  });

  function handleFormSubmit() {
    // Open consent dialog before proceeding
    setMessage(null);
    setConsentOpen(true);
  }

  function handleConsentCancel() {
    setConsentOpen(false);
    setMessage({ type: "error", text: "You must accept the informed consent to create an account." });
  }

  async function handleConsentAccept() {
    setConsentOpen(false);
    setValue("consent_accepted", true, { shouldValidate: true });

    // Re-trigger submit after consent is accepted
    const values = watch();
    await doSignUp({ ...values, consent_accepted: true });
  }

  async function doSignUp(data: RegisterInput) {
    setSubmitting(true);
    setMessage(null);

    try {
      const supabase = createClient();
      const origin = window.location.origin;

      const signUpMetadata: Record<string, string> = {
        full_name: data.full_name,
        consent_accepted: "true",
      };

      // Include invite provider metadata for invited patients
      if (isInvited && inviteProviderId) {
        signUpMetadata.invited_by_provider = inviteProviderId;
      }

      const { data: signUpData, error } = await supabase.auth.signUp({
        email: data.email,
        password: data.password,
        options: {
          data: signUpMetadata,
          emailRedirectTo: `${origin}/confirm?next=/today`,
        },
      });

      if (error) {
        setMessage({
          type: "error",
          text: "Unable to create the account. Check your details or sign in if you already registered.",
        });
        return;
      }

      setMessage({
        type: "success",
        text: signUpData.user
          ? "Check your email to confirm your account. You can close this page."
          : "If the account can be created, confirmation instructions will be sent by email.",
      });
    } catch {
      setMessage({ type: "error", text: "An unexpected error occurred. Please try again." });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Create Account</CardTitle>
          <CardDescription>
            Register to access the HEARTLAND Protocol tools
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Invite banner */}
          {isInvited && inviterName && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
              <UserCheck className="mt-0.5 size-4 shrink-0" />
              <span>
                You were invited by <strong>Dr. {inviterName}</strong>. Complete registration
                to connect with your provider.
              </span>
            </div>
          )}

          <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4">
            {/* Full Name */}
            <div className="space-y-1.5">
              <Label htmlFor="full_name">Full Name</Label>
              <Input
                id="full_name"
                type="text"
                placeholder="Jane Smith"
                aria-invalid={!!errors.full_name}
                {...register("full_name")}
              />
              {errors.full_name && (
                <p className="text-sm text-destructive">{errors.full_name.message}</p>
              )}
            </div>

            {/* Email */}
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="jane@example.com"
                aria-invalid={!!errors.email}
                {...register("email")}
              />
              {errors.email && (
                <p className="text-sm text-destructive">{errors.email.message}</p>
              )}
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Minimum 15 characters"
                  aria-invalid={!!errors.password}
                  {...register("password")}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              {errors.password && (
                <p className="text-sm text-destructive">{errors.password.message}</p>
              )}
            </div>

            {/* Public registration is intentionally patient-only. */}
            <div className="space-y-1.5">
              <Label>Account type</Label>
              <div className="rounded-lg border bg-muted/50 p-3">
                <p className="text-sm font-medium text-muted-foreground">
                  Patient{isInvited ? " (provider invitation)" : ""}
                </p>
              </div>
              {!isInvited && (
                <p className="text-sm text-muted-foreground">
                  Healthcare professional?{" "}
                  <Link href="/request-access" className="font-medium text-primary hover:underline">
                    Request verified access
                  </Link>
                  .
                </p>
              )}
            </div>

            {/* Consent error (shown if they cancelled the dialog) */}
            {message?.type === "error" && message.text.includes("consent") && null}

            {/* Messages */}
            {message && (
              <div
                className={`rounded-lg border p-3 text-sm ${
                  message.type === "success"
                    ? "border-green-200 bg-green-50 text-green-800"
                    : "border-red-200 bg-red-50 text-red-800"
                }`}
              >
                {message.text}
              </div>
            )}

            {/* Submit */}
            <Button type="submit" className="w-full" size="lg" disabled={submitting}>
              {submitting ? "Creating account..." : "Create Account"}
            </Button>

            {/* Links */}
            <p className="text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link href="/login" className="font-medium text-primary hover:underline">
                Sign in
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>

      <ConsentDialog
        open={consentOpen}
        onAccept={handleConsentAccept}
        onCancel={handleConsentCancel}
      />
    </>
  );
}
