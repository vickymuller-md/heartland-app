'use client';

/**
 * EducationTeachback -- professional verification, per domain (migration 00040)
 *
 * This panel shows and records the *professional* teach-back. It is rendered
 * beside, never merged with, the patient self-assessment: a completed module is
 * never displayed as a documented teach-back, and a domain with no teach-back
 * event is `pending`, never `completed`.
 */

import { useState, useTransition } from 'react';
import { format, parseISO } from 'date-fns';
import { ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EDUCATION_DOMAINS } from '@/lib/education/constants';
import { recordTeachBack } from '@/lib/education/teachback-actions';
import {
  TEACHBACK_METHODS,
  TEACHBACK_OUTCOMES,
  TEACHBACK_REASON_REQUIRED,
} from '@/lib/education/types';
import type {
  DerivedDomainState,
  EducationTeachback as EducationTeachbackRecord,
  TeachbackMethod,
  TeachbackOutcome,
} from '@/lib/education/types';

const STATE_LABEL: Record<DerivedDomainState, string> = {
  pending: 'Teach-back pending',
  verified: 'Verified',
  not_verified: 'Not verified',
  deferred: 'Deferred',
  not_applicable: 'Not applicable',
};

const STATE_CLASS: Record<DerivedDomainState, string> = {
  pending: 'bg-gray-100 text-gray-700',
  verified: 'bg-green-100 text-green-700',
  not_verified: 'bg-red-100 text-red-700',
  deferred: 'bg-amber-100 text-amber-800',
  not_applicable: 'bg-slate-200 text-slate-700',
};

const OUTCOME_LABEL: Record<TeachbackOutcome, string> = {
  verified: 'Verified',
  not_verified: 'Not verified',
  deferred: 'Defer',
  not_applicable: 'Not applicable',
};

const METHOD_LABEL: Record<TeachbackMethod, string> = {
  in_person: 'In person',
  telephone: 'Telephone',
  video: 'Video',
  written: 'Written',
};

function formatDay(value: string): string {
  try {
    return format(parseISO(value), 'MMM d, yyyy');
  } catch {
    return value;
  }
}

export function EducationTeachback({
  patientId,
  teachbacks,
  canRecord,
  loadError = null,
}: {
  patientId: string;
  teachbacks: EducationTeachbackRecord[];
  canRecord: boolean;
  loadError?: string | null;
}) {
  const [openDomain, setOpenDomain] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<TeachbackOutcome>('verified');
  const [method, setMethod] = useState<'' | TeachbackMethod>('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const byDomain = new Map(teachbacks.map((record) => [record.domain_id, record]));
  const reasonRequired = TEACHBACK_REASON_REQUIRED.includes(outcome);

  const openForm = (domainId: string) => {
    setOpenDomain(domainId);
    setOutcome('verified');
    setMethod('');
    setReason('');
    setError(null);
    setMessage(null);
  };

  const submit = (domainId: string) => {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await recordTeachBack({
        patientId,
        domainId,
        outcome,
        reason: reason.trim() || undefined,
        method: method || undefined,
      });
      if (!result.success) {
        setError(result.error ?? 'This teach-back could not be recorded.');
        return;
      }
      setMessage('Teach-back recorded.');
      setOpenDomain(null);
    });
  };

  return (
    <section
      className="space-y-3"
      aria-labelledby="teachback-heading"
      data-testid="education-teachback"
    >
      <div className="flex items-start gap-2">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" aria-hidden="true" />
        <div>
          <h3 id="teachback-heading" className="text-sm font-semibold text-gray-900">
            Professional teach-back
          </h3>
          <p className="text-sm text-gray-600">
            Recorded by a professional and kept separate from the patient
            self-assessment above. A domain with no event stays pending.
          </p>
        </div>
      </div>

      {loadError && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {loadError}
        </p>
      )}

      {!canRecord && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          You do not hold the education authorization for this patient&apos;s
          organization, so teach-back is read-only here.
        </p>
      )}

      {message && (
        <p role="status" className="text-sm text-emerald-700">
          {message}
        </p>
      )}

      <div className="space-y-2">
        {EDUCATION_DOMAINS.map((domain) => {
          const record = byDomain.get(domain.id);
          const state: DerivedDomainState = record?.outcome ?? 'pending';
          const isOpen = openDomain === domain.id;

          return (
            <div
              key={domain.id}
              className="rounded-lg border border-gray-200 bg-white p-3"
              data-testid={`teachback-row-${domain.id}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-gray-900">{domain.title}</p>
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATE_CLASS[state]}`}
                  data-testid={`teachback-state-${domain.id}`}
                >
                  {STATE_LABEL[state]}
                </span>
              </div>

              {record && (
                <p className="mt-1 text-xs text-gray-600">
                  {record.outcome === 'verified'
                    ? `Teach-back verified by ${record.verified_by_name ?? 'a professional'} on ${formatDay(record.occurred_at)}`
                    : `${STATE_LABEL[record.outcome]} by ${record.verified_by_name ?? 'a professional'} on ${formatDay(record.occurred_at)}`}
                  {record.method ? ` · ${METHOD_LABEL[record.method]}` : ''}
                  {record.event_count > 1 ? ` · reassessed ${record.event_count} times` : ''}
                </p>
              )}

              {record?.reason && (
                <p className="mt-1 text-xs text-gray-700">Reason: {record.reason}</p>
              )}

              {canRecord && !isOpen && (
                <Button
                  type="button"
                  variant="outline"
                  className="mt-2 min-h-11"
                  onClick={() => openForm(domain.id)}
                >
                  Record teach-back
                </Button>
              )}

              {canRecord && isOpen && (
                <form
                  className="mt-3 space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    submit(domain.id);
                  }}
                >
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-sm font-medium text-gray-800">
                      Outcome
                      <select
                        name="outcome"
                        value={outcome}
                        onChange={(event) =>
                          setOutcome(event.target.value as TeachbackOutcome)
                        }
                        className="mt-1 min-h-11 w-full rounded-md border bg-white px-3"
                      >
                        {TEACHBACK_OUTCOMES.map((value) => (
                          <option key={value} value={value}>
                            {OUTCOME_LABEL[value]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-sm font-medium text-gray-800">
                      Method (optional)
                      <select
                        name="method"
                        value={method}
                        onChange={(event) =>
                          setMethod(event.target.value as '' | TeachbackMethod)
                        }
                        className="mt-1 min-h-11 w-full rounded-md border bg-white px-3"
                      >
                        <option value="">Not recorded</option>
                        {TEACHBACK_METHODS.map((value) => (
                          <option key={value} value={value}>
                            {METHOD_LABEL[value]}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  {reasonRequired && (
                    <label className="block text-sm font-medium text-gray-800">
                      Documented reason
                      <textarea
                        name="reason"
                        required
                        minLength={3}
                        maxLength={1000}
                        rows={2}
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                        placeholder="Why this domain is deferred or does not apply now."
                        className="mt-1 w-full rounded-md border px-3 py-2"
                      />
                    </label>
                  )}

                  <div className="flex items-center gap-3">
                    <Button type="submit" className="min-h-11" disabled={pending}>
                      {pending ? 'Recording…' : 'Save teach-back'}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="min-h-11"
                      onClick={() => setOpenDomain(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              )}
            </div>
          );
        })}
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}
