import { VitalsEntryForm } from "./_components/vitals-form";
import { OfflineIndicator } from "./_components/OfflineIndicator";
import { MessageCards } from "./_components/message-card";
import { OnboardingOverlay } from "./_components/onboarding-overlay";
import { TodayTasksChecklist } from "./_components/today-tasks-checklist";
import { createClient } from "@/lib/supabase/server";
import { getUnreadMessages } from "@/lib/messages/queries";
import { getTodayTaskStatus } from "@/lib/patient/today-tasks";
import type { TodayTaskStatus } from "@/lib/patient/today-tasks";
import { getPatientPlan } from "@/lib/patient/plan";
import { NextActionCard } from "./_components/next-action-card";
import { ProductEventTracker } from "@/components/analytics/product-event-tracker";
import { getPatientTimeZone } from '@/lib/patient/timezone';
import { formatInTimeZone } from '@/lib/timezone';

export default async function PatientToday() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // PTUX-03: Parallel fetch of messages + task status
  const defaultTaskStatus: TodayTaskStatus = {
    vitalsLogged: false,
    medsTaken: 0,
    medsTotal: 0,
    educationRemaining: 0,
  };
  const timeZone = user ? await getPatientTimeZone(supabase) : 'America/New_York';
  const [messagesResult, taskResult, plan] = await Promise.all([
    user
      ? getUnreadMessages(supabase, user.id)
          .then((data) => ({ data, error: null as string | null }))
          .catch(() => ({ data: [], error: 'Care-team messages could not be loaded.' }))
      : Promise.resolve({ data: [], error: null }),
    user
      ? getTodayTaskStatus(supabase, user.id, timeZone)
          .then((data) => ({ data, error: null as string | null }))
          .catch(() => ({ data: defaultTaskStatus, error: 'Today checklist status could not be loaded.' }))
      : Promise.resolve({ data: defaultTaskStatus, error: null }),
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

  const today = formatInTimeZone(new Date(), timeZone, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="space-y-6">
      <OnboardingOverlay showOnboarding={showOnboarding} />
      <ProductEventTracker eventName="patient_today_view" area="patient_today" trackDuration />

      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">
          Daily Check-in
        </h1>
        <p className="text-base text-gray-600 mt-1">{today}</p>
        <p className="text-xs text-gray-500">Local care-team time · {timeZone}</p>
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

      <TodayTasksChecklist {...taskStatus} />

      {messages.length > 0 && <div id="care-team-messages"><MessageCards messages={messages} /></div>}

      <OfflineIndicator />

      <div id="daily-check-in" className="scroll-mt-4"><VitalsEntryForm providerPhone={providerPhone} /></div>
    </div>
  );
}
