'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { Search, Check, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import { readPatientDirectory, readPatientSelection, PatientSelectionSessionError, type PatientMatch, type SelectedPatientData } from '@/lib/integration/patient-selection';

export type { SelectedPatientData } from '@/lib/integration/patient-selection';
interface PatientSelectorProps {
  onSelect: (data: SelectedPatientData) => void;
  selectedPatient: PatientMatch | null;
  onClear: () => void;
  expectedActorId?: string;
  includeLaboratories?: boolean;
}

export function PatientSelector({ onSelect, selectedPatient, onClear, expectedActorId, includeLaboratories = false }: PatientSelectorProps) {
  const [client] = useState(() => createClient());
  const [search, setSearch] = useState('');
  const [allPatients, setAllPatients] = useState<PatientMatch[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const lifetime = useRef(0);
  const generation = useRef(0);
  const alive = useRef(false);
  const denied = useRef(false);
  const actor = useRef<string | null>(expectedActorId ?? null);
  const clearCallback = useRef(onClear);
  const selectCallback = useRef(onSelect);
  useEffect(() => { clearCallback.current = onClear; selectCallback.current = onSelect; }, [onClear, onSelect]);

  useEffect(() => {
    alive.current = true;
    const epoch = ++lifetime.current;
    const current = () => alive.current && lifetime.current === epoch && !denied.current;
    const invalidate = () => {
      if (!alive.current || lifetime.current !== epoch) return;
      denied.current = true; generation.current += 1;
      setBlocked(true); setAllPatients([]); setSearch(''); setSelecting(false);
      setLoadError('Patient selection session changed. Reload the page.');
      clearCallback.current();
    };
    const { data: listener } = client.auth.onAuthStateChange((event, session) => {
      if (!current()) return;
      if (event === 'SIGNED_OUT' || !session?.user.id || (actor.current && actor.current !== session.user.id)) invalidate();
      else if (actor.current === null) actor.current = session.user.id;
    });
    void (async () => {
      try {
        const { data, error } = await client.auth.getUser();
        if (!current()) return;
        if (error || !data.user || (actor.current && actor.current !== data.user.id)) { invalidate(); return; }
        actor.current = data.user.id;
        const patients = await readPatientDirectory(client, data.user.id);
        if (!current()) return;
        setAllPatients(patients); setLoaded(true);
      } catch (error) {
        if (current()) {
          if (error instanceof PatientSelectionSessionError) { invalidate(); return; }
          setLoadError('Patient list could not be verified. Reload the page; do not interpret this as an empty panel.');
          setAllPatients([]); setLoaded(false); clearCallback.current();
        }
      }
    })();
    return () => { alive.current = false; lifetime.current += 1; generation.current += 1; listener.subscription.unsubscribe(); };
  }, [client, expectedActorId]);

  const filtered = useMemo(() => {
    if (!loaded || blocked || search.trim().length < 2) return [];
    const query = search.toLowerCase();
    return allPatients.filter((patient) => [patient.full_name, patient.email, patient.phone, patient.patient_code]
      .some((value) => value?.toLowerCase().includes(query))).slice(0, 8);
  }, [allPatients, search, loaded, blocked]);

  function clear() {
    generation.current += 1; setSelecting(false); setSearch(''); clearCallback.current();
  }
  async function handleSelect(patient: PatientMatch) {
    if (!alive.current || denied.current || !actor.current || !loaded) return;
    const ticket = ++generation.current; const epoch = lifetime.current;
    const current = () => alive.current && !denied.current && epoch === lifetime.current && ticket === generation.current;
    clearCallback.current(); setSelecting(true); setLoadError(null);
    try {
      const data = await readPatientSelection(client, patient, actor.current, includeLaboratories);
      if (!current()) return;
      selectCallback.current(data); setSearch('');
    } catch (error) {
      if (current()) {
        clearCallback.current();
        if (error instanceof PatientSelectionSessionError) {
          denied.current = true; generation.current += 1; setBlocked(true); setAllPatients([]); setSearch(''); setSelecting(false);
          setLoadError('Patient selection session changed. Reload the page.'); return;
        }
        setLoadError('Patient sources could not be verified. Nothing was imported; reload or select again.');
      }
    } finally { if (current()) setSelecting(false); }
  }
  if (blocked) return <p role="alert" className="text-sm text-red-700">{loadError}</p>;
  if (selectedPatient && loaded && allPatients.some((patient) => patient.id === selectedPatient.id)) {
    return <div className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 p-3">
      <Check className="h-5 w-5 shrink-0 text-green-700" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-green-900">{selectedPatient.full_name}</p>
        <p className="text-xs text-green-700">{selectedPatient.patient_code}{selectedPatient.risk_tier ? ' · ' + selectedPatient.risk_tier + ' risk' : ''}</p>
      </div>
      <Button variant="ghost" size="sm" onClick={clear} aria-label="Clear selected patient"><X className="h-4 w-4" /></Button>
    </div>;
  }
  return <div className="relative space-y-2">
    <div className="relative">
      <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
      <Input type="text" aria-label="Search linked patients"
        placeholder={loaded ? 'Link to patient: search by name, code, phone, or email...' : 'Loading patients...'}
        value={search} onChange={(event) => { generation.current += 1; setSelecting(false); setSearch(event.target.value); }}
        className="h-11 pl-10" disabled={!loaded} />
    </div>
    {loadError && <p role="alert" className="text-sm font-medium text-red-700">{loadError}</p>}
    {selecting && <div><p role="status">Verifying patient sources…</p><Button type="button" variant="ghost" onClick={clear}>Cancel selection</Button></div>}
    {filtered.length > 0 && <div className="absolute z-50 max-h-64 w-full overflow-y-auto rounded-lg border bg-white shadow-lg">
      {filtered.map((patient) => <button key={patient.id} type="button" onClick={() => void handleSelect(patient)}
        className="flex w-full items-center gap-3 border-b p-3 text-left transition-colors last:border-0 hover:bg-gray-50">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-gray-900">{patient.full_name}</p>
          <p className="truncate text-xs text-gray-500">{patient.patient_code ?? ''}{patient.phone ? ' · ' + patient.phone : ''}{patient.email ? ' · ' + patient.email : ''}</p>
        </div>
      </button>)}
    </div>}
  </div>;
}
