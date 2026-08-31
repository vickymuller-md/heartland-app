'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, BookOpen, Users, Activity, Phone, ClipboardCheck, Bell, FileText, Radio, Pill, BarChart2, ClipboardList, Stethoscope, CreditCard, FileBarChart2 } from 'lucide-react';
import { ProtocolAssistant } from './protocol-assistant';

/* ------------------------------------------------------------------ */
/*  Table of Contents                                                  */
/* ------------------------------------------------------------------ */

const TOC = [
  { id: 'overview', label: 'System Overview', icon: BookOpen },
  { id: 'getting-started', label: 'Getting Started', icon: Users },
  { id: 'patient-onboarding', label: 'Patient Onboarding', icon: Users },
  { id: 'daily-workflow-patient', label: 'Patient Daily Workflow', icon: Activity },
  { id: 'daily-workflow-provider', label: 'Provider Daily Workflow', icon: Bell },
  { id: 'risk-calculator', label: 'Risk Stratification', icon: Activity },
  { id: 'gdmt-pathway', label: 'GDMT Optimization', icon: Pill },
  { id: 'titration', label: 'Telephone Titration', icon: Phone },
  { id: 'remote-monitoring', label: 'Remote Monitoring & Tracks', icon: Radio },
  { id: 'track-b', label: 'Track B (Analog Pathway)', icon: FileText },
  { id: 'alerts', label: 'Alerts & Triage', icon: Bell },
  { id: 'discharge', label: 'Discharge & Follow-up', icon: ClipboardList },
  { id: 'messaging', label: 'Patient Messaging', icon: FileText },
  { id: 'sbar', label: 'SBAR Handoff', icon: ClipboardCheck },
  { id: 'comorbidity', label: 'Comorbidity Manager', icon: Stethoscope },
  { id: 'quality-metrics', label: 'Quality Metrics', icon: BarChart2 },
  { id: 'reports', label: 'Reports & Export', icon: FileBarChart2 },
  { id: 'pocket-cards', label: 'Pocket Cards', icon: CreditCard },
  { id: 'troubleshooting', label: 'Troubleshooting & FAQ', icon: BookOpen },
];

/* ------------------------------------------------------------------ */
/*  Collapsible Section Component                                      */
/* ------------------------------------------------------------------ */

function Section({ id, title, icon: Icon, children }: {
  id: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section id={id} className="scroll-mt-20 border-b border-gray-200 pb-8 mb-8">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 text-left group"
      >
        <Icon className="h-6 w-6 text-blue-600 shrink-0" />
        <h2 className="text-xl font-semibold text-gray-900 flex-1">{title}</h2>
        {open ? <ChevronDown className="h-5 w-5 text-gray-400" /> : <ChevronRight className="h-5 w-5 text-gray-400" />}
      </button>
      {open && <div className="mt-4 space-y-4 text-gray-700 leading-relaxed">{children}</div>}
    </section>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700 font-bold text-sm">
        {n}
      </div>
      <div className="flex-1">
        <h4 className="font-medium text-gray-900 mb-1">{title}</h4>
        <div className="text-sm text-gray-600 space-y-2">{children}</div>
      </div>
    </div>
  );
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
      <strong>Tip:</strong> {children}
    </div>
  );
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
      <strong>Important:</strong> {children}
    </div>
  );
}

function NavPath({ path }: { path: string }) {
  return <span className="inline-flex items-center rounded bg-gray-100 px-2 py-0.5 text-xs font-mono text-gray-700">{path}</span>;
}

/* ------------------------------------------------------------------ */
/*  Main Guide Content                                                 */
/* ------------------------------------------------------------------ */

