import Link from 'next/link';
import type { TodayTaskStatus } from '@/lib/patient/today-tasks';
import type { PatientPlanItem } from '@/lib/patient/plan';

export function NextActionCard({
  tasks,
  unreadMessages,
  nextFollowup,
  dataAvailable = true,
}: {
  tasks: TodayTaskStatus | null;
  unreadMessages: number;
  nextFollowup: PatientPlanItem | null;
  dataAvailable?: boolean;
}) {
  let title = 'You are caught up for today';
  let detail = nextFollowup
    ? `Next planned contact: ${new Date(nextFollowup.dueAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`
    : 'No additional action is listed. Keep following your care team’s instructions.';
  let href = '/plan';

  if (!dataAvailable || !tasks) {
    title = 'Some Today data could not be loaded';
    detail = 'Do not interpret this page as a completed checklist. Reconnect and retry before relying on it.';
    href = '/today';
  } else if (unreadMessages > 0) {
    title = `Read ${unreadMessages} care-team message${unreadMessages === 1 ? '' : 's'}`;
    detail = 'Review the message before completing the rest of today’s tasks.';
    href = '#care-team-messages';
  } else if (!tasks.vitalsLogged) {
    title = 'Complete today’s check-in';
    detail = 'Enter the measurements and symptoms requested by your care team.';
    href = '#daily-check-in';
  } else if (tasks.medsTotal > 0 && tasks.medsTaken < tasks.medsTotal) {
    title = 'Update today’s medication log';
    detail = `${tasks.medsTaken} of ${tasks.medsTotal} scheduled doses recorded.`;
    href = '/medications';
  } else if (tasks.medsScheduleUnconfirmed) {
    title = 'Review your medication schedule';
    detail = 'Some instructions still need confirmation from your care team.';
    href = '/medications';
  } else if (tasks.educationRemaining > 0) {
    title = 'Continue your learning plan';
    detail = `${tasks.educationRemaining} available learning module${tasks.educationRemaining === 1 ? '' : 's'} remaining.`;
    href = '/education';
  }

  return (
    <section className="rounded-xl bg-slate-900 p-5 text-white" aria-labelledby="next-action-heading">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-200">Your next action</p>
      <div className="mt-2 min-w-0">
        <h2 id="next-action-heading" className="text-xl font-bold">{title}</h2>
        <p className="mt-1 text-sm text-slate-300">{detail}</p>
        <Link href={href} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-full bg-terminal px-4 text-sm font-semibold text-cool hover:bg-alert">
          Continue
        </Link>
      </div>
    </section>
  );
}
