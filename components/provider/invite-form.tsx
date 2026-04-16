"use client";

import { useActionState, useState } from "react";
import { invitePatient } from "@/lib/actions/invite";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Mail, ArrowLeft, CheckCircle2, AlertCircle } from "lucide-react";
import Link from "next/link";

type InviteState = {
  success?: boolean;
  error?: string;
} | null;

async function inviteAction(_prev: InviteState, formData: FormData): Promise<InviteState> {
  return invitePatient(formData);
}

export function InviteForm() {
  const [state, action, isPending] = useActionState(inviteAction, null);
  const [email, setEmail] = useState("");

  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-2xl">
            <Mail className="size-6" />
            Invite Patient
          </CardTitle>
          <CardDescription>
            Send an email invitation to a patient. They will receive a link to register
            and will be automatically linked to your account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={action} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Patient Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="patient@example.com"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isPending}
              />
            </div>

            {/* Success message */}
            {state?.success && (
              <div className="flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                <span>Invitation sent to {email}. They will receive an email with instructions.</span>
              </div>
            )}

            {/* Error message */}
            {state?.error && (
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <span>{state.error}</span>
              </div>
            )}

            <Button type="submit" className="w-full" size="lg" disabled={isPending}>
              {isPending ? "Sending invitation..." : "Send Invitation"}
            </Button>

            <div className="text-center">
              <Link
                href="/patients/manage"
                className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="size-3" />
                Back to Patient Management
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
