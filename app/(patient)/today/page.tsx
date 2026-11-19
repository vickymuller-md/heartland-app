import Link from 'next/link';
import { VitalsEntryForm } from "./_components/vitals-form";
import { OfflineIndicator } from "./_components/OfflineIndicator";
import { MessageCards } from "./_components/message-card";
import { OnboardingOverlay } from "./_components/onboarding-overlay";
import { TodayTasksChecklist } from "./_components/today-tasks-checklist";
import { createClient } from "@/lib/supabase/server";
import { getUnreadMessages } from "@/lib/messages/queries";
import { getTodayTaskStatus } from "@/lib/patient/today-tasks";
import { getPatientPlan } from "@/lib/patient/plan";
import { NextActionCard } from "./_components/next-action-card";
import { ProductEventTracker } from "@/components/analytics/product-event-tracker";
import { getPatientMedicationCalendar } from '@/lib/medications/queries';
import { CALENDAR_SOURCE_LABEL } from '@/lib/medications/calendar';
import { formatInTimeZone } from '@/lib/timezone';

export default async function PatientToday() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // PTUX-03: Parallel fetch of messages + task status
  const calendar = user ? await getPatientMedicationCalendar(supabase, user.id).catch(() => null) : null;
  const [messagesResult, taskResult, plan] = await Promise.all([
    user
      ? getUnreadMessages(supabase, user.id)
          .then((data) => ({ data, error: null as string | null }))
          .catch(() => ({ data: [], error: 'Care-team messages could not be loaded.' }))
      : Promise.resolve({ data: [], error: null }),
    user && calendar
      ? getTodayTaskStatus(supabase, user.id, calendar.zone, calendar)
          .then((data) => ({ data, error: null as string | null }))
          .catch(() => ({ data: null, error: 'Today checklist status could not be loaded.' }))
      : Promise.resolve({ data: null, error: user ? 'Your care-team calendar could not be verified. Reload to see today’s tasks.' : null }),
    user
      ? getPatientPlan(supabase, user.id)
      : Promise.resolve({ items: [], careContact: null, error: null, contactError: null }),
  ]);
  const messages = messagesResult.data;
  const taskStatus = taskResult.data;
  const todayDataError = messagesResult.error ?? taskResult.error ?? plan.error;

  // PTUX-01: Check if patient has seen onboarding overlay
  const { data: profile } = user
    ? await supabase
        .from('profiles')
        .select('onboarding_seen_at')
        .eq('id', user.id)
        .single()
    : { data: null };
  const showOnboarding = !profile?.onboarding_seen_at;

  // SAFE-02: Phone comes from the patient-scoped access-history RPC.
  const providerPhone = plan.careContact?.phone ?? null;

  const today = calendar ? formatInTimeZone(new Date(calendar.day + 'T12:00:00Z'), 'UTC', {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }) : null;

  return (
    <div className="space-y-6">
      <OnboardingOverlay showOnboarding={showOnboarding} />
      <ProductEventTracker eventName="patient_today_view" area="patient_today" trackDuration />

      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">
          Daily Check-in
        </h1>
        {today && <p className="text-base text-gray-600 mt-1">{today}</p>}
        {calendar && <p className="text-xs text-gray-600">{CALENDAR_SOURCE_LABEL[calendar.source]} · {calendar.zone}</p>}
        {calendar?.pending_zone && <p className="text-xs text-gray-600">Your calendar change to {calendar.pending_zone} is scheduled. <Link href="/medications" className="underline">View the time change</Link></p>}
      </div>

      {todayDataError && (
        <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm font-medium text-red-900">{todayDataError}</div>
      )}
      <NextActionCard
        tasks={taskStatus}
        unreadMessages={messages.length}
        nextFollowup={plan.items[0] ?? null}
        dataAvailable={!todayDataError}
      />

      {taskStatus && <TodayTasksChecklist {...taskStatus} />}

      {messages.length > 0 && <div id="care-team-messages"><MessageCards messages={messages} /></div>}

      <OfflineIndicator />

      <div id="daily-check-in" className="scroll-mt-4"><VitalsEntryForm providerPhone={providerPhone} /></div>
    </div>
  );
}
