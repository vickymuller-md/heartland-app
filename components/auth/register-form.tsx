"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { Eye, EyeOff, UserCheck } from "lucide-react";
import { registerSchema, type RegisterInput } from "@/lib/schemas/auth";
import { createClient } from "@/lib/supabase/client";
import { recordConsent } from "@/app/actions/auth";
import { ConsentDialog } from "@/components/auth/consent-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
      role: isInvited ? "patient" : undefined,
      consent_accepted: false,
    },
  });

  const role = watch("role");

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
      const redirectPath = data.role === "provider" ? "/dashboard" : "/today";

      const signUpMetadata: Record<string, string> = {
        role: data.role,
        full_name: data.full_name,
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
          emailRedirectTo: `${origin}/confirm?next=${redirectPath}`,
        },
      });

      if (error) {
        setMessage({ type: "error", text: error.message });
        return;
      }

      // Record consent in database
      if (signUpData.user?.id) {
        const consentResult = await recordConsent(signUpData.user.id);
        if (!consentResult.success) {
          console.error("Failed to record consent:", consentResult.error);
          // Non-blocking: user is created, consent recording failure is logged
        }
      }

      setMessage({
        type: "success",
        text: "Check your email to confirm your account. You can close this page.",
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
                placeholder="Dr. Jane Smith"
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
                  placeholder="Minimum 8 characters"
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

            {/* Role Selection */}
            <div className="space-y-1.5">
              <Label>I am a...</Label>
              {isInvited ? (
                /* Invited: role locked to patient */
                <div className="rounded-lg border bg-muted/50 p-3">
                  <p className="text-sm font-medium text-muted-foreground">
                    Patient (assigned via provider invitation)
                  </p>
                </div>
              ) : (
                /* Normal: role selectable */
                <RadioGroup
                  value={role}
                  onValueChange={(value: string) =>
                    setValue("role", value as "provider" | "patient", { shouldValidate: true })
                  }
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="provider" id="role-provider" />
                    <Label htmlFor="role-provider" className="font-normal cursor-pointer">
                      Healthcare Professional
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="patient" id="role-patient" />
                    <Label htmlFor="role-patient" className="font-normal cursor-pointer">
                      Patient
                    </Label>
                  </div>
                </RadioGroup>
              )}
              {errors.role && (
                <p className="text-sm text-destructive">{errors.role.message}</p>
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
