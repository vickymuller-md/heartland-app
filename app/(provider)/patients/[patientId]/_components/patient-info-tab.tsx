'use client';

import Link from 'next/link';
import { Mail, Phone, MapPin, Shield, Radio, Building2, Hash, Calendar, Heart, FileText, Activity } from 'lucide-react';
import { CkmBadge } from './ckm-badge';

interface PatientInfo {
  patient_id?: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  patient_code: string | null;
  risk_tier: string | null;
  track_assignment: string | null;
  facility_tier: number | null;
  linked_at: string | null;
  ckm_stage: number | null;
}

const TIER_LABELS: Record<string, { label: string; color: string }> = {
  low: { label: 'Low Risk', color: 'text-green-700 bg-green-100' },
  moderate: { label: 'Moderate Risk', color: 'text-amber-700 bg-amber-100' },
  high: { label: 'High Risk', color: 'text-red-700 bg-red-100' },
};

const TRACK_LABELS: Record<string, string> = {
  A: 'Track A (Digital)',
  B: 'Track B (Analog)',
  hybrid: 'Hybrid',
};

function InfoRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string | null }) {
  return (
    <div className="flex items-start gap-3 py-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-100">
        <Icon className="h-4 w-4 text-gray-500" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">{label}</p>
        <p className="text-sm text-gray-900 mt-0.5 break-words">{value || '—'}</p>
      </div>
    </div>
  );
}

export function PatientInfoTab({ info, patientId }: { info?: PatientInfo; patientId?: string }) {
  if (!info) {
    return <p className="text-gray-500 py-8 text-center">Patient information unavailable</p>;
  }

  const tier = info.risk_tier ? TIER_LABELS[info.risk_tier] : null;
  const linkedDate = info.linked_at
    ? new Date(info.linked_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Contact Information */}
      <div className="rounded-lg border bg-white p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Contact Information</h3>
        <div className="divide-y divide-gray-100">
          <InfoRow icon={Hash} label="Patient Code" value={info.patient_code} />
          <InfoRow icon={Mail} label="Email" value={info.email} />
          <InfoRow icon={Phone} label="Phone" value={info.phone} />
          <InfoRow icon={MapPin} label="Address" value={info.address} />
        </div>
      </div>

      {/* Clinical Profile */}
      <div className="rounded-lg border bg-white p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Clinical Profile</h3>
        <div className="divide-y divide-gray-100">
          <div className="flex items-start gap-3 py-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-100">
              <Shield className="h-4 w-4 text-gray-500" />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Risk Tier</p>
              {tier ? (
                <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium mt-1 ${tier.color}`}>
                  {tier.label}
                </span>
              ) : (
                <p className="text-sm text-gray-900 mt-0.5">—</p>
              )}
            </div>
          </div>
          <div className="flex items-start gap-3 py-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-100">
              <Activity className="h-4 w-4 text-gray-500" />
            </div>
            <div>
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">CKM Stage</p>
              <CkmBadge stage={info.ckm_stage} patientId={info.patient_id ?? patientId ?? ''} />
            </div>
          </div>
          {info.track_assignment === 'B' && patientId ? (
            <div className="flex items-start gap-3 py-3">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-100">
                <Radio className="h-4 w-4 text-gray-500" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Monitoring Track</p>
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 mt-1">
                  <FileText className="h-3 w-3" aria-hidden="true" />
                  Analog — provider enters data
                </span>
                <div className="mt-2 flex items-center gap-3">
                  <Link
                    href={`/patients/${patientId}/track-b-entry`}
                    className="text-sm font-medium text-blue-600 hover:text-blue-800"
                  >
                    Enter Diary Data
                  </Link>
                  <Link
                    href={`/patients/${patientId}/track-b-diary`}
                    className="text-sm font-medium text-blue-600 hover:text-blue-800"
                  >
                    Print Diary
                  </Link>
                </div>
              </div>
            </div>
          ) : (
            <InfoRow icon={Radio} label="Monitoring Track" value={info.track_assignment ? TRACK_LABELS[info.track_assignment] ?? info.track_assignment : null} />
          )}
          <InfoRow icon={Building2} label="Facility Tier" value={info.facility_tier ? `Tier ${info.facility_tier}` : null} />
          <InfoRow icon={Calendar} label="Linked Since" value={linkedDate} />
          <InfoRow icon={Heart} label="Emergency Contact" value="Not set" />
        </div>
      </div>
    </div>
  );
}
