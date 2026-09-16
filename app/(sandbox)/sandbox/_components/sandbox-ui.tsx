import type { ReactNode } from 'react';
import { FlaskConical } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SandboxSeverity, SandboxTaskStatus, SandboxVitalPoint } from '@/lib/sandbox/types';

export function SectionHeading({ eyebrow, title, description, action }: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-end justify-between gap-3 [overflow-wrap:anywhere]">
      <div className="min-w-0 max-w-3xl flex-1 basis-80">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-700">{eyebrow}</p>
        <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
      </div>
      {action}
    </div>
  );
}

export function MetricCard({ label, value, detail, tone = 'slate' }: {
  label: string;
  value: string | number;
  detail: string;
  tone?: 'slate' | 'blue' | 'emerald' | 'amber' | 'violet';
}) {
  const tones = {
    slate: 'border-slate-200 bg-white',
    blue: 'border-blue-200 bg-blue-50',
    emerald: 'border-emerald-200 bg-emerald-50',
    amber: 'border-amber-200 bg-amber-50',
    violet: 'border-violet-200 bg-violet-50',
  };
  return (
    <div className={cn('min-w-0 rounded-2xl border p-3 sm:p-4 [overflow-wrap:anywhere]', tones[tone])}>
      <p className="text-2xl font-bold text-slate-950">{value}</p>
      <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-600">{label}</p>
      <p className="mt-2 text-xs leading-5 text-slate-600">{detail}</p>
    </div>
  );
}

export function SyntheticBanner({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-w-0 gap-2 rounded-xl border border-violet-200 bg-violet-50 p-3 sm:p-4 text-sm text-violet-950">
      <FlaskConical className="mt-0.5 size-5 shrink-0 text-violet-700" aria-hidden="true" />
      <div className="min-w-0 [overflow-wrap:anywhere]"><strong>Synthetic demonstration.</strong> {children}</div>
    </div>
  );
}

export function SeverityPill({ severity }: { severity: SandboxSeverity }) {
  const styles = {
    critical: 'border-red-300 bg-red-50 text-red-800',
    warning: 'border-amber-300 bg-amber-50 text-amber-900',
    informational: 'border-blue-200 bg-blue-50 text-blue-800',
  };
  return <span className={cn('max-w-full [overflow-wrap:anywhere] rounded-full border px-2 py-1 text-xs font-semibold capitalize', styles[severity])}>{severity}</span>;
}

export function StatusPill({ status }: { status: SandboxTaskStatus }) {
  const styles: Record<SandboxTaskStatus, string> = {
    open: 'bg-slate-100 text-slate-700',
    reviewed: 'bg-blue-100 text-blue-800',
    actioned: 'bg-violet-100 text-violet-800',
    awaiting: 'bg-amber-100 text-amber-900',
    closed: 'bg-emerald-100 text-emerald-800',
  };
  return <span className={cn('max-w-full [overflow-wrap:anywhere] rounded-full px-2 py-1 text-xs font-semibold capitalize', styles[status])}>{status}</span>;
}

export function OutreachDispositionPill({ disposition }: { disposition: 'emergency' | 'escalated' | 'routine' | 'no_answer' }) {
  const styles = {
    emergency: 'border-red-300 bg-red-50 text-red-800',
    escalated: 'border-amber-300 bg-amber-50 text-amber-900',
    routine: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    no_answer: 'border-slate-300 bg-slate-100 text-slate-700',
  };
  const labels = {
    emergency: 'Emergency',
    escalated: 'Escalated to human review',
    routine: 'Routine',
    no_answer: 'No answer · human follow-up',
  };
  return <span className={cn('max-w-full [overflow-wrap:anywhere] rounded-full border px-2 py-1 text-xs font-semibold', styles[disposition])}>{labels[disposition]}</span>;
}

export function WeightTrend({ data }: { data: SandboxVitalPoint[] }) {
  if (data.length < 2) return <p className="text-sm text-amber-800">Insufficient trend data.</p>;
  const weights = data.map((point) => point.weight);
  const min = Math.min(...weights) - 0.5;
  const max = Math.max(...weights) + 0.5;
  const range = Math.max(max - min, 1);
  const points = data.map((point, index) => {
    const x = 10 + (index / (data.length - 1)) * 80;
    const y = 82 - ((point.weight - min) / range) * 64;
    return `${x},${y}`;
  }).join(' ');

  return (
    <div className="mx-auto w-full min-w-0 max-w-sm">
      <svg viewBox="0 0 100 90" role="img" aria-label={`Weight trend from ${weights[0]} to ${weights.at(-1)} pounds`} className="block h-auto w-full overflow-visible">
        <line x1="10" y1="82" x2="90" y2="82" stroke="#cbd5e1" strokeWidth="1" />
        <polyline points={points} fill="none" stroke="#2563eb" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {data.map((point, index) => {
          const [x, y] = points.split(' ')[index].split(',');
          return <circle key={point.label} cx={x} cy={y} r="2.4" fill="#1d4ed8"><title>{point.label}: {point.weight} lb</title></circle>;
        })}
      </svg>
      <div className="flex justify-between text-center text-xs font-medium text-slate-500">
        {data.map((point) => <span className="min-w-0 basis-1/5 shrink-0 [overflow-wrap:anywhere]" key={point.label}>{point.label}</span>)}
      </div>
    </div>
  );
}
