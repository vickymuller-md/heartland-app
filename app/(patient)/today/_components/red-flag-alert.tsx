'use client';

/**
 * RedFlagAlert -- Patient-facing red flag alert display
 *
 * Renders severity-coded alerts after vitals submission when
 * red flags are detected. Warning (amber) for moderate concerns,
 * critical (red) for urgent conditions.
 *
 * SAFE-02: Critical flags show tel:911 link. Provider phone shown as
 * clickable tel: link when available. Fallback text when no phone cached.
 *
 * Action guidance text matches HEARTLAND Protocol v3.3 Module 5, Section 5.2.
 * Elderly-optimized: 16px+ body text, 18px+ bold action guidance.
 */

import { useEffect } from 'react';
import { AlertTriangle, AlertOctagon } from 'lucide-react';
import type { RedFlag } from '@/lib/vitals/types';

interface RedFlagAlertProps {
  flags: RedFlag[];
  providerPhone?: string | null;
}

const SEVERITY_STYLES = {
  warning: {
    container: 'border-amber-400 bg-amber-50',
    title: 'text-amber-800',
    message: 'text-amber-700',
    action: 'text-amber-900',
    Icon: AlertTriangle,
    label: 'Warning',
  },
  critical: {
    container: 'border-red-400 bg-red-50',
    title: 'text-red-800',
    message: 'text-red-700',
    action: 'text-red-900',
    Icon: AlertOctagon,
    label: 'Critical Alert',
  },
} as const;

export function RedFlagAlert({ flags, providerPhone }: RedFlagAlertProps) {
  // Cache provider phone in localStorage for offline access
  useEffect(() => {
    if (providerPhone) {
      localStorage.setItem('heartland:provider_phone', providerPhone);
    }
  }, [providerPhone]);

  if (flags.length === 0) return null;

  return (
    <div className="space-y-4">
      {flags.map((flag) => {
        const style = SEVERITY_STYLES[flag.severity];
        const IconComponent = style.Icon;

        return (
          <div
            key={flag.id}
            role="alert"
            className={`rounded-lg border-2 p-6 ${style.container}`}
          >
            <div className="flex items-start gap-3">
              <IconComponent
                className={`h-6 w-6 flex-shrink-0 mt-0.5 ${style.title}`}
                aria-hidden="true"
              />
              <div className="space-y-2">
                <h3 className={`text-xl font-bold ${style.title}`}>
                  {style.label}
                </h3>
                <p className={`text-base ${style.message}`}>{flag.message}</p>
                <p className={`text-lg font-bold ${style.action}`}>
                  {flag.action}
                </p>

                {/* Emergency contact -- SAFE-02 */}
                <div className="mt-3 space-y-2">
                  {flag.severity === 'critical' && (
                    <a
                      href="tel:911"
                      className="block text-lg font-bold underline text-red-900"
                    >
                      Call 911 if symptoms are severe
                    </a>
                  )}
                  {providerPhone ? (
                    <a
                      href={`tel:${providerPhone}`}
                      className="block text-base font-semibold underline text-red-800"
                    >
                      Call your provider: {providerPhone}
                    </a>
                  ) : (
                    <p className="text-sm text-red-700">
                      Contact your care team through your provider.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
