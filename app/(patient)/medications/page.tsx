import { createClient } from '@/lib/supabase/server';
import { getPatientMedications, getTodayLogs, getMedicationScheduleHistory, getAdherenceData, getPatientMedicationCalendar } from '@/lib/medications/queries';
import { CALENDAR_SOURCE_LABEL } from '@/lib/medications/calendar';
import { CalendarSetting } from './_components/calendar-setting';
import { DoseLogGrid } from './_components/dose-log-grid';
import { AdherenceHeatmap } from './_components/adherence-heatmap';
import { MedicationList } from './_components/medication-list';

export default async function MedicationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return <p>Please sign in to manage your medications.</p>;

  let calendar;
  try {
    const settings = await getPatientMedicationCalendar(supabase, user.id);
    const today = settings.day;
    const [medications, todayLogs, schedules, adherenceData] = await Promise.all([
      getPatientMedications(supabase, user.id), getTodayLogs(supabase, user.id, today),
      getMedicationScheduleHistory(supabase, [user.id], today, today), getAdherenceData(supabase, user.id, 30, settings),
    ]);
    calendar = { settings, today, medications, todayLogs, schedules, adherenceData };
  } catch {
    return <div><h1 className="text-2xl font-bold">Medications</h1>
      <p role="alert">Your medication schedule could not be loaded. Reload before recording a dose.</p></div>;
  }

  return <div className="space-y-6">
    <h1 className="text-2xl font-bold tracking-tight text-gray-900">Medications</h1>
    <section><h2 className="mb-2 text-lg font-semibold">Today’s doses</h2>
      <p className="mb-3 text-sm text-gray-700">{calendar.today} · {CALENDAR_SOURCE_LABEL[calendar.settings.source]} · {calendar.settings.zone}</p>
      {calendar.settings.pending_zone && <p role="status" className="mb-3 text-sm text-amber-900">Time zone change scheduled for {calendar.settings.pending_zone}. Open your calendar settings below to see when it takes effect.</p>}
      <DoseLogGrid key={[user.id, calendar.today, calendar.settings.revision, ...calendar.schedules.map(item => item.id), ...calendar.todayLogs.map(log => log.id + log.taken)].join('/')}
        schedules={calendar.schedules} todayLogs={calendar.todayLogs} today={calendar.today} actorId={user.id} calendarRevision={calendar.settings.revision} />
    </section>
    <CalendarSetting key={calendar.settings.revision} actorId={user.id} calendar={calendar.settings} zones={['UTC', ...Intl.supportedValuesOf('timeZone')]} />
    <section><h2 className="mb-3 text-lg font-semibold">30-day adherence</h2>
      <AdherenceHeatmap data={calendar.adherenceData} />
    </section>
    <section><h2 className="mb-3 text-lg font-semibold">Your medications</h2>
      <MedicationList key={user.id} actorId={user.id} medications={calendar.medications} />
    </section>
  </div>;
}
