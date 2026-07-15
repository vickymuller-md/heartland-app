import { formatDistanceToNow } from 'date-fns';
import { AlertTriangle, Activity, FlaskConical, ListTodo, Pill, Stethoscope } from 'lucide-react';
import type { OperationalBrief } from '@/lib/patient/operational';

function Delta({ value, unit }: { value: number | null; unit: string }) {
  if (value === null || value === 0) return <span className="text-slate-500">No prior delta</span>;
  return <span className={value > 0 ? 'text-amber-700' : 'text-blue-700'}>{value > 0 ? '+' : ''}{value} {unit}</span>;
}

export function PatientBrief({ brief }: { brief: OperationalBrief }) {
  const sourceIsStale = brief.sourceDataStale;
  return (
    <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5" aria-labelledby="patient-brief-heading">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">60-second brief</p>
          <h2 id="patient-brief-heading" className="text-xl font-bold text-slate-950">What changed and what is next</h2>
        </div>
        <p className="text-xs text-slate-500">
          Generated {formatDistanceToNow(new Date(brief.generatedAt), { addSuffix: true })}
        </p>
      </div>

      <div className={`mt-4 rounded-lg border p-3 text-sm ${sourceIsStale ? 'border-amber-300 bg-amber-50 text-amber-950' : 'border-emerald-200 bg-emerald-50 text-emerald-950'}`}>
        <strong>Source data:</strong>{' '}
        {brief.sourceDataAsOf
          ? `${formatDistanceToNow(new Date(brief.sourceDataAsOf), { addSuffix: true })}${sourceIsStale ? ' · stale—verify source records before acting' : ''}`
          : 'No dated clinical source is available.'}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border bg-white p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Activity className="size-4" /> Latest vitals</div>
          {brief.latestVitals ? (
            <div className="mt-2 space-y-1 text-sm text-slate-700">
              <p>{brief.latestVitals.weight ?? '—'} lb · <Delta value={brief.latestVitals.weightDelta} unit="lb" /></p>
              <p>SBP {brief.latestVitals.sbp ?? '—'} · <Delta value={brief.latestVitals.sbpDelta} unit="mmHg" /></p>
              <p>HR {brief.latestVitals.heartRate ?? '—'} · SpO₂ {brief.latestVitals.spo2 ?? '—'}</p>
              <p className="text-xs text-slate-500">{formatDistanceToNow(new Date(brief.latestVitals.recordedAt), { addSuffix: true })}</p>
            </div>
          ) : <p className="mt-2 text-sm text-amber-800">Missing</p>}
        </div>

        <div className="rounded-xl border bg-white p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Stethoscope className="size-4" /> Symptoms</div>
          {brief.latestSymptoms ? (
            <div className="mt-2 space-y-1 text-sm text-slate-700">
              <p>Dyspnea {brief.latestSymptoms.dyspnea ?? '—'} · Edema {brief.latestSymptoms.edema ?? '—'}</p>
              <p>Fatigue {brief.latestSymptoms.fatigue ?? '—'} · Orthopnea {brief.latestSymptoms.orthopnea === null ? '—' : brief.latestSymptoms.orthopnea ? 'yes' : 'no'}</p>
              <p className={brief.latestSymptoms.redFlag ? 'font-semibold text-red-700' : 'text-emerald-700'}>
                {brief.latestSymptoms.redFlag ? 'Flag recorded' : 'No symptom flag recorded'}
              </p>
            </div>
          ) : <p className="mt-2 text-sm text-amber-800">Missing</p>}
        </div>

        <div className="rounded-xl border bg-white p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800"><FlaskConical className="size-4" /> Latest labs</div>
          {brief.latestLabs ? (
            <div className="mt-2 space-y-1 text-sm text-slate-700">
              <p>K⁺ {brief.latestLabs.potassium ?? '—'} · eGFR {brief.latestLabs.egfr ?? '—'}</p>
              <p>Creatinine {brief.latestLabs.creatinine ?? '—'}</p>
              <p className="text-xs text-slate-500">{formatDistanceToNow(new Date(brief.latestLabs.collectedAt), { addSuffix: true })}</p>
            </div>
          ) : <p className="mt-2 text-sm text-amber-800">Missing</p>}
        </div>

        <div className="rounded-xl border bg-white p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800"><ListTodo className="size-4" /> Operational context</div>
          <div className="mt-2 space-y-1 text-sm text-slate-700">
            <p className="flex items-center gap-1"><AlertTriangle className="size-3.5" /> {brief.openAlertCount === null ? 'Alerts unavailable' : `${brief.openAlertCount} active alert(s)`}</p>
            <p className="flex items-center gap-1"><Pill className="size-3.5" /> {brief.activeMedicationCount} active medication(s)</p>
            <p>{brief.nextWork ? `Next: ${brief.nextWork.title}` : 'No open work assigned'}</p>
          </div>
        </div>
      </div>

      {brief.missingData.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <strong>Data quality:</strong> {brief.missingData.join(' · ')}. Verify source records before acting.
        </div>
      )}

      <p className="mt-3 text-xs text-slate-500">
        Informational summary only. Open source records and apply independent clinical judgment before any decision.
      </p>
    </section>
  );
}
