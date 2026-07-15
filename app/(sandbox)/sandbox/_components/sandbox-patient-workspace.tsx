'use client';

import { Activity, AlertTriangle, CalendarPlus, ClipboardPen, FileText, FlaskConical, HeartPulse, MapPin, Pill, ShieldCheck, Stethoscope, Users } from 'lucide-react';
import { SANDBOX_PATIENTS } from '@/lib/sandbox/fixtures';
import type { SandboxPatient } from '@/lib/sandbox/types';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SectionHeading, SyntheticBanner, WeightTrend } from './sandbox-ui';

export function SandboxPatientWorkspace({ patient, documentedActions, onPatientChange, onDocumentAction }: {
  patient: SandboxPatient;
  documentedActions: string[];
  onPatientChange: (patientId: string) => void;
  onDocumentAction: (action: string) => void;
}) {
  const latestVital = patient.vitals.at(-1);
  const firstVital = patient.vitals[0];
  const weightDelta = latestVital && firstVital ? Number((latestVital.weight - firstVital.weight).toFixed(1)) : null;

  return (
    <div className="space-y-7" data-testid="sandbox-patient-360">
      <SectionHeading eyebrow="Synthetic patient workspace" title="Patient 360" description="A source-aware 60-second brief connects change, uncertainty, work, timeline, protocol context, action, and next deadline." />
      <SyntheticBanner>All patient profiles and clinical-looking values below are fictional and exist only to demonstrate information architecture.</SyntheticBanner>

      <section className="rounded-2xl border bg-white p-4" aria-label="Choose a synthetic patient">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Synthetic cohort</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {SANDBOX_PATIENTS.map((candidate) => (
            <button key={candidate.id} type="button" aria-pressed={candidate.id === patient.id} onClick={() => onPatientChange(candidate.id)} className={`min-h-16 rounded-xl border p-3 text-left transition ${candidate.id === patient.id ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-100' : 'border-slate-200 hover:border-blue-300'}`}>
              <span className="block font-bold text-slate-950">{candidate.name}</span>
              <span className="mt-1 block text-xs text-slate-600">{candidate.riskTier} risk · {candidate.track}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-2xl font-bold text-slate-950">{patient.name}</h2>
              <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-800">{patient.riskTier} risk</span>
              <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-800">{patient.track}</span>
            </div>
            <p className="mt-2 text-sm text-slate-600">Age {patient.age} · {patient.pronouns} · {patient.ckmStage} · {patient.facilityTier}</p>
            <p className="mt-2 inline-flex items-center gap-1 text-sm text-slate-600"><MapPin className="size-4" /> {patient.region} · {patient.distanceToCardiology} to cardiology</p>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950"><strong>Source:</strong> {patient.sourceFreshness}</div>
        </div>

        <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-red-700">Latest signal</p>
          <p className="mt-1 font-bold text-red-950">{patient.latestSignal}</p>
          <p className="mt-2 text-sm leading-6 text-red-900">{patient.changeSummary}</p>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5" aria-labelledby="brief-heading">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div><p className="text-xs font-semibold uppercase tracking-wide text-blue-700">60-second brief</p><h2 id="brief-heading" className="text-xl font-bold text-slate-950">What changed and what is next</h2></div>
          <p className="text-xs text-slate-500">Generated from synthetic sources now</p>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <BriefCard icon={<Activity className="size-4" />} title="Latest vitals">
            {latestVital ? <><p>{latestVital.weight} lb {weightDelta !== null && <span className={weightDelta > 0 ? 'font-semibold text-amber-700' : 'text-blue-700'}>· {weightDelta > 0 ? '+' : ''}{weightDelta} lb</span>}</p><p>BP {latestVital.sbp} · HR {latestVital.heartRate} · SpO₂ {latestVital.spo2}%</p></> : <p>Missing</p>}
          </BriefCard>
          <BriefCard icon={<Stethoscope className="size-4" />} title="Symptoms">{patient.symptoms.slice(0, 3).map((symptom) => <p key={symptom}>{symptom}</p>)}</BriefCard>
          <BriefCard icon={<FlaskConical className="size-4" />} title="Safety data">{patient.labs.slice(0, 3).map((lab) => <p key={lab.name}>{lab.name}: <strong>{lab.value}</strong></p>)}</BriefCard>
          <BriefCard icon={<ClipboardPen className="size-4" />} title="Operational context"><p>{patient.medications.filter((med) => med.status === 'active').length} active medications</p><p>{patient.missingData.length} data-quality gaps</p><p>Next: {patient.carePlan[0]}</p></BriefCard>
        </div>
        {patient.missingData.length > 0 && <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"><strong>Data quality:</strong> {patient.missingData.join(' · ')}. Verify source records before acting.</div>}
      </section>

      <section className="rounded-2xl border bg-white p-5" aria-labelledby="action-center-heading">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-semibold uppercase tracking-wide text-violet-700">Closed-loop workflow</p><h2 id="action-center-heading" className="text-xl font-bold text-slate-950">Action Center</h2></div><span className="text-xs text-slate-500">Synthetic actions only</span></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ActionButton icon={<ClipboardPen className="size-4" />} label="Document contact" onClick={() => onDocumentAction(`${patient.name}: contact outcome documented`)} />
          <ActionButton icon={<CalendarPlus className="size-4" />} label="Schedule follow-up" onClick={() => onDocumentAction(`${patient.name}: follow-up scheduled`)} />
          <ActionButton icon={<Users className="size-4" />} label="Route to team" onClick={() => onDocumentAction(`${patient.name}: routed to clinical owner`)} />
          <ActionButton icon={<FileText className="size-4" />} label="Generate SBAR" onClick={() => onDocumentAction(`${patient.name}: synthetic SBAR prepared`)} />
        </div>
        {documentedActions.length > 0 && <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950"><ShieldCheck className="mr-2 inline size-4" /><strong>Latest simulated action:</strong> {documentedActions.at(-1)}</div>}
      </section>

      <Tabs defaultValue="monitoring" className="rounded-2xl border bg-white p-4 sm:p-5">
        <TabsList className="min-h-12 w-full justify-start overflow-x-auto" aria-label="Synthetic patient record sections">
          <TabsTrigger value="monitoring">Monitoring</TabsTrigger>
          <TabsTrigger value="medications">Medications & labs</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="plan">Plan & access</TabsTrigger>
        </TabsList>

        <TabsContent value="monitoring" className="mt-5">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.75fr)]">
            <div className="rounded-xl border p-4"><h3 className="font-bold text-slate-950">Weight trend</h3><p className="mt-1 text-xs text-slate-500">Each point exposes source timing; no recommendation is generated.</p><WeightTrend data={patient.vitals} /></div>
            <div className="space-y-3"><h3 className="font-bold text-slate-950">Symptoms and signals</h3>{patient.symptoms.map((symptom) => <div key={symptom} className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700"><HeartPulse className="mr-2 inline size-4 text-blue-700" />{symptom}</div>)}</div>
          </div>
          <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><caption className="sr-only">Synthetic vital history</caption><thead><tr className="border-b text-xs uppercase text-slate-500"><th className="p-2">When</th><th className="p-2">Weight</th><th className="p-2">SBP</th><th className="p-2">Heart rate</th><th className="p-2">SpO₂</th></tr></thead><tbody>{patient.vitals.map((vital) => <tr key={vital.label} className="border-b last:border-0"><td className="p-2 font-medium">{vital.label}</td><td className="p-2">{vital.weight} lb</td><td className="p-2">{vital.sbp}</td><td className="p-2">{vital.heartRate}</td><td className="p-2">{vital.spo2}%</td></tr>)}</tbody></table></div>
        </TabsContent>

        <TabsContent value="medications" className="mt-5">
          <div className="grid gap-5 lg:grid-cols-2">
            <div><h3 className="flex items-center gap-2 font-bold text-slate-950"><Pill className="size-4" /> Medication reconciliation</h3><div className="mt-3 space-y-3">{patient.medications.map((med) => <div key={med.name} className="rounded-xl border p-4"><div className="flex flex-wrap justify-between gap-2"><strong>{med.name}</strong><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold">{med.status}</span></div><p className="mt-1 text-sm text-slate-700">{med.therapyClass} · {med.dose}</p><p className="mt-2 text-xs text-slate-500">{med.note}</p></div>)}</div></div>
            <div><h3 className="flex items-center gap-2 font-bold text-slate-950"><FlaskConical className="size-4" /> Labs and freshness</h3><div className="mt-3 space-y-3">{patient.labs.map((lab) => <div key={lab.name} className="rounded-xl border p-4"><div className="flex items-center justify-between gap-2"><strong>{lab.name}</strong><span className={lab.status === 'within range' ? 'text-xs font-semibold text-emerald-700' : 'text-xs font-semibold text-amber-700'}>{lab.status}</span></div><p className="mt-1 text-lg font-bold text-slate-950">{lab.value}</p><p className="text-xs text-slate-500">Collected {lab.collected}</p></div>)}</div></div>
          </div>
        </TabsContent>

        <TabsContent value="timeline" className="mt-5">
          <ol className="space-y-3">{patient.timeline.map((event) => <li key={event.id} className="grid gap-2 rounded-xl border p-4 sm:grid-cols-[120px_1fr]"><p className="text-xs font-semibold text-slate-500">{event.when}</p><div><p className="font-bold text-slate-950">{event.title}</p><p className="mt-1 text-sm text-slate-600">{event.detail}</p>{event.outcome && <p className="mt-2 text-xs font-semibold text-emerald-700">Outcome: {event.outcome}</p>}</div></li>)}</ol>
        </TabsContent>

        <TabsContent value="plan" className="mt-5">
          <div className="grid gap-5 lg:grid-cols-3">
            <div className="rounded-xl border p-4"><h3 className="font-bold text-slate-950">Care plan</h3><ol className="mt-3 space-y-3">{patient.carePlan.map((item, index) => <li key={item} className="flex gap-3 text-sm text-slate-700"><span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-800">{index + 1}</span>{item}</li>)}</ol></div>
            <div className="rounded-xl border p-4"><h3 className="font-bold text-slate-950">Education</h3><p className="mt-3 text-3xl font-bold text-slate-950">{patient.education.completed}/{patient.education.total}</p><p className="text-sm text-slate-600">modules complete</p><p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900"><strong>Next:</strong> {patient.education.next}</p></div>
            <div className="rounded-xl border p-4"><h3 className="font-bold text-slate-950">Access & privacy</h3><ul className="mt-3 space-y-3">{patient.access.map((item) => <li key={item} className="flex gap-2 text-sm text-slate-700"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-700" />{item}</li>)}</ul></div>
          </div>
        </TabsContent>
      </Tabs>

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><AlertTriangle className="mr-2 inline size-4" /><strong>Boundary:</strong> the brief organizes source information; it does not independently diagnose, prescribe, or replace record review and professional judgment.</div>
    </div>
  );
}

function BriefCard({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return <div className="rounded-xl border bg-white p-4"><div className="flex items-center gap-2 text-sm font-semibold text-slate-800">{icon}{title}</div><div className="mt-2 space-y-1 text-sm text-slate-700">{children}</div></div>;
}

function ActionButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return <Button type="button" variant="outline" className="min-h-14 justify-start" onClick={onClick}>{icon}<span className="ml-2">{label}</span></Button>;
}
