import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { SandboxSeverity, SandboxTaskStatus } from '@/lib/sandbox/types';

export function SectionHeading({ eyebrow, title, description, action }: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-end justify-between gap-3 [overflow-wrap:anywhere]">
      <div className="min-w-0 max-w-3xl flex-1 basis-80">
        <p className="section-kicker">{eyebrow}</p>
        <h2 className="section-title mt-1">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
      </div>
      {action}
    </div>
  );
}

export function MetricCard({ label, value, detail }: {
  label: string;
  value: string | number;
  detail: string;
}) {
  return (
    <div className="panel flex h-full flex-col gap-1 p-4 [overflow-wrap:anywhere] sm:p-5">
      <p className="section-kicker">{label}</p>
      <p className="mt-1 text-3xl font-medium tracking-tight text-foreground tabular-nums">{value}</p>
      <p className="mt-1 text-sm leading-5 text-muted-foreground">{detail}</p>
    </div>
  );
}

export function SyntheticBanner({ children }: { children: ReactNode }) {
  return (
    <div className="min-w-0 border-l-2 border-input pl-4 text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">
      <strong className="font-semibold text-foreground">Synthetic demonstration.</strong> {children}
    </div>
  );
}

export function SeverityPill({ severity }: { severity: SandboxSeverity }) {
  const styles = {
    critical: 'status-critical',
    warning: 'status-warning',
    informational: 'status-neutral',
  };
  return <span className={cn('status-label capitalize', styles[severity])}>{severity}</span>;
}

export function StatusPill({ status }: { status: SandboxTaskStatus }) {
  const styles: Record<SandboxTaskStatus, string> = {
    open: 'status-neutral',
    reviewed: 'status-positive',
    actioned: 'status-positive',
    awaiting: 'status-warning',
    closed: 'status-positive',
  };
  return <span className={cn('status-label capitalize', styles[status])}>{status}</span>;
}

export function OutreachDispositionPill({ disposition }: { disposition: 'emergency' | 'escalated' | 'routine' | 'no_answer' }) {
  const styles = {
    emergency: 'status-critical',
    escalated: 'status-warning',
    routine: 'status-positive',
    no_answer: 'status-neutral',
  };
  const labels = {
    emergency: 'Emergency',
    escalated: 'Escalated to human review',
    routine: 'Routine',
    no_answer: 'No answer · human follow-up',
  };
  return <span className={cn('status-label', styles[disposition])}>{labels[disposition]}</span>;
}
