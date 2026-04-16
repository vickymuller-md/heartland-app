'use client';

/**
 * EducationSummary -- Education completion progress for patient detail
 *
 * Shows completion status per education domain from Phase 9 data.
 * Domains: daily weight, medications, warning signs, and extended topics.
 *
 * Requirement: DASH-03 (education tab in patient detail)
 */

import { BookOpen, CheckCircle2, Circle } from 'lucide-react';

interface EducationSummaryProps {
  educationProgress: unknown;
}

interface DomainProgress {
  domain: string;
  label: string;
  completed: boolean;
  completed_at?: string;
}

function parseEducationProgress(data: unknown): DomainProgress[] | null {
  if (!data || typeof data !== 'object') return null;

  const d = data as Record<string, unknown>;

  // Phase 9 returns { domains: [...] } or is directly an array
  const domains = Array.isArray(d.domains)
    ? d.domains
    : Array.isArray(data)
      ? data
      : null;

  if (!domains) return null;

  return domains.map((item: unknown) => {
    const domain = item as Record<string, unknown>;
    return {
      domain: String(domain.domain ?? domain.id ?? ''),
      label: String(domain.label ?? domain.name ?? domain.domain ?? ''),
      completed: Boolean(domain.completed ?? domain.complete ?? false),
      completed_at: domain.completed_at ? String(domain.completed_at) : undefined,
    };
  });
}

export function EducationSummary({ educationProgress }: EducationSummaryProps) {
  const domains = parseEducationProgress(educationProgress);

  if (!domains || domains.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <BookOpen className="h-10 w-10 text-gray-300 mb-3" />
        <p className="text-gray-600">Education not started</p>
      </div>
    );
  }

  const completedCount = domains.filter((d) => d.completed).length;
  const totalCount = domains.length;
  const pct = Math.round((completedCount / totalCount) * 100);

  return (
    <div className="space-y-4" data-testid="education-summary">
      {/* Overall progress */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">
            Education Progress
          </span>
          <span className="text-sm text-gray-600">
            {completedCount}/{totalCount} domains ({pct}%)
          </span>
        </div>
        <div className="h-2 w-full rounded-full bg-gray-200">
          <div
            className="h-2 rounded-full bg-blue-500 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Domain checklist */}
      <div className="space-y-2">
        {domains.map((domain) => (
          <div
            key={domain.domain}
            className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3"
          >
            {domain.completed ? (
              <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
            ) : (
              <Circle className="h-5 w-5 text-gray-300 shrink-0" />
            )}
            <div>
              <p
                className={`text-sm font-medium ${
                  domain.completed ? 'text-gray-900' : 'text-gray-500'
                }`}
              >
                {domain.label}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
