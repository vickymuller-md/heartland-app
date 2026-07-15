import { redirect } from 'next/navigation';
import { CalendarDays, Phone } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getPatientPlan } from '@/lib/patient/plan';
import { ProductEventTracker } from '@/components/analytics/product-event-tracker';
import { getPatientTimeZone } from '@/lib/patient/timezone';
import { formatInTimeZone } from '@/lib/timezone';

export default async function PatientPlanPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [plan, timeZone] = await Promise.all([
    getPatientPlan(supabase, user.id),
    getPatientTimeZone(supabase),
  ]);

  return (
    <div className="space-y-5">
      <ProductEventTracker eventName="workspace_view" area="patient_plan" />
      <div>
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">Care plan</p>
        <h1 className="text-2xl font-bold text-slate-950">What happens next</h1>
        <p className="mt-1 text-sm text-slate-600">Upcoming contacts and follow-ups recorded by your care team.</p>
      </div>

      {plan.error ? (
        <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm font-medium text-red-900">{plan.error}</div>
      ) : plan.items.length === 0 ? (
        <div className="rounded-xl border border-dashed p-6 text-sm text-slate-600">Plan loaded successfully. No upcoming follow-up is currently listed.</div>
      ) : (
        <ol className="space-y-3">
          {plan.items.map((item) => (
            <li key={`${item.source}-${item.id}`} className="rounded-xl border bg-white p-4">
              <div className="flex items-start gap-3">
                <CalendarDays className="mt-0.5 size-5 shrink-0 text-blue-700" />
                <div>
                  <h2 className="font-semibold capitalize text-slate-950">{item.title}</h2>
                  <p className="mt-1 text-sm text-slate-700">{formatInTimeZone(new Date(item.dueAt), timeZone, { dateStyle: 'full', timeStyle: 'short' })}</p>
                  {item.detail && <p className="mt-1 text-sm text-slate-600">{item.detail}</p>}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}

      <section className="rounded-xl border border-blue-200 bg-blue-50 p-4">
        <h2 className="font-semibold text-blue-950">Care-team contact</h2>
        {plan.contactError ? (
          <p role="alert" className="mt-2 text-sm font-medium text-red-800">{plan.contactError}</p>
        ) : plan.careContact ? (
          <div className="mt-2 text-sm text-blue-900">
            <p>{plan.careContact.name}</p>
            {plan.careContact.phone ? (
              <a href={`tel:${plan.careContact.phone}`} className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-lg bg-blue-700 px-4 font-semibold text-white">
                <Phone className="size-4" /> Call care team
              </a>
            ) : <p className="text-blue-700">No phone number is listed. Use the contact instructions provided by your facility.</p>}
          </div>
        ) : <p className="mt-2 text-sm text-blue-800">No active provider link is visible.</p>}
      </section>

      <p className="text-xs text-slate-500">This page reflects recorded workflow information and does not replace instructions directly provided by your care team.</p>
    </div>
  );
}
