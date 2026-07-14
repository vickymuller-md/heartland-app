import { formatDistanceToNow } from 'date-fns';
import type { TimelineEvent } from '@/lib/patient/operational';

const TYPE_LABELS: Record<TimelineEvent['type'], string> = {
  work: 'Work',
  vitals: 'Vitals',
  symptoms: 'Symptoms',
  lab: 'Lab',
  note: 'Note',
  message: 'Message',
};

export function PatientTimeline({ events }: { events: TimelineEvent[] }) {
  return (
    <section className="rounded-2xl border bg-white p-5" aria-labelledby="timeline-heading">
      <h2 id="timeline-heading" className="text-lg font-bold text-slate-950">Unified timeline</h2>
      <p className="mt-1 text-sm text-slate-600">Recent work, measurements, documentation, labs, and communication.</p>
      {events.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed p-4 text-sm text-slate-600">No timeline records available.</p>
      ) : (
        <ol className="mt-4 space-y-3">
          {events.map((event) => (
            <li key={event.id} className="grid gap-1 border-l-2 border-slate-200 pl-4 sm:grid-cols-[110px_1fr]">
              <div>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">{TYPE_LABELS[event.type]}</span>
                <p className="mt-1 text-xs text-slate-500">{formatDistanceToNow(new Date(event.occurredAt), { addSuffix: true })}</p>
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-slate-900">{event.title}</p>
                  {event.status && <span className="text-xs text-slate-500">{event.status}</span>}
                </div>
                <p className="mt-1 line-clamp-3 text-sm text-slate-600">{event.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
