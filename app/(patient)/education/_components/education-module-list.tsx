'use client';

/**
 * Education Module List -- Grid of education domain cards.
 * Shows progress, opens teach-back flow on click.
 * Requirement: EDUC-01, EDUC-02, EDUC-03
 */

import { useState } from 'react';
import {
  Scale,
  Pill,
  AlertTriangle,
  Heart,
  UtensilsCrossed,
  Droplets,
  Phone,
  Footprints,
  Check,
  Circle,
} from 'lucide-react';
import type { EducationDomain, EducationProgress } from '@/lib/education/types';
import { TeachBackCard } from './teach-back-card';

interface EducationModuleListProps {
  domains: EducationDomain[];
  trackAssignment: string;
  progress: EducationProgress[];
}

/** Map icon name strings to lucide-react components */
const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Scale,
  Pill,
  AlertTriangle,
  Heart,
  UtensilsCrossed,
  Droplets,
  Phone,
  Footprints,
};

export function EducationModuleList({
  domains,
  trackAssignment,
  progress,
}: EducationModuleListProps) {
  const [activeDomainId, setActiveDomainId] = useState<string | null>(null);

  const progressMap = new Map(progress.map((p) => [p.domain_id, p]));
  const completedCount = domains.filter(
    (d) => progressMap.get(d.id)?.completed
  ).length;

  const activeDomain = domains.find((d) => d.id === activeDomainId);

  // If a domain is selected, show the teach-back card
  if (activeDomain) {
    return (
      <TeachBackCard
        domain={activeDomain}
        trackAssignment={trackAssignment}
        progress={progressMap.get(activeDomain.id)}
        onClose={() => setActiveDomainId(null)}
      />
    );
  }

  return (
    <div>
      {/* Progress summary */}
      <p className="mb-4 text-base text-gray-600">
        {completedCount} of {domains.length} modules completed
      </p>

      {/* Domain cards */}
      <div className="space-y-3">
        {domains.map((domain) => {
          const domainProgress = progressMap.get(domain.id);
          const isCompleted = domainProgress?.completed ?? false;
          const attempts = domainProgress?.attempts ?? 0;
          const Icon = ICON_MAP[domain.icon] ?? Heart;

          return (
            <button
              key={domain.id}
              onClick={() => setActiveDomainId(domain.id)}
              className="flex min-h-[48px] w-full items-center gap-4 rounded-lg border border-gray-200 bg-white p-4 text-left shadow-sm transition-colors hover:bg-gray-50"
            >
              {/* Icon */}
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-100">
                <Icon className="h-5 w-5 text-gray-600" />
              </div>

              {/* Title and metadata */}
              <div className="flex-1 min-w-0">
                <span className="text-lg font-semibold text-gray-900 block truncate">
                  {domain.title}
                </span>
                <div className="flex items-center gap-2 mt-0.5">
                  <span
                    className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${
                      domain.tier === 'core'
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-purple-100 text-purple-700'
                    }`}
                  >
                    {domain.tier === 'core' ? 'Core' : 'Extended'}
                  </span>
                  {attempts > 0 && (
                    <span className="text-xs text-gray-500">
                      {attempts} {attempts === 1 ? 'attempt' : 'attempts'}
                    </span>
                  )}
                </div>
              </div>

              {/* Completion indicator */}
              <div className="shrink-0">
                {isCompleted ? (
                  <Check className="h-6 w-6 text-green-600" />
                ) : (
                  <Circle className="h-6 w-6 text-gray-300" />
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
