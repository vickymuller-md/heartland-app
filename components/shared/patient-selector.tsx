'use client';

import { useState, useEffect, useMemo } from 'react';
import { Search, Check, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';

interface PatientMatch {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  patient_code: string | null;
  risk_tier: string | null;
}

interface PatientVitals {
  weight_lbs: number | null;
  sbp: number | null;
  dbp: number | null;
  heart_rate: number | null;
  spo2: number | null;
  recorded_at: string;
}

interface LatestLabs {
  potassium: number | null;
  creatinine: number | null;
  egfr: number | null;
  collected_at: string;
}

export interface SelectedPatientData {
  patient: PatientMatch;
  latestVitals: PatientVitals | null;
  latestLabs: LatestLabs | null;
  medications: { name: string; dosage: string | null; frequency: string | null }[];
}

interface PatientSelectorProps {
  onSelect: (data: SelectedPatientData) => void;
  selectedPatient: PatientMatch | null;
  onClear: () => void;
}

export function PatientSelector({ onSelect, selectedPatient, onClear }: PatientSelectorProps) {
  const [search, setSearch] = useState('');
  const [allPatients, setAllPatients] = useState<PatientMatch[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Load all linked patients once on mount
  useEffect(() => {
    async function loadPatients() {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setLoadError('Patient list unavailable: authenticated provider session required.');
          setLoaded(true);
          return;
        }

      // Get linked patient IDs
      const { data: links } = await supabase
        .from('provider_patient_links')
        .select('patient_id')
        .eq('provider_id', user.id)
        .eq('status', 'active');

        if (!links || links.length === 0) { setLoaded(true); return; }
      const ids = links.map(l => l.patient_id);

      // Get profiles
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, email, phone, patient_code')
        .in('id', ids);

      // Get risk tiers
      const { data: patients } = await supabase
        .from('patients')
        .select('id, risk_tier')
        .in('id', ids);

      const riskMap = new Map((patients ?? []).map(p => [p.id, p.risk_tier]));

        setAllPatients((profiles ?? []).map(p => ({
          ...p,
          risk_tier: riskMap.get(p.id) ?? null,
        })));
        setLoaded(true);
      } catch {
        setLoadError('Patient list could not be loaded. Do not interpret this as an empty panel.');
        setLoaded(true);
      }
    }
    void loadPatients();
  }, []);

  // Client-side filtering
  const filtered = useMemo(() => {
    if (!search.trim() || search.length < 2) return [];
    const q = search.toLowerCase();
    return allPatients.filter(p =>
      (p.full_name?.toLowerCase().includes(q)) ||
      (p.email?.toLowerCase().includes(q)) ||
      (p.phone?.toLowerCase().includes(q)) ||
      (p.patient_code?.toLowerCase().includes(q))
    ).slice(0, 8);
  }, [allPatients, search]);

  const handleSelect = async (patient: PatientMatch) => {
    const supabase = createClient();

    // Fetch latest vitals
    const { data: vitals } = await supabase
      .from('vitals')
      .select('weight_lbs, sbp, dbp, heart_rate, spo2, recorded_at')
      .eq('patient_id', patient.id)
      .order('recorded_at', { ascending: false })
      .limit(1);

    // Fetch latest labs (K+ and Creatinine)
    const { data: labs } = await supabase
      .from('lab_results')
      .select('potassium, creatinine, egfr, collected_at')
      .eq('patient_id', patient.id)
      .order('collected_at', { ascending: false })
      .limit(1);

    // Fetch active medications
    const { data: meds } = await supabase
      .from('medications')
      .select('name, dosage, frequency')
      .eq('patient_id', patient.id)
      .eq('active', true)
      .order('name');

    onSelect({
      patient,
      latestVitals: vitals?.[0] ?? null,
      latestLabs: labs?.[0] ?? null,
      medications: meds ?? [],
    });

    setSearch('');
  };

  // Selected patient display
  if (selectedPatient) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 p-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-100">
          <Check className="h-5 w-5 text-green-700" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-green-900">{selectedPatient.full_name}</p>
          <p className="text-xs text-green-700">
            {selectedPatient.patient_code}
            {selectedPatient.phone ? ` · ${selectedPatient.phone}` : ''}
            {selectedPatient.risk_tier ? ` · ${selectedPatient.risk_tier} risk` : ''}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClear} className="text-green-700 hover:text-green-900 hover:bg-green-100">
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2 relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
        <Input
          type="text"
          placeholder={loaded ? "Link to patient: search by name, code, phone, or email..." : "Loading patients..."}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10 h-11"
          disabled={!loaded}
        />
      </div>
      {loadError && <p role="alert" className="text-sm font-medium text-red-700">{loadError}</p>}

      {/* Search results dropdown */}
      {filtered.length > 0 && (
        <div className="absolute z-50 w-full rounded-lg border bg-white shadow-lg max-h-64 overflow-y-auto">
          {filtered.map((patient) => (
            <button
              key={patient.id}
              type="button"
              onClick={() => handleSelect(patient)}
              className="w-full flex items-center gap-3 p-3 hover:bg-gray-50 transition-colors text-left border-b last:border-0"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600 text-sm font-semibold">
                {patient.full_name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{patient.full_name}</p>
                <p className="text-xs text-gray-500 truncate">
                  {patient.patient_code ?? ''}
                  {patient.phone ? ` · ${patient.phone}` : ''}
                  {patient.email ? ` · ${patient.email}` : ''}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
