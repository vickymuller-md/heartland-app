'use client';

import { useState } from 'react';
import { BookOpen, Check, HeartPulse, LockKeyhole, MessageSquareText, PhoneCall, PhoneIncoming, Pill, Scale, ShieldAlert } from 'lucide-react';
import type { SandboxPatient } from '@/lib/sandbox/types';
import { Button } from '@/components/ui/button';
import { SandboxAiCheckIn } from './sandbox-ai-checkin';
import { SandboxLiveCall } from './sandbox-live-call';
import { SectionHeading, SyntheticBanner } from './sandbox-ui';

export function SandboxPatientView({ patient, patientCheckIns, onCheckIn }: {
  patient: SandboxPatient;
  patientCheckIns: string[];
  onCheckIn: (checkInId: string) => void;
}) {
  const [showCheckIn, setShowCheckIn] = useState(false);
  const [showLiveCall, setShowLiveCall] = useState(false);
  const [showTitrationCall, setShowTitrationCall] = useState(false);
  const symptomsTaskId = `${patient.id}-symptoms`;
  const tasks = [
    { id: `${patient.id}-weight`, icon: Scale, title: 'Record today’s weight', detail: patient.vitals.at(-1) ? `Last synthetic value: ${patient.vitals.at(-1)?.weight} lb` : 'No recent value' },
    { id: `${patient.id}-meds`, icon: Pill, title: 'Confirm medications', detail: `${patient.medications.length} medications on the current synthetic list` },
    { id: symptomsTaskId, icon: HeartPulse, title: 'Complete symptom check-in', detail: 'AI-assisted conversation (demonstration) with rule-based red-flag routing' },
    { id: `${patient.id}-education`, icon: BookOpen, title: 'Review next education item', detail: patient.education.next },
  ];
  const completed = tasks.filter((task) => patientCheckIns.includes(task.id)).length;

  return (
    <div className="space-y-7" data-testid="sandbox-patient-view">
      <SectionHeading eyebrow="Two-sided product" title="Patient Today experience" description="The same operational loop becomes a simple daily plan: what to do, what changed, when to seek help, who will follow up, and who can access data." />
      <SyntheticBanner>This is a fictional patient portal preview. Buttons update only local tour progress and never submit health information.</SyntheticBanner>

      <div className="grid gap-7 xl:grid-cols-[minmax(320px,0.7fr)_minmax(0,1.3fr)]">
        <section className="mx-auto w-full max-w-md rounded-[2rem] border-8 border-slate-900 bg-slate-50 shadow-xl" aria-label="Synthetic mobile patient portal">
          <div className="rounded-t-[1.45rem] bg-slate-950 px-5 py-4 text-white"><p className="text-xs font-semibold uppercase tracking-wide text-blue-300">HEARTLAND Today</p><h2 className="mt-1 text-xl font-bold">Good morning, {patient.name.split(' ')[0]}</h2></div>
          <div className="space-y-4 p-4 sm:p-5">
            <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase text-blue-700">Today’s progress</p><p className="mt-1 text-2xl font-bold text-slate-950">{completed}/{tasks.length}</p></div><div className="flex size-12 items-center justify-center rounded-full bg-white text-lg font-bold text-blue-700">{Math.round((completed / tasks.length) * 100)}%</div></div></div>

            <div className="space-y-3">{tasks.map((task) => {
              const done = patientCheckIns.includes(task.id);
              const Icon = task.icon;
              return <button key={task.id} type="button" onClick={() => task.id === symptomsTaskId ? setShowCheckIn(true) : onCheckIn(task.id)} className={`flex min-h-20 w-full items-center gap-3 rounded-xl border p-3 text-left transition ${done ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white hover:border-blue-300'}`}><span className={done ? 'flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-white' : 'flex size-10 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700'}>{done ? <Check className="size-5" /> : <Icon className="size-5" />}</span><span><strong className="block text-sm text-slate-950">{task.title}</strong><span className="mt-1 block text-xs leading-5 text-slate-600">{done ? 'Completed in this synthetic visit' : task.detail}</span></span></button>;
            })}</div>

            {showCheckIn && (
              <SandboxAiCheckIn
                key={patient.id}
                patient={patient}
                onComplete={() => onCheckIn(symptomsTaskId)}
                onClose={() => setShowCheckIn(false)}
              />
            )}

            {!showLiveCall && (
              <button
                type="button"
                data-testid="open-live-call"
                onClick={() => { setShowCheckIn(false); setShowLiveCall(true); }}
                className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-left transition hover:border-emerald-400"
              >
                <span className="flex size-10 shrink-0 animate-pulse items-center justify-center rounded-full bg-emerald-700 text-white"><PhoneIncoming className="size-5" /></span>
                <span><strong className="block text-sm text-slate-950">Incoming check-in call (simulated)</strong><span className="mt-0.5 block text-xs leading-5 text-slate-600">Answer the automated daily call and play the synthetic patient</span></span>
              </button>
            )}

            {showLiveCall && (
              <SandboxLiveCall
                key={`call-${patient.id}`}
                patient={patient}
                onComplete={() => onCheckIn(`${patient.id}-call`)}
                onClose={() => setShowLiveCall(false)}
              />
            )}

            {!showTitrationCall && (
              <button
                type="button"
                data-testid="open-titration-call"
                onClick={() => { setShowCheckIn(false); setShowTitrationCall(true); }}
                className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-left transition hover:border-blue-400"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-blue-700 text-white"><PhoneIncoming className="size-5" /></span>
                <span><strong className="block text-sm text-slate-950">Titration follow-up call (simulated)</strong><span className="mt-0.5 block text-xs leading-5 text-slate-600">Answer the follow-up about the recent dose adjustment; registered safety gates decide the outcome</span></span>
              </button>
            )}

            {showTitrationCall && (
              <SandboxLiveCall
                key={`titration-${patient.id}`}
                patient={patient}
                scriptId="titration_followup"
                onComplete={() => onCheckIn(`${patient.id}-titration-call`)}
                onClose={() => setShowTitrationCall(false)}
              />
            )}

            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4"><ShieldAlert className="size-5 text-amber-800" /><p className="mt-2 text-sm font-bold text-amber-950">Symptoms getting worse?</p><p className="mt-1 text-xs leading-5 text-amber-900">Follow your care team’s instructions. For a medical emergency, call emergency services.</p></div>
          </div>
        </section>

        <div className="space-y-5">
          <section className="rounded-2xl border bg-white p-5 sm:p-6">
            <h2 className="text-xl font-bold text-slate-950">Plan and next contact</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Next care-team action</p><p className="mt-2 font-bold text-slate-950">{patient.carePlan[0]}</p><p className="mt-2 text-sm text-slate-600">Owner and deadline remain visible to the patient where appropriate.</p></div>
              <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Education progress</p><p className="mt-2 text-3xl font-bold text-slate-950">{patient.education.completed}/{patient.education.total}</p><p className="mt-2 text-sm text-slate-600">Next: {patient.education.next}</p></div>
            </div>
            <div className="mt-4 flex flex-wrap gap-3"><Button variant="outline" className="min-h-11" onClick={() => onCheckIn(`${patient.id}-message`)}><MessageSquareText className="mr-2 size-4" /> Message care team</Button><Button variant="outline" className="min-h-11" onClick={() => onCheckIn(`${patient.id}-call`)}><PhoneCall className="mr-2 size-4" /> View contact plan</Button></div>
          </section>

          <section className="rounded-2xl border bg-white p-5 sm:p-6">
            <div className="flex items-center gap-3"><LockKeyhole className="size-6 text-violet-700" /><div><h2 className="text-xl font-bold text-slate-950">Privacy and access</h2><p className="text-sm text-slate-600">Patients can see and revoke relationships.</p></div></div>
            <ul className="mt-4 space-y-3">{patient.access.map((access) => <li key={access} className="flex gap-3 rounded-xl bg-slate-50 p-4 text-sm text-slate-700"><Check className="mt-0.5 size-4 shrink-0 text-emerald-700" />{access}</li>)}</ul>
            <p className="mt-4 text-xs leading-5 text-slate-500">The real portal also distinguishes delivered/read communication and exposes access history without showing internal audit payloads.</p>
          </section>

          <section className="rounded-2xl bg-slate-950 p-5 text-white sm:p-6">
            <h2 className="text-xl font-bold">Why this matters for adoption</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">{[['One screen', 'Clear daily work'], ['Plain language', 'Lower cognitive burden'], ['Closed loop', 'Next action stays visible']].map(([value, label]) => <div key={value} className="rounded-xl bg-white/10 p-4"><p className="font-bold">{value}</p><p className="mt-1 text-xs text-slate-300">{label}</p></div>)}</div>
          </section>
        </div>
      </div>
    </div>
  );
}
