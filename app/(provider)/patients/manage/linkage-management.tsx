"use client";

import { useEffect, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { acceptLinkage, rejectLinkage } from "@/lib/actions/linkage";
import {
  CheckCircle2,
  XCircle,
  Clock,
  Mail,
  ChevronDown,
  ChevronUp,
  UserCheck,
  UserX,
} from "lucide-react";
import type { LinkageRow } from "./page";

export function LinkageManagement({
  initialLinks,
  providerId,
}: {
  initialLinks: LinkageRow[];
  providerId: string;
}) {
  const [links, setLinks] = useState<LinkageRow[]>(initialLinks);
  const [rejectedOpen, setRejectedOpen] = useState(false);

  // Realtime subscription for live updates
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("linkage-updates")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "provider_patient_links",
          filter: `provider_id=eq.${providerId}`,
        },
        (payload) => {
          const newRow = payload.new as LinkageRow;
          setLinks((prev) => [newRow, ...prev]);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "provider_patient_links",
          filter: `provider_id=eq.${providerId}`,
        },
        (payload) => {
          const updated = payload.new as LinkageRow;
          setLinks((prev) =>
            prev.map((link) => (link.id === updated.id ? { ...link, ...updated } : link))
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [providerId]);

  // Group links by status
  const pending = links.filter((l) => l.status === "pending");
  const invited = links.filter((l) => l.status === "invited");
  const active = links.filter((l) => l.status === "active");
  const rejected = links.filter((l) => l.status === "rejected");

  return (
    <div className="space-y-6">
      {/* Pending Requests */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-yellow-800">
          <Clock className="size-5" />
          Pending Requests ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <p className="rounded-lg border border-yellow-100 bg-yellow-50 p-4 text-sm text-yellow-700">
            No pending requests
          </p>
        ) : (
          <div className="space-y-3">
            {pending.map((link) => (
              <PendingCard key={link.id} link={link} />
            ))}
          </div>
        )}
      </section>

      {/* Invited (Awaiting Registration) */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-blue-800">
          <Mail className="size-5" />
          Invited ({invited.length})
        </h2>
        {invited.length === 0 ? (
          <p className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm text-blue-700">
            No invited patients
          </p>
        ) : (
          <div className="space-y-3">
            {invited.map((link) => (
              <div
                key={link.id}
                className="flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 p-4"
              >
                <div>
                  <p className="text-sm font-medium text-blue-900">
                    {link.invite_email}
                  </p>
                  <p className="text-xs text-blue-600">
                    Invited {formatDate(link.created_at)}
                  </p>
                </div>
                <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                  Awaiting registration
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Active Patients */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-green-800">
          <CheckCircle2 className="size-5" />
          Active Patients ({active.length})
        </h2>
        {active.length === 0 ? (
          <p className="rounded-lg border border-green-100 bg-green-50 p-4 text-sm text-green-700">
            No active patients yet
          </p>
        ) : (
          <div className="space-y-3">
            {active.map((link) => (
              <div
                key={link.id}
                className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 p-4"
              >
                <div>
                  <p className="text-sm font-medium text-green-900">
                    {link.patient?.full_name ?? "Unknown Patient"}
                  </p>
                  <p className="text-xs text-green-600">
                    {link.patient?.email ?? link.invite_email ?? ""}
                    {link.linked_at && ` -- Linked ${formatDate(link.linked_at)}`}
                  </p>
                </div>
                <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
                  <CheckCircle2 className="size-3" />
                  Active
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Rejected (collapsed by default) */}
      {rejected.length > 0 && (
        <section>
          <button
            onClick={() => setRejectedOpen(!rejectedOpen)}
            className="mb-3 flex w-full items-center gap-2 text-lg font-semibold text-gray-500 hover:text-gray-700"
          >
            <XCircle className="size-5" />
            Rejected ({rejected.length})
            {rejectedOpen ? (
              <ChevronUp className="ml-auto size-4" />
            ) : (
              <ChevronDown className="ml-auto size-4" />
            )}
          </button>
          {rejectedOpen && (
            <div className="space-y-3">
              {rejected.map((link) => (
                <div
                  key={link.id}
                  className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 p-4"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-700">
                      {link.patient?.full_name ?? "Unknown Patient"}
                    </p>
                    <p className="text-xs text-gray-500">
                      {link.patient?.email ?? ""}
                    </p>
                  </div>
                  <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500">
                    Rejected
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function PendingCard({ link }: { link: LinkageRow }) {
  const [acceptPending, startAcceptTransition] = useTransition();
  const [rejectPending, startRejectTransition] = useTransition();

  return (
    <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-yellow-900">
            {link.patient?.full_name ?? "Unknown Patient"}
          </p>
          <p className="text-xs text-yellow-700">
            {link.patient?.email ?? ""}
          </p>
          <p className="mt-1 text-xs text-yellow-600">
            Requested {formatDate(link.created_at)}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() =>
              startAcceptTransition(async () => {
                await acceptLinkage(link.id);
              })
            }
            disabled={acceptPending || rejectPending}
            className="inline-flex min-h-9 items-center gap-1 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-50"
          >
            <UserCheck className="size-3.5" />
            {acceptPending ? "..." : "Accept"}
          </button>
          <button
            onClick={() =>
              startRejectTransition(async () => {
                await rejectLinkage(link.id);
              })
            }
            disabled={acceptPending || rejectPending}
            className="inline-flex min-h-9 items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
          >
            <UserX className="size-3.5" />
            {rejectPending ? "..." : "Reject"}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}
