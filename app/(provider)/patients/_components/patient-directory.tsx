"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Search, User, Mail, Phone, MapPin, Shield, Radio, Building2 } from "lucide-react";
import { Input } from "@/components/ui/input";

interface PatientEntry {
  id: string;
  code: string;
  full_name: string;
  email: string;
  phone: string;
  address: string;
  risk_tier: string | null;
  track_assignment: string | null;
  facility_tier: number | null;
  linked_at: string | null;
}

const TIER_COLORS: Record<string, string> = {
  low: "bg-green-100 text-green-800",
  moderate: "bg-amber-100 text-amber-800",
  high: "bg-red-100 text-red-800",
};

const TRACK_LABELS: Record<string, string> = {
  A: "Digital",
  B: "Analog",
  hybrid: "Hybrid",
};

export function PatientDirectory({ patients }: { patients: PatientEntry[] }) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return patients;
    const q = search.toLowerCase();
    return patients.filter(
      (p) =>
        p.full_name.toLowerCase().includes(q) ||
        p.email.toLowerCase().includes(q) ||
        p.phone.toLowerCase().includes(q) ||
        p.address.toLowerCase().includes(q) ||
        p.code.toLowerCase().includes(q) ||
        p.id.toLowerCase().startsWith(q)
    );
  }, [patients, search]);

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
        <Input
          type="text"
          placeholder="Search by name, email, phone, address, or patient code..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10 h-12 text-base"
        />
      </div>

      {search && (
        <p className="text-sm text-gray-500">
          {filtered.length} result{filtered.length !== 1 ? "s" : ""} for &quot;{search}&quot;
        </p>
      )}

      {filtered.length === 0 ? (
        <div className="py-12 text-center text-gray-500">
          <User className="mx-auto size-10 text-gray-300 mb-3" />
          <p className="text-base">No patients found</p>
          {search && <p className="text-sm mt-1">Try a different search term</p>}
        </div>
      ) : (
        <div className="divide-y divide-gray-100 rounded-lg border bg-white">
          {filtered.map((patient) => (
            <Link
              key={patient.id}
              href={`/patients/${patient.id}`}
              className="flex items-start gap-4 p-4 hover:bg-gray-50 transition-colors"
            >
              {/* Avatar */}
              <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600 font-semibold text-lg">
                {patient.full_name
                  .split(" ")
                  .map((n) => n[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase()}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-gray-900 truncate">
                    {patient.full_name}
                  </span>
                  <span className="text-xs font-mono text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                    {patient.code}
                  </span>
                </div>

                <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0.5 text-sm text-gray-500">
                  <span className="flex items-center gap-1.5 truncate">
                    <Mail className="size-3.5 shrink-0" />
                    {patient.email}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Phone className="size-3.5 shrink-0" />
                    {patient.phone}
                  </span>
                  <span className="flex items-center gap-1.5 truncate sm:col-span-2">
                    <MapPin className="size-3.5 shrink-0" />
                    {patient.address}
                  </span>
                </div>

                {/* Tags */}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {patient.risk_tier && (
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                        TIER_COLORS[patient.risk_tier] ?? "bg-gray-100 text-gray-700"
                      }`}
                    >
                      <Shield className="size-3" />
                      {patient.risk_tier.charAt(0).toUpperCase() + patient.risk_tier.slice(1)} Risk
                    </span>
                  )}
                  {patient.track_assignment && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
                      <Radio className="size-3" />
                      Track {patient.track_assignment} ({TRACK_LABELS[patient.track_assignment] ?? patient.track_assignment})
                    </span>
                  )}
                  {patient.facility_tier && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-800">
                      <Building2 className="size-3" />
                      Tier {patient.facility_tier}
                    </span>
                  )}
                </div>
              </div>

              {/* Chevron */}
              <svg
                className="size-5 shrink-0 text-gray-300 self-center"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
