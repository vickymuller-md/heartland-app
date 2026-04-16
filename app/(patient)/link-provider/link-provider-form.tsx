"use client";

import { useActionState, useState } from "react";
import { requestLinkage } from "@/lib/actions/linkage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Link2, CheckCircle2, AlertCircle, Clock, XCircle } from "lucide-react";

type LinkageState = {
  success?: boolean;
  provider_name?: string;
  error?: string;
} | null;

type ExistingLink = {
  id: string;
  status: string;
  provider: { full_name: string } | null;
};

async function linkageAction(
  _prev: LinkageState,
  formData: FormData
): Promise<LinkageState> {
  return requestLinkage(formData);
}

export function LinkProviderForm({
  existingLinks,
}: {
  existingLinks: ExistingLink[];
}) {
  const [state, action, isPending] = useActionState(linkageAction, null);
  const [code, setCode] = useState("");

  return (
    <div className="space-y-6">
      {/* Code Entry Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Link2 className="size-5" />
            Enter Provider Code
          </CardTitle>
          <CardDescription>
            Your provider will give you a 6-character code. Enter it below to
            send a linkage request.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={action} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="provider_code">Provider Code</Label>
              <Input
                id="provider_code"
                name="provider_code"
                type="text"
                maxLength={6}
                placeholder="e.g. ABC123"
                required
                autoComplete="off"
                value={code}
                onChange={(e) =>
                  setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))
                }
                disabled={isPending}
                className="text-center font-mono text-2xl uppercase tracking-[0.3em]"
              />
            </div>

            {/* Success message */}
            {state?.success && (
              <div className="flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                <span>
                  Linkage request sent to {state.provider_name}. You will be
                  notified when they accept.
                </span>
              </div>
            )}

            {/* Error message */}
            {state?.error && (
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <span>{state.error}</span>
              </div>
            )}

            <Button
              type="submit"
              className="min-h-12 w-full text-base"
              size="lg"
              disabled={isPending || code.length !== 6}
            >
              {isPending ? "Sending request..." : "Request Linkage"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Existing Links */}
      {existingLinks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Your Providers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {existingLinks.map((link) => (
              <div
                key={link.id}
                className="flex items-center justify-between rounded-lg border p-3"
              >
                <span className="text-sm font-medium text-slate-900">
                  {link.provider?.full_name ?? "Unknown Provider"}
                </span>
                <LinkStatusBadge status={link.status} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function LinkStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "active":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
          <CheckCircle2 className="size-3" />
          Active
        </span>
      );
    case "pending":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-medium text-yellow-800">
          <Clock className="size-3" />
          Pending
        </span>
      );
    case "rejected":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
          <XCircle className="size-3" />
          Declined
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
          {status}
        </span>
      );
  }
}