export function GuideContent() {
  return (
    <div className="print:text-sm">
      {/* Header */}
      <div className="mb-10 text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-blue-600 mb-2">HEARTLAND Protocol</p>
        <h1 className="text-3xl font-bold text-gray-900 mb-3">Provider User Guide</h1>
        <p className="text-gray-500 max-w-2xl mx-auto">
          A complete step-by-step guide for healthcare professionals using the HEARTLAND Protocol
          Clinical Implementation Companion for rural heart failure management.
        </p>
        <p className="text-xs text-gray-400 mt-2">Version 4.0 &middot; Last updated March 2026</p>
      </div>

      {/* Reference assistant over the published implementation content */}
      <ProtocolAssistant />

      {/* Table of Contents */}
      <nav className="mb-12 rounded-lg border border-gray-200 bg-gray-50 p-6 print:hidden">
        <h3 className="font-semibold text-gray-900 mb-3">Table of Contents</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {TOC.map(({ id, label, icon: Icon }) => (
            <a
              key={id}
              href={`#${id}`}
              className="flex items-center gap-2 rounded px-2 py-1.5 text-sm text-gray-600 hover:bg-white hover:text-blue-700 transition-colors"
            >
              <Icon className="h-4 w-4 text-gray-400" />
              {label}
            </a>
          ))}
        </div>
      </nav>

      {/* ============================================================ */}
      {/*  1. SYSTEM OVERVIEW                                          */}
      {/* ============================================================ */}
      <Section id="overview" title="System Overview" icon={BookOpen}>
        <p>
          The HEARTLAND Protocol App is a <strong>two-sided clinical implementation platform</strong> designed
          specifically for primary care providers managing heart failure (HF) patients in rural and
          resource-limited settings. It bridges the gap between rural primary care and specialist
          cardiology by providing evidence-based tools directly in the provider&apos;s workflow.
        </p>

        <h3 className="font-semibold text-gray-900 mt-6 mb-2">Two Portals</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="rounded-lg border p-4">
            <h4 className="font-medium text-blue-700 mb-1">Provider Portal</h4>
            <p className="text-sm">Dashboard, clinical tools (risk calculator, GDMT, titration), patient management,
              alerts, discharge planning, reports, and quality metrics.</p>
          </div>
          <div className="rounded-lg border p-4">
            <h4 className="font-medium text-emerald-700 mb-1">Patient Portal</h4>
            <p className="text-sm">Daily vitals logging, symptom reporting, medication tracking, education modules,
              and provider messages. Designed for elderly users with large text and simple navigation.</p>
          </div>
        </div>

        <h3 className="font-semibold text-gray-900 mt-6 mb-2">Key Features</h3>
        <ul className="list-disc list-inside space-y-1 text-sm">
          <li><strong>Offline-First:</strong> Works without internet. Vitals are saved locally and sync when connectivity returns.</li>
          <li><strong>Mobile-Friendly:</strong> Installable as a phone app (PWA). No App Store download needed.</li>
          <li><strong>Controlled Evaluation Boundary:</strong> Authenticated workspaces use organization-scoped access controls and cloud storage, with limited offline state available for resilience. This release does not establish HIPAA readiness or compliance; real-PHI use remains unauthorized until institutional security, privacy, legal, operational, and assurance gates are completed.</li>
          <li><strong>Print-Ready:</strong> Every tool can be printed for paper-based workflows.</li>
          <li><strong>Dual Track:</strong> Track A (Digital) for smartphone patients, Track B (Analog) for paper-based patients.</li>
        </ul>

        <h3 className="font-semibold text-gray-900 mt-6 mb-2">Clinical Workflow Overview</h3>
        <div className="rounded-lg border bg-white p-4 text-sm space-y-2">
          <p className="font-medium text-gray-900">The patient journey through the HEARTLAND Protocol:</p>
          <ol className="list-decimal list-inside space-y-1 ml-2">
            <li><strong>Registration & Linkage</strong> &mdash; Provider invites patient or shares provider code</li>
            <li><strong>Onboarding</strong> &mdash; Risk assessment, track assignment, medication setup, education</li>
            <li><strong>Daily Monitoring</strong> &mdash; Patient logs vitals/symptoms; provider reviews dashboard</li>
            <li><strong>Titration Calls</strong> &mdash; Scheduled phone-based medication optimization</li>
            <li><strong>Alert Response</strong> &mdash; Provider triages red flags and proactive alerts</li>
            <li><strong>Discharge Planning</strong> &mdash; Bundle checklist, follow-up scheduling, handoff documents</li>
            <li><strong>Ongoing Management</strong> &mdash; Quality metrics tracking, reports, comorbidity management</li>
          </ol>
        </div>
      </Section>

      {/* ============================================================ */}
      {/*  2. GETTING STARTED                                          */}
      {/* ============================================================ */}
      <Section id="getting-started" title="Getting Started" icon={Users}>
        <h3 className="font-semibold text-gray-900 mb-2">Creating Your Provider Account</h3>
        <div className="space-y-4">
          <Step n={1} title="Register at the app">
            <p>Visit <strong>app.heartlandprotocol.org</strong> and click &quot;Register.&quot;</p>
            <p>Select <strong>&quot;Healthcare Professional&quot;</strong> as your role. Enter your name, email, and create a password.</p>
          </Step>
          <Step n={2} title="Accept the consent agreement">
            <p>Read the informed consent dialog that explains this is a clinical implementation tool for professional use only. Click &quot;Accept&quot; to proceed.</p>
          </Step>
          <Step n={3} title="Access your Provider Portal">
            <p>After registration, you will be automatically redirected to your <strong>Dashboard</strong>. Your unique <strong>Provider Code</strong> (a 6-character code like &quot;HLP-A3BX&quot;) is generated automatically.</p>
          </Step>
          <Step n={4} title="Assess your facility tier">
            <p>Navigate to <NavPath path="Sidebar &rarr; Tier Selector" /> and complete the facility resource questionnaire. This determines whether your facility operates at Tier 1 (Minimal), Tier 2 (Standard), or Tier 3 (Advanced), which affects quality metric targets and discharge checklist complexity.</p>
          </Step>
        </div>

        <h3 className="font-semibold text-gray-900 mt-8 mb-2">Inviting Your First Patient</h3>
        <p>There are two ways to link patients to your account:</p>

        <h4 className="font-medium mt-4 mb-2">Option A: Provider-Initiated Invite (Recommended)</h4>
        <div className="space-y-4">
          <Step n={1} title="Send an email invite">
            <p>Go to <NavPath path="Sidebar &rarr; Invite Patient" />. Enter the patient&apos;s email address and click &quot;Send Invite.&quot;</p>
          </Step>
          <Step n={2} title="Patient receives invite and registers">
            <p>The patient receives an email with a link to register. When they create their account, the linkage is automatically established.</p>
          </Step>
          <Step n={3} title="Confirm linkage">
            <p>Go to <NavPath path="Sidebar &rarr; Patients" /> to see the patient appear in your panel.</p>
          </Step>
        </div>

        <h4 className="font-medium mt-4 mb-2">Option B: Patient Uses Your Provider Code</h4>
        <div className="space-y-4">
          <Step n={1} title="Share your Provider Code">
            <p>Give the patient your 6-character Provider Code (found at <NavPath path="Sidebar &rarr; Patients &rarr; Manage" />). They can enter this code during registration or later via their &quot;Link Provider&quot; page.</p>
          </Step>
          <Step n={2} title="Accept the linkage request">
            <p>When a patient requests linkage, you will see a pending request at <NavPath path="Patients &rarr; Manage" />. Click &quot;Accept&quot; to confirm.</p>
          </Step>
        </div>

        <Tip>
          For elderly or technology-limited patients, use Option A (email invite) and assist them with registration during an office visit. For Track B (Analog) patients, register them yourself and manage their data through the provider portal.
        </Tip>
      </Section>

      {/* ============================================================ */}
      {/*  3. PATIENT ONBOARDING                                       */}
      {/* ============================================================ */}
      <Section id="patient-onboarding" title="Patient Onboarding" icon={Users}>
        <p>
          After a patient is linked to your account, an <strong>&quot;Setup Incomplete&quot;</strong> badge appears on their
          card in the Dashboard. The onboarding wizard ensures every patient has a complete clinical profile before
          monitoring begins.
        </p>

        <h3 className="font-semibold text-gray-900 mt-4 mb-2">Onboarding Wizard (5 Steps)</h3>
        <p className="text-sm mb-4">Navigate to the patient&apos;s detail page and click the amber <strong>&quot;Complete Setup&quot;</strong> banner, or go directly to <NavPath path="Patient Detail &rarr; Onboarding" />.</p>

        <div className="space-y-4">
          <Step n={1} title="Risk Stratification">
            <p>Run the 10-variable HEARTLAND Risk Score. Toggle each variable based on the patient&apos;s clinical profile. The score (0&ndash;18) determines their risk tier: Low (0&ndash;4), Moderate (5&ndash;8), or High (9+).</p>
            <p>The result is automatically saved to the patient&apos;s profile.</p>
          </Step>
          <Step n={2} title="Track Assignment">
            <p>Assess whether the patient should be on <strong>Track A (Digital)</strong> or <strong>Track B (Analog)</strong>:</p>
            <ul className="list-disc list-inside ml-4 mt-1">
              <li><strong>Track A:</strong> Patient has a smartphone, can use apps, and has internet access</li>
              <li><strong>Track B:</strong> Patient relies on telephone only, uses a paper diary for daily monitoring</li>
              <li><strong>Hybrid:</strong> Patient has some digital capability but limited connectivity</li>
            </ul>
          </Step>
          <Step n={3} title="Medication Setup">
            <p>Navigate to the GDMT Pathway and confirm the patient&apos;s current medications. Use the &quot;Save Medications&quot; feature to record their drug classes and doses in the system.</p>
          </Step>
          <Step n={4} title="Device Setup Guide">
            <p>For Track A patients: Instruct them to install the app on their phone (visit the website, tap &quot;Add to Home Screen&quot;). For Track B patients: Print the 7-day monitoring diary and Red Flag card.</p>
          </Step>
          <Step n={5} title="Education Modules">
            <p>Assign the patient their education modules. All patients receive 3 core modules (daily weight monitoring, medication adherence, warning signs). Tier 2/3 patients receive 5 additional modules.</p>
          </Step>
        </div>

        <Warning>
          Complete onboarding before the patient begins daily monitoring. Without a risk score and track assignment,
          the system cannot properly generate alerts or tailor the patient experience.
        </Warning>
      </Section>

      {/* ============================================================ */}
      {/*  4. PATIENT DAILY WORKFLOW                                   */}
      {/* ============================================================ */}
      <Section id="daily-workflow-patient" title="Patient Daily Workflow" icon={Activity}>
        <p>
          Educate your patients on the following daily routine. This is what they see when they open the app each day.
        </p>

        <h3 className="font-semibold text-gray-900 mt-4 mb-2">For Track A (Digital) Patients</h3>
        <p className="text-sm mb-2">Instruct the patient to complete these steps <strong>every morning before eating or drinking</strong>:</p>
        <div className="space-y-4">
          <Step n={1} title="Open the app">
            <p>The patient opens the HEARTLAND app on their phone. They land on the <strong>&quot;Today&quot;</strong> page.</p>
          </Step>
          <Step n={2} title="Log weight">
            <p>Step on the scale and enter their weight in pounds. The app stores decimal values (e.g., 185.5 lbs).</p>
          </Step>
          <Step n={3} title="Log blood pressure and heart rate">
            <p>Measure BP using their home cuff. Enter systolic, diastolic, and heart rate.</p>
          </Step>
          <Step n={4} title="Log SpO2 (optional)">
            <p>If the patient has a pulse oximeter, enter the reading. Otherwise, skip this field.</p>
          </Step>
          <Step n={5} title="Complete symptom checklist">
            <p>Rate shortness of breath, swelling, fatigue, and orthopnea on a 4-point scale (None / Mild / Moderate / Severe).</p>
          </Step>
          <Step n={6} title="Submit">
            <p>Tap &quot;Submit.&quot; The app checks for red flags automatically. If a red flag is detected (e.g., 3+ lb weight gain in 2 days), the patient sees an immediate alert with instructions.</p>
          </Step>
          <Step n={7} title="Check medications">
            <p>The patient marks each medication dose as taken on the Medications tab. This builds their adherence record.</p>
          </Step>
        </div>

        <Tip>
          If the patient has no internet, vitals are saved locally and sync automatically when connectivity returns. The app works fully offline.
        </Tip>

        <h3 className="font-semibold text-gray-900 mt-6 mb-2">For Track B (Analog) Patients</h3>
        <div className="space-y-4">
          <Step n={1} title="Fill the paper diary">
            <p>Each morning, the patient records their weight, BP, HR, and symptoms on the printed 7-day diary (provided during onboarding).</p>
          </Step>
          <Step n={2} title="Call provider on schedule">
            <p>At the scheduled call time (typically weekly or bi-weekly), the patient reads their diary entries to the provider.</p>
          </Step>
          <Step n={3} title="Provider enters data">
            <p>The provider enters the vitals into the system via <NavPath path="Patient Detail &rarr; Track B Entry" />. The data flows through the same alert pipeline as Track A.</p>
          </Step>
        </div>

        <Warning>
          For Track B patients, print both the <strong>7-Day Monitoring Diary</strong> and the <strong>Red Flag Instruction Card</strong>.
          The Red Flag card tells the patient when to call 911, when to call the clinic, and when to note the symptom for the next call.
          Access both at <NavPath path="Patient Detail &rarr; Track B Diary" />.
        </Warning>
      </Section>

      {/* ============================================================ */}
      {/*  5. PROVIDER DAILY WORKFLOW                                  */}
      {/* ============================================================ */}
      <Section id="daily-workflow-provider" title="Provider Daily Workflow" icon={Bell}>
        <p>Here is the recommended daily routine for managing your HF patient panel:</p>

        <div className="space-y-4">
          <Step n={1} title="Check the Alerts inbox">
            <p>Start your day at <NavPath path="Sidebar &rarr; Alerts" />. Review all <strong>open alerts</strong> sorted by severity. Critical alerts (red) require immediate action. Warning alerts (amber) need attention within 24 hours. Informational alerts (blue) are for awareness.</p>
            <p><strong>Alert types:</strong></p>
            <ul className="list-disc list-inside ml-4 mt-1">
              <li><strong>Weight gain 3+ lbs/2 days</strong> (critical) &mdash; Call patient, assess fluid status</li>
              <li><strong>SBP &lt;90 with symptoms</strong> (critical) &mdash; Evaluate for hypotension, may need dose reduction</li>
              <li><strong>SpO2 &lt;92%</strong> (critical) &mdash; Assess for decompensation</li>
              <li><strong>No check-in 3+ days</strong> (informational) &mdash; Contact patient to re-engage</li>
              <li><strong>Low medication adherence</strong> (warning) &mdash; Discuss barriers at next call</li>
              <li><strong>K+ &gt;5.5</strong> (critical) &mdash; Hold MRA/ACEi, recheck labs urgently</li>
            </ul>
          </Step>
          <Step n={2} title="Review the Dashboard">
            <p>Go to <NavPath path="Sidebar &rarr; Dashboard" />. The metric cards show your panel&apos;s KPIs at a glance: total patients, active alerts, patients with no check-in, and average medication adherence.</p>
            <p>Sort the patient list by <strong>&quot;Alert Status&quot;</strong> to see who needs attention first, or by <strong>&quot;Last Vitals&quot;</strong> to find patients who haven&apos;t reported recently.</p>
          </Step>
          <Step n={3} title="Drill into patients needing attention">
            <p>Click on any patient to see their full record: vitals trends, symptom history, labs, medications, and notes. Use the tabs to review each aspect of their care.</p>
          </Step>
          <Step n={4} title="Conduct titration calls">
            <p>For patients scheduled for titration, go to <NavPath path="Sidebar &rarr; Titration" />. Select the patient, review their latest vitals and labs, and step through the 5-step checklist.</p>
          </Step>
          <Step n={5} title="Send messages as needed">
            <p>Use the Notes tab on any patient&apos;s detail page to send structured messages (dose changes, appointment reminders, general instructions). The patient will see these as cards on their Today page.</p>
          </Step>
          <Step n={6} title="Document and close">
            <p>After each clinical interaction, save a clinical note. For titration calls, the note is auto-generated and saved. For other interactions, type a free-text note in the Notes tab.</p>
          </Step>
        </div>

        <Tip>
          The dashboard shows patients with 16+ app-entry days as a workflow completeness marker. It is not a CPT 99454 eligibility determination.
        </Tip>
      </Section>

      {/* ============================================================ */}
      {/*  6. RISK STRATIFICATION CALCULATOR                           */}
      {/* ============================================================ */}
      <Section id="risk-calculator" title="Risk Stratification Calculator" icon={Activity}>
        <p>
          The HEARTLAND Risk Score is a 10-variable tool that stratifies patients into Low, Moderate, or High risk
          tiers. Unlike MAGGIC or GWTG-HF scores, it includes <strong>distance to cardiology</strong> and
          <strong> social support</strong> &mdash; factors critical for rural patients.
        </p>

        <h3 className="font-semibold text-gray-900 mt-4 mb-2">Variables (10 total, each scored 0&ndash;2 points)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2 pr-4 font-medium">Variable</th>
                <th className="py-2 pr-4 font-medium">Points</th>
                <th className="py-2 font-medium">Category</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              <tr><td className="py-1.5 pr-4">Age &ge;75</td><td className="py-1.5 pr-4">2</td><td className="py-1.5">Clinical</td></tr>
              <tr><td className="py-1.5 pr-4">Prior HF hospitalization (within 6 months)</td><td className="py-1.5 pr-4">2</td><td className="py-1.5">Clinical</td></tr>
              <tr><td className="py-1.5 pr-4">eGFR &lt;45</td><td className="py-1.5 pr-4">2</td><td className="py-1.5">Laboratory</td></tr>
              <tr><td className="py-1.5 pr-4">BNP &ge;500 / NT-proBNP &ge;1500</td><td className="py-1.5 pr-4">2</td><td className="py-1.5">Laboratory</td></tr>
              <tr><td className="py-1.5 pr-4">SBP &lt;100 mmHg</td><td className="py-1.5 pr-4">1</td><td className="py-1.5">Clinical</td></tr>
              <tr><td className="py-1.5 pr-4">Diabetes mellitus</td><td className="py-1.5 pr-4">1</td><td className="py-1.5">Comorbidity</td></tr>
              <tr><td className="py-1.5 pr-4">LVEF &lt;30%</td><td className="py-1.5 pr-4">2</td><td className="py-1.5">Cardiac</td></tr>
              <tr><td className="py-1.5 pr-4">CKM Stage 3&ndash;4</td><td className="py-1.5 pr-4">2</td><td className="py-1.5">Comorbidity</td></tr>
              <tr><td className="py-1.5 pr-4">Distance to cardiology &gt;50 miles</td><td className="py-1.5 pr-4">1</td><td className="py-1.5">Geographic</td></tr>
              <tr><td className="py-1.5 pr-4">Lives alone / limited social support</td><td className="py-1.5 pr-4">1</td><td className="py-1.5">Social</td></tr>
            </tbody>
          </table>
        </div>

        <h3 className="font-semibold text-gray-900 mt-6 mb-2">Risk Tiers & Recommended Actions</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-lg border-l-4 border-emerald-500 bg-emerald-50 p-3">
            <h4 className="font-medium text-emerald-800">Low Risk (0&ndash;4)</h4>
            <p className="text-xs text-emerald-700 mt-1">Standard GDMT optimization. Monthly follow-up calls. Track A or B per patient preference.</p>
          </div>
          <div className="rounded-lg border-l-4 border-amber-500 bg-amber-50 p-3">
            <h4 className="font-medium text-amber-800">Moderate Risk (5&ndash;8)</h4>
            <p className="text-xs text-amber-700 mt-1">Aggressive GDMT titration. Bi-weekly calls. Consider Track A for closer monitoring. RPM billing eligible.</p>
          </div>
          <div className="rounded-lg border-l-4 border-red-500 bg-red-50 p-3">
            <h4 className="font-medium text-red-800">High Risk (9+)</h4>
            <p className="text-xs text-red-700 mt-1">Weekly titration calls. Daily monitoring required. Consider advanced HF referral. Discharge planning priority.</p>
          </div>
        </div>

        <Tip>
          Select a patient from the Patient Selector dropdown to auto-save the risk score to their profile. The score appears in their Info tab and is used by the SBAR handoff generator.
        </Tip>
      </Section>

      {/* ============================================================ */}
      {/*  7. GDMT OPTIMIZATION                                        */}
      {/* ============================================================ */}
      <Section id="gdmt-pathway" title="GDMT Optimization Pathway" icon={Pill}>
        <p>
          The GDMT Pathway provides evidence-based medication optimization guidance for both HFrEF (LVEF &le;40%)
          and HFpEF (LVEF &gt;40%). All content matches the published HEARTLAND Protocol v3.3.
        </p>

        <h3 className="font-semibold text-gray-900 mt-4 mb-2">HFrEF: Quadruple Therapy</h3>
        <p className="text-sm">The four foundational drug classes, each with starting dose, target dose, and safety gates:</p>
        <ol className="list-decimal list-inside text-sm space-y-1 ml-4 mt-2">
          <li><strong>ACEi/ARB/ARNI</strong> &mdash; Start low, uptitrate every 2 weeks. Switch to ARNI when stable on ACEi/ARB.</li>
          <li><strong>Beta-Blocker</strong> &mdash; Start after euvolemic. Uptitrate every 2 weeks. Target HR &lt;70 bpm.</li>
          <li><strong>MRA</strong> (Spironolactone) &mdash; Check K+ and Cr before starting. Monitor K+ at 1 week.</li>
          <li><strong>SGLT2 inhibitor</strong> &mdash; Can be started regardless of diabetes status. Monitor eGFR at 1 month.</li>
        </ol>

        <h3 className="font-semibold text-gray-900 mt-4 mb-2">Evidence Labels</h3>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800">Established (Green)</span>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">Emerging (Yellow)</span>
          <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">Pragmatic (Gray)</span>
        </div>
        <p className="text-sm mt-2">Green labels indicate guideline-proven therapies. Yellow labels are based on recent trials (e.g., FINEARTS-HF). Gray labels are cost/access-driven pragmatic choices.</p>

        <h3 className="font-semibold text-gray-900 mt-4 mb-2">Generic Bridge Program</h3>
        <p className="text-sm">
          The Generic Bridge Calculator shows how to initiate foundational therapy for approximately <strong>$15/month</strong> using
          generic ACEi + generic beta-blocker + generic MRA + metformin. This is critical for uninsured patients or facilities
          without 340B access.
        </p>

        <Tip>
          Select a patient and use the &quot;Save Medications&quot; button to record their GDMT medications directly to their profile. This feeds into the adherence tracker and SBAR generator.
        </Tip>
      </Section>

      {/* ============================================================ */}
      {/*  8. TELEPHONE TITRATION                                      */}
      {/* ============================================================ */}
      <Section id="titration" title="Telephone Titration Checklist" icon={Phone}>
        <p>
          The Titration Checklist is a <strong>5-step guided workflow</strong> for phone-based medication adjustment,
          based on the Hozho Trial methodology (which achieved 53% GDMT optimization via telephone).
        </p>

        <h3 className="font-semibold text-gray-900 mt-4 mb-2">Before the Call</h3>
        <p className="text-sm">Go to <NavPath path="Sidebar &rarr; Titration" /> and select the patient. Their latest vitals, labs, and medications auto-populate.</p>

        <h3 className="font-semibold text-gray-900 mt-4 mb-2">During the Call (5 Steps)</h3>
        <div className="space-y-4">
          <Step n={1} title="Pre-Call Vitals">
            <p>Confirm the patient&apos;s current vitals. If the auto-populated values are outdated, ask the patient to report current weight, BP, and HR. Enter any new values.</p>
          </Step>
          <Step n={2} title="Medication Review">
            <p>Review the patient&apos;s current medications and doses. Confirm they have been taking medications as prescribed. Note any missed doses or side effects.</p>
          </Step>
          <Step n={3} title="Safety Gate Check">
            <p>The system automatically evaluates safety gates based on the patient&apos;s latest labs:</p>
            <ul className="list-disc list-inside ml-4 mt-1">
              <li>K+ &gt;5.5 mEq/L &rarr; <strong>HOLD</strong> MRA uptitration</li>
              <li>Creatinine increase &gt;30% &rarr; <strong>HOLD</strong> ACEi/ARNI uptitration</li>
              <li>SBP &lt;90 mmHg &rarr; <strong>HOLD</strong> all uptitrations</li>
              <li>HR &lt;50 bpm &rarr; <strong>HOLD</strong> beta-blocker uptitration</li>
            </ul>
            <p className="mt-1">If any gate fails, the system flags it in red. You can still proceed with clinical judgment, but the gate provides a safety check.</p>
          </Step>
          <Step n={4} title="Titration Decision">
            <p>Based on the safety gate results, decide for each drug class: <strong>Increase</strong>, <strong>Hold</strong>, or <strong>Decrease</strong> the dose. The recommended next dose is shown for each class.</p>
          </Step>
          <Step n={5} title="Plan & Save">
            <p>Schedule the next follow-up call, add any clinical notes, and click <strong>&quot;Save Clinical Note&quot;</strong>. The titration summary is saved to the patient&apos;s record as a timestamped clinical note.</p>
          </Step>
        </div>

        <Warning>
          Always verify the patient&apos;s most recent K+ and Creatinine before making titration decisions. If labs are older than 2 weeks, order new labs before the next titration call.
        </Warning>
      </Section>

      {/* ============================================================ */}
      {/*  9. REMOTE MONITORING & TRACKS                               */}
      {/* ============================================================ */}
      <Section id="remote-monitoring" title="Remote Monitoring & Track Assignment" icon={Radio}>
        <p>
          The Remote Monitoring tool helps you assign patients to the appropriate monitoring track and provides
          billing code navigation with explicit verification requirements.
        </p>

        <h3 className="font-semibold text-gray-900 mt-4 mb-2">Track Assignment Criteria</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2 pr-4 font-medium">Factor</th>
                <th className="py-2 pr-4 font-medium">Track A (Digital)</th>
                <th className="py-2 font-medium">Track B (Analog)</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              <tr><td className="py-1.5 pr-4">Smartphone</td><td className="py-1.5 pr-4">Has smartphone with data</td><td className="py-1.5">No smartphone</td></tr>
              <tr><td className="py-1.5 pr-4">App comfort</td><td className="py-1.5 pr-4">Can use basic apps</td><td className="py-1.5">Not comfortable with apps</td></tr>
              <tr><td className="py-1.5 pr-4">Monitoring</td><td className="py-1.5 pr-4">Patient enters vitals in app</td><td className="py-1.5">Paper diary + phone calls</td></tr>
              <tr><td className="py-1.5 pr-4">Alerts</td><td className="py-1.5 pr-4">Real-time via app</td><td className="py-1.5">Provider reviews at call time</td></tr>
            </tbody>
          </table>
        </div>

        <h3 className="font-semibold text-gray-900 mt-6 mb-2">Remote Monitoring Billing Navigation</h3>
        <p className="text-sm">
          Codes 99453, 99454, 99457, 99458, and the 98975&ndash;98981 family may be relevant only after independent verification of the current code descriptor, modality, connected-device and automatic-transmission rules, monitoring days, time, communication, supervision, consent, documentation, and payer policy.
        </p>
        <ul className="list-disc list-inside text-sm space-y-1 ml-4 mt-2">
          <li>Manual or patient-entered HEARTLAND records do not prove qualifying automatic device transmission.</li>
          <li>No amount, eligibility status, or reimbursement outcome is represented by this app.</li>
          <li><a className="underline" href="https://www.cms.gov/medicare/payment/fee-schedules/physician/federal-regulation-notices/cms-1832-f" target="_blank" rel="noreferrer">Verify the CMS CY 2026 Physician Fee Schedule</a> and payer-specific policy.</li>
        </ul>
      </Section>

      {/* ============================================================ */}
      {/*  10. TRACK B (ANALOG)                                        */}
      {/* ============================================================ */}
      <Section id="track-b" title="Track B: Analog Monitoring Pathway" icon={FileText}>
        <p>
          Track B is designed for patients without smartphones &mdash; common in rural and elderly populations.
          The provider manages all digital interactions on behalf of the patient.
        </p>

        <h3 className="font-semibold text-gray-900 mt-4 mb-2">Setup for Track B Patients</h3>
        <div className="space-y-4">
          <Step n={1} title="Print the monitoring materials">
            <p>Go to <NavPath path="Patient Detail &rarr; Track B Diary" /> and print:</p>
            <ul className="list-disc list-inside ml-4 mt-1">
              <li><strong>7-Day Monitoring Diary</strong> &mdash; Large-font table for daily weight, BP, HR, symptoms</li>
              <li><strong>Red Flag Instruction Card</strong> &mdash; When to call 911, when to call the clinic</li>
            </ul>
          </Step>
          <Step n={2} title="Educate the patient">
            <p>During the office visit, walk the patient through filling out the diary. Do a teach-back: have them demonstrate recording a sample weight and BP reading.</p>
          </Step>
          <Step n={3} title="Establish the call schedule">
            <p>Set a regular call day (e.g., every Tuesday at 10am). At each call, the patient reads their diary entries.</p>
          </Step>
        </div>

        <h3 className="font-semibold text-gray-900 mt-6 mb-2">Entering Diary Data</h3>
        <div className="space-y-4">
          <Step n={1} title="Open the entry form">
            <p>Go to <NavPath path="Patient Detail &rarr; Track B Entry" />. You will see a form identical to the patient&apos;s vitals form, but with an optional date picker for backdating entries.</p>
          </Step>
          <Step n={2} title="Enter each day's readings">
            <p>Enter the weight, BP, HR, and symptoms for each day the patient reports. You can backdate entries to match the actual recording date.</p>
          </Step>
          <Step n={3} title="Submit">
            <p>Each submission goes through the same red flag detection pipeline as Track A. You will see an immediate alert if any red flags are triggered.</p>
          </Step>
        </div>

        <Tip>
          Track B patients show an amber &quot;Analog &mdash; provider enters data&quot; badge on their profile. Their vitals are marked as &quot;provider_entry&quot; in the system, distinguishing them from patient-reported data.
        </Tip>
      </Section>

      {/* ============================================================ */}
      {/*  11. ALERTS & TRIAGE                                         */}
      {/* ============================================================ */}
      <Section id="alerts" title="Alerts & Triage" icon={Bell}>
        <p>
          The alert system has two layers: <strong>real-time red flags</strong> (triggered immediately when vitals are submitted)
          and <strong>proactive alerts</strong> (generated by a daily scan for patterns like missed check-ins or trending weight gain).
        </p>

        <h3 className="font-semibold text-gray-900 mt-4 mb-2">Alert Severity Tiers</h3>
        <div className="space-y-2">
          <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-3">
            <div className="h-3 w-3 rounded-full bg-red-500"></div>
            <div>
              <span className="font-medium text-red-800">Critical</span>
              <span className="text-xs text-red-600 ml-2">Weight gain &ge;3 lbs/2 days, SBP &lt;90 with symptoms, SpO2 &lt;92%, K+ &gt;5.5, chest pain</span>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <div className="h-3 w-3 rounded-full bg-amber-500"></div>
            <div>
              <span className="font-medium text-amber-800">Warning</span>
              <span className="text-xs text-amber-600 ml-2">Gradual weight trend &gt;2 lbs/7 days, medication adherence &lt;70%, low eGFR</span>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
            <div className="h-3 w-3 rounded-full bg-blue-500"></div>
            <div>
              <span className="font-medium text-blue-800">Informational</span>
              <span className="text-xs text-blue-600 ml-2">No check-in for 3+ days, follow-up due within 24 hours</span>
            </div>
          </div>
        </div>

        <h3 className="font-semibold text-gray-900 mt-6 mb-2">Managing Alerts</h3>
        <ul className="list-disc list-inside text-sm space-y-1 ml-4">
          <li><strong>Acknowledge:</strong> You&apos;ve seen it and are tracking the situation</li>
          <li><strong>Resolve:</strong> The issue has been addressed (e.g., dose adjusted, patient contacted)</li>
          <li><strong>Mute:</strong> Suppress a specific alert type for a patient (e.g., no-checkin for a patient on vacation)</li>
        </ul>

        <Warning>
          HEARTLAND does not establish a safe response-time guarantee. Each organization must approve, staff, test, and monitor its own alert SLA, backup coverage, unreachable-patient workflow, emergency escalation, and downtime procedure before clinical use.
        </Warning>
      </Section>

      {/* ============================================================ */}
      {/*  12. DISCHARGE & FOLLOW-UP                                   */}
      {/* ============================================================ */}
      <Section id="discharge" title="Discharge Planning & Post-Discharge Follow-up" icon={ClipboardList}>
        <p>
          The Discharge module guides you through evidence-based discharge transitions per the HEARTLAND Protocol
          Module 4, including task-shifting and structured follow-up scheduling.
        </p>

        <h3 className="font-semibold text-gray-900 mt-4 mb-2">Initiating a Discharge</h3>
        <div className="space-y-4">
          <Step n={1} title="Navigate to the discharge page">
            <p>Go to <NavPath path="Sidebar &rarr; Discharge" /> and select the patient, or navigate from the patient detail page.</p>
          </Step>
          <Step n={2} title="Complete the Discharge Bundle">
            <p>Check off each item in the tier-appropriate bundle:</p>
            <ul className="list-disc list-inside ml-4 mt-1">
              <li><strong>Tier 1 (Minimal):</strong> Case management, teach-back (3 core domains), medication reconciliation, follow-up scheduled</li>
              <li><strong>Tier 2/3 (Standard/Advanced):</strong> All of Tier 1 plus teach-back for 8 domains, CHW engagement, cardiac rehab referral</li>
            </ul>
          </Step>
          <Step n={3} title="Review task-shifting assignments">
            <p>The Task-Shifting Table shows which team member handles each task based on your facility tier. Assign tasks to the appropriate staff.</p>
          </Step>
          <Step n={4} title="Schedule post-discharge contacts">
            <p>The system automatically creates 5 follow-up contacts:</p>
            <ul className="list-disc list-inside ml-4 mt-1">
              <li><strong>48-Hour Phone Call</strong> &mdash; Verify meds, check weight, assess symptoms</li>
              <li><strong>Day 7 Office Visit</strong> &mdash; Full assessment, labs, med reconciliation</li>
              <li><strong>Week 2 Phone Call</strong> &mdash; Titration check, symptom assessment</li>
              <li><strong>Week 3 Phone Call</strong> &mdash; Ongoing monitoring</li>
              <li><strong>Week 4 Phone Call</strong> &mdash; Monthly review, plan ahead</li>
            </ul>
          </Step>
          <Step n={5} title="Print discharge instructions">
            <p>Click &quot;Print Instructions&quot; to generate a patient-friendly discharge summary appropriate for your facility tier.</p>
          </Step>
        </div>

        <h3 className="font-semibold text-gray-900 mt-6 mb-2">Tracking Follow-up Contacts</h3>
        <p className="text-sm">
          Each scheduled contact appears as a card with its due date. When you complete a contact, mark it as &quot;Completed&quot;
          and add notes about the interaction. Overdue contacts are highlighted in red.
        </p>
      </Section>

      {/* ============================================================ */}
      {/*  13. MESSAGING                                               */}
      {/* ============================================================ */}
      <Section id="messaging" title="Patient Messaging" icon={FileText}>
        <p>
          The structured messaging system lets you send one-way messages to patients. Messages appear as cards on
          the patient&apos;s Today page. The system tracks when patients read each message.
        </p>

        <h3 className="font-semibold text-gray-900 mt-4 mb-2">Message Templates</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg border p-3">
            <h4 className="font-medium text-blue-700">Dose Change</h4>
            <p className="text-xs text-gray-600 mt-1">Notify patient of medication dose adjustments with specific instructions.</p>
          </div>
          <div className="rounded-lg border p-3">
            <h4 className="font-medium text-blue-700">Appointment</h4>
            <p className="text-xs text-gray-600 mt-1">Remind patient of upcoming calls, visits, or lab orders.</p>
          </div>
          <div className="rounded-lg border p-3">
            <h4 className="font-medium text-blue-700">Lab Order</h4>
            <p className="text-xs text-gray-600 mt-1">Instruct patient to complete labs before the next appointment.</p>
          </div>
          <div className="rounded-lg border p-3">
            <h4 className="font-medium text-blue-700">General</h4>
            <p className="text-xs text-gray-600 mt-1">Any other clinical communication (education reminders, red flag reviews).</p>
          </div>
        </div>

        <h3 className="font-semibold text-gray-900 mt-6 mb-2">Sending a Message</h3>
        <p className="text-sm">
          Go to any patient&apos;s detail page &rarr; <strong>Notes</strong> tab. Use the &quot;Send Message&quot; form
          to select a template, write your message, and send. You&apos;ll see the read status (&quot;Read 2 hours ago&quot; or &quot;Unread&quot;)
          on each sent message.
        </p>

        <Warning>
          Messages are for Track A (Digital) patients only. Track B patients do not have app access and will not see messages.
          For Track B patients, communicate during scheduled phone calls and document in clinical notes.
        </Warning>
      </Section>

      {/* ============================================================ */}
      {/*  14. SBAR HANDOFF                                            */}
      {/* ============================================================ */}
      <Section id="sbar" title="SBAR Handoff Generator" icon={ClipboardCheck}>
        <p>
          The SBAR (Situation, Background, Assessment, Recommendation) generator creates structured clinical
          handoff documents auto-populated from the patient&apos;s record. Use this when referring a patient to a
          specialist, transferring care, or communicating with covering providers.
        </p>

        <div className="space-y-4 mt-4">
          <Step n={1} title="Open the SBAR generator">
            <p>From any patient&apos;s detail page, click the <strong>&quot;Generate Handoff&quot;</strong> button in the page header.</p>
          </Step>
          <Step n={2} title="Review auto-populated fields">
            <p>The system fills in:</p>
            <ul className="list-disc list-inside ml-4 mt-1">
              <li><strong>Situation:</strong> Patient name, risk tier, track assignment, chief complaint</li>
              <li><strong>Background:</strong> Current GDMT with doses, latest vitals, last 3 lab panels, facility tier</li>
              <li><strong>Assessment:</strong> Risk score interpretation, CKM stage, comorbidities</li>
              <li><strong>Recommendation:</strong> (You fill this in based on clinical judgment)</li>
            </ul>
          </Step>
          <Step n={3} title="Edit and customize">
            <p>Each section is editable. Add clinical context, adjust wording, or add specific recommendations for the receiving provider.</p>
          </Step>
          <Step n={4} title="Export as PDF">
            <p>Click &quot;Print&quot; to generate a clean PDF with HEARTLAND branding and the required clinical disclaimer.</p>
          </Step>
        </div>
      </Section>

      {/* ============================================================ */}
      {/*  15. COMORBIDITY MANAGER                                     */}
      {/* ============================================================ */}
      <Section id="comorbidity" title="Comorbidity Manager" icon={Stethoscope}>
        <p>
          The Comorbidity Manager provides HF-specific guidance for managing common comorbidities. For each
          condition, it shows key considerations, recommended actions, and medication interactions with GDMT.
        </p>

        <h3 className="font-semibold text-gray-900 mt-4 mb-2">Supported Comorbidities</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
          {['Atrial Fibrillation', 'OSA', 'Iron Deficiency', 'Diabetes', 'CKD', 'COPD', 'Depression', 'Hypertension'].map(c => (
            <div key={c} className="rounded border px-2 py-1.5 text-center text-xs">{c}</div>
          ))}
        </div>

        <h3 className="font-semibold text-gray-900 mt-6 mb-2">Advanced HF Referral Criteria</h3>
        <p className="text-sm">The system checks for advanced HF referral indication when:</p>
        <ul className="list-disc list-inside text-sm space-y-1 ml-4 mt-2">
          <li>LVEF &le;35% <strong>AND</strong></li>
          <li>&ge;3 months on optimized GDMT <strong>AND</strong></li>
          <li>&ge;2 HF hospitalizations in the past year</li>
        </ul>

        <h3 className="font-semibold text-gray-900 mt-4 mb-2">Device Evaluation Criteria (CRT)</h3>
        <ul className="list-disc list-inside text-sm space-y-1 ml-4">
          <li>LVEF &le;35% <strong>AND</strong> LBBB <strong>AND</strong> QRS &ge;150ms &rarr; CRT candidate</li>
        </ul>

        <Tip>
          Select a patient, check their comorbidities, and save. The comorbidity profile appears in the patient&apos;s
          Info tab and is included in the SBAR handoff.
        </Tip>
      </Section>

      {/* ============================================================ */}
      {/*  16. QUALITY METRICS                                         */}
      {/* ============================================================ */}
      <Section id="quality-metrics" title="Quality Metrics Dashboard" icon={BarChart2}>
        <p>
          Track your facility&apos;s performance against HEARTLAND Protocol quality targets. The dashboard shows
          5 key metrics with monthly trend tracking and tier-specific targets.
        </p>

        <h3 className="font-semibold text-gray-900 mt-4 mb-2">Tracked Metrics</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2 pr-4 font-medium">Metric</th>
                <th className="py-2 pr-4 font-medium">Tier 1 Target</th>
                <th className="py-2 pr-4 font-medium">Tier 2 Target</th>
                <th className="py-2 font-medium">Tier 3 Target</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              <tr><td className="py-1.5 pr-4">GDMT Discharge Rate</td><td className="py-1.5 pr-4">&ge;60%</td><td className="py-1.5 pr-4">&ge;75%</td><td className="py-1.5">&ge;90%</td></tr>
              <tr><td className="py-1.5 pr-4">48-72h Post-Discharge Contact</td><td className="py-1.5 pr-4">&ge;70%</td><td className="py-1.5 pr-4">&ge;85%</td><td className="py-1.5">&ge;95%</td></tr>
              <tr><td className="py-1.5 pr-4">7-Day Follow-up Attendance</td><td className="py-1.5 pr-4">&ge;60%</td><td className="py-1.5 pr-4">&ge;75%</td><td className="py-1.5">&ge;90%</td></tr>
              <tr><td className="py-1.5 pr-4">30-Day Readmission Rate</td><td className="py-1.5 pr-4">Improvement</td><td className="py-1.5 pr-4">&le;20%</td><td className="py-1.5">&le;15%</td></tr>
              <tr><td className="py-1.5 pr-4">Teach-Back Documentation</td><td className="py-1.5 pr-4">&ge;70%</td><td className="py-1.5 pr-4">&ge;85%</td><td className="py-1.5">&ge;95%</td></tr>
            </tbody>
          </table>
        </div>

        <p className="text-sm mt-4">
          Enter your monthly data for each metric. The system calculates the rate and displays it against your facility&apos;s
          tier-specific target with a trend chart showing improvement over time.
        </p>
      </Section>

      {/* ============================================================ */}
      {/*  17. REPORTS & EXPORT                                        */}
      {/* ============================================================ */}
      <Section id="reports" title="Reports & Data Export" icon={FileBarChart2}>
        <p>
          Generate reports for clinical documentation, NIW evidence, and quality improvement.
        </p>

        <h3 className="font-semibold text-gray-900 mt-4 mb-2">Available Reports</h3>
        <div className="space-y-3">
          <div className="rounded-lg border p-3">
            <h4 className="font-medium">Monthly Usage Report (PDF)</h4>
            <p className="text-xs text-gray-600 mt-1">Total patients monitored, alerts generated, titrations completed, GDMT optimization rate, check-in compliance. Print for quality committee review.</p>
          </div>
          <div className="rounded-lg border p-3">
            <h4 className="font-medium">Patient Summary Report (PDF)</h4>
            <p className="text-xs text-gray-600 mt-1">Individual patient: demographics, risk tier, GDMT, vitals trends, labs, education progress, active alerts. Print for specialist referral.</p>
          </div>
          <div className="rounded-lg border p-3">
            <h4 className="font-medium">CSV Data Export</h4>
            <p className="text-xs text-gray-600 mt-1">Export vitals, labs, or medication data as CSV files for research or external analysis. The privacy-minimized option substitutes patient identifiers and reduces dates to year only; it does not independently establish de-identification or HIPAA compliance.</p>
          </div>
        </div>

        <Tip>
          Use the date range picker to generate reports for specific periods. The &quot;Last 30 Days&quot; preset is useful for monthly quality reviews.
        </Tip>
      </Section>

      {/* ============================================================ */}
      {/*  18. POCKET CARDS                                            */}
      {/* ============================================================ */}
      <Section id="pocket-cards" title="Pocket Card Library" icon={CreditCard}>
        <p>
          The Pocket Card Library provides digital versions of all 10 HEARTLAND Protocol reference cards.
          These are designed to be printed, laminated, and kept at the bedside or in the clinic.
        </p>
        <p className="text-sm">
          Go to <NavPath path="Sidebar &rarr; Pocket Cards" />. Click any card to view full-size with zoom capability.
          Click &quot;Download&quot; to save individual cards as JPG files.
        </p>
      </Section>

      {/* ============================================================ */}
      {/*  19. TROUBLESHOOTING & FAQ                                   */}
      {/* ============================================================ */}
      <Section id="troubleshooting" title="Troubleshooting & FAQ" icon={BookOpen}>
        <h3 className="font-semibold text-gray-900 mb-3">Frequently Asked Questions</h3>
        <div className="space-y-4">
          <div>
            <h4 className="font-medium text-gray-900">Q: My patient&apos;s vitals aren&apos;t showing up. What should I check?</h4>
            <p className="text-sm text-gray-600 mt-1">A: First, check if the patient submitted vitals (look at &quot;Last Vitals&quot; date on the Dashboard). If they&apos;re a Track B patient, make sure you entered data via Track B Entry. If the patient has poor connectivity, vitals may be queued offline &mdash; they will sync when the patient reconnects.</p>
          </div>
          <div>
            <h4 className="font-medium text-gray-900">Q: How do I transition a patient from Track B to Track A?</h4>
            <p className="text-sm text-gray-600 mt-1">A: Go to <NavPath path="Sidebar &rarr; Remote Monitoring" />, select the patient, and reassign their track. The patient will need to install the app on their smartphone. Their historical data (entered via Track B) will remain in the system.</p>
          </div>
          <div>
            <h4 className="font-medium text-gray-900">Q: Can I use this app for patients without heart failure?</h4>
            <p className="text-sm text-gray-600 mt-1">A: No. The HEARTLAND Protocol App is specifically designed for heart failure management. The risk score, GDMT pathway, titration checklist, and alert thresholds are all HF-specific.</p>
          </div>
          <div>
            <h4 className="font-medium text-gray-900">Q: Does this app replace a cardiologist?</h4>
            <p className="text-sm text-gray-600 mt-1">A: No. This is a clinical implementation tool that helps primary care providers manage HF patients according to evidence-based guidelines. Patients meeting advanced HF criteria should still be referred to cardiology. The SBAR Handoff generator facilitates this referral.</p>
          </div>
          <div>
            <h4 className="font-medium text-gray-900">Q: How do I print materials for a patient visit?</h4>
            <p className="text-sm text-gray-600 mt-1">A: Most pages have a print button (Ctrl+P / Cmd+P). Key printable materials: Risk Calculator results, GDMT Pathway, Titration Checklist, Track B Diary, Red Flag Card, Discharge Instructions, Pocket Cards.</p>
          </div>
          <div>
            <h4 className="font-medium text-gray-900">Q: What if I find an error or have a suggestion?</h4>
            <p className="text-sm text-gray-600 mt-1">A: Contact the protocol author, Dr. Vicky Muller Ferreira, at vickymuller@heartlandprotocol.org.</p>
          </div>
        </div>
      </Section>

      {/* Footer */}
      <div className="mt-12 border-t pt-6 text-center text-xs text-gray-400">
        <p>HEARTLAND Protocol App &middot; Version 4.0 &middot; Clinical Implementation Companion</p>
        <p className="mt-1">This guide is for healthcare professionals only. Not intended for patient use.</p>
        <p className="mt-1">Protocol Author: Vicky Muller Ferreira, MD &middot; ORCID: 0009-0009-1099-5690</p>
      </div>
    </div>
  );
}
