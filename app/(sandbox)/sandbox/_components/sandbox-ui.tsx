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
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-3xl">
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
    <div className={cn('rounded-2xl border p-4', tones[tone])}>
      <p className="text-2xl font-bold text-slate-950">{value}</p>
      <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-600">{label}</p>
      <p className="mt-2 text-xs leading-5 text-slate-600">{detail}</p>
    </div>
  );
}

export function SyntheticBanner({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-3 rounded-xl border border-violet-200 bg-violet-50 p-4 text-sm text-violet-950">
      <FlaskConical className="mt-0.5 size-5 shrink-0 text-violet-700" aria-hidden="true" />
      <div><strong>Synthetic demonstration.</strong> {children}</div>
    </div>
  );
}

export function SeverityPill({ severity }: { severity: SandboxSeverity }) {
  const styles = {
    critical: 'border-red-300 bg-red-50 text-red-800',
    warning: 'border-amber-300 bg-amber-50 text-amber-900',
    informational: 'border-blue-200 bg-blue-50 text-blue-800',
  };
  return <span className={cn('rounded-full border px-2 py-1 text-xs font-semibold capitalize', styles[severity])}>{severity}</span>;
}

export function StatusPill({ status }: { status: SandboxTaskStatus }) {
  const styles: Record<SandboxTaskStatus, string> = {
    open: 'bg-slate-100 text-slate-700',
    reviewed: 'bg-blue-100 text-blue-800',
    actioned: 'bg-violet-100 text-violet-800',
    awaiting: 'bg-amber-100 text-amber-900',
    closed: 'bg-emerald-100 text-emerald-800',
  };
  return <span className={cn('rounded-full px-2 py-1 text-xs font-semibold capitalize', styles[status])}>{status}</span>;
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
    <div>
      <svg viewBox="0 0 100 90" role="img" aria-label={`Weight trend from ${weights[0]} to ${weights.at(-1)} pounds`} className="h-40 w-full overflow-visible">
        <line x1="10" y1="82" x2="90" y2="82" stroke="#cbd5e1" strokeWidth="1" />
        <polyline points={points} fill="none" stroke="#2563eb" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {data.map((point, index) => {
          const [x, y] = points.split(' ')[index].split(',');
          return <circle key={point.label} cx={x} cy={y} r="2.4" fill="#1d4ed8"><title>{point.label}: {point.weight} lb</title></circle>;
        })}
      </svg>
      <div className="grid grid-cols-5 gap-1 text-center text-[10px] font-medium text-slate-500">
        {data.map((point) => <span key={point.label}>{point.label}</span>)}
      </div>
    </div>
  );
}
