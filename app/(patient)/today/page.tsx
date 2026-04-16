import { VitalsEntryForm } from "./_components/vitals-form";
import { OfflineIndicator } from "./_components/OfflineIndicator";
import { MessageCards } from "./_components/message-card";
import { OnboardingOverlay } from "./_components/onboarding-overlay";
import { TodayTasksChecklist } from "./_components/today-tasks-checklist";
import { createClient } from "@/lib/supabase/server";
import { getUnreadMessages } from "@/lib/messages/queries";
import { getTodayTaskStatus } from "@/lib/patient/today-tasks";
import type { TodayTaskStatus } from "@/lib/patient/today-tasks";

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
  const [messages, taskStatus] = await Promise.all([
    user ? getUnreadMessages(supabase, user.id) : Promise.resolve([]),
    user
      ? getTodayTaskStatus(supabase, user.id)
      : Promise.resolve(defaultTaskStatus),
  ]);

  // PTUX-01: Check if patient has seen onboarding overlay
  const { data: profile } = user
    ? await supabase
        .from('profiles')
        .select('onboarding_seen_at')
        .eq('id', user.id)
        .single()
    : { data: null };
  const showOnboarding = !profile?.onboarding_seen_at;

  // SAFE-02: Fetch linked provider's phone for offline emergency contact
  let providerPhone: string | null = null;
  if (user) {
    const { data: linkData } = await supabase
      .from('provider_patient_links')
      .select('provider_id, profiles!provider_patient_links_provider_id_fkey(phone)')
      .eq('patient_id', user.id)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();

    providerPhone = (linkData?.profiles as { phone?: string } | null)?.phone ?? null;
  }

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="space-y-6">
      <OnboardingOverlay showOnboarding={showOnboarding} />

      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">
          Daily Check-in
        </h1>
        <p className="text-base text-gray-600 mt-1">{today}</p>
      </div>

      <TodayTasksChecklist {...taskStatus} />

      {messages.length > 0 && <MessageCards messages={messages} />}

      <OfflineIndicator />

      <VitalsEntryForm providerPhone={providerPhone} />
    </div>
  );
}
