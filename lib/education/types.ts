/**
 * HEARTLAND Patient Education -- TypeScript Types
 *
 * Source: HEARTLAND Protocol v3.3, Module 4 (Teach-Back Domains)
 * Requirements: EDUC-01 through EDUC-05, RMON-06
 */

export type TrackVariant = 'track_a' | 'track_b' | 'common';

/** Education key derived from the stored assignment. */
export type TrackKey = 'track_a' | 'track_b' | 'hybrid';

/**
 * Maps the stored `patients.track_assignment` ('A' | 'B' | 'hybrid' | null) to the
 * keys the education screens use. Null defaults to Track B (RMON-06); hybrid keeps
 * its badge and reads Track B (paper) content until a separate decision says otherwise.
 */
export function trackKeyFromAssignment(value: string | null | undefined): TrackKey {
  if (value === 'A' || value === 'track_a') return 'track_a';
  if (value === 'hybrid') return 'hybrid';
  return 'track_b';
}

export interface EducationDomain {
  id: string;
  title: string;
  icon: string; // lucide-react icon name
  content: {
    common: string[]; // paragraphs shown to all patients
    track_a: string[]; // additional paragraphs for Track A (Digital)
    track_b: string[]; // additional paragraphs for Track B (Analog)
  };
  question: {
    text: string;
    options: string[]; // 3-4 multiple choice options
    correctIndex: number; // 0-based index of correct answer
    explanation: string; // shown after answering (correct or incorrect)
  };
}

export interface EducationProgress {
  id: string;
  patient_id: string;
  domain_id: string;
  completed: boolean;
  completed_at: string | null;
  attempts: number;
  created_at: string;
}

/**
 * Professional teach-back verification (migration 00040).
 *
 * A teach-back is a separate record from the patient self-assessment in
 * `education_progress` and the two are never collapsed: a completed module is
 * never reported as a documented teach-back, and a teach-back is never counted
 * as patient completion.
 */
export const TEACHBACK_OUTCOMES = [
  'verified',
  'not_verified',
  'deferred',
  'not_applicable',
] as const;

export type TeachbackOutcome = (typeof TEACHBACK_OUTCOMES)[number];

/** Outcomes that the database refuses without a documented reason (>= 3 chars). */
export const TEACHBACK_REASON_REQUIRED: readonly TeachbackOutcome[] = [
  'deferred',
  'not_applicable',
];

export const TEACHBACK_METHODS = [
  'in_person',
  'telephone',
  'video',
  'written',
] as const;

export type TeachbackMethod = (typeof TEACHBACK_METHODS)[number];

/** A domain with no teach-back event is `pending`, never `verified`. */
export type DerivedDomainState = 'pending' | TeachbackOutcome;

/** One row of `get_education_teachback_state`: newest event for that domain. */
export interface EducationTeachback {
  domain_id: string;
  outcome: TeachbackOutcome;
  reason: string | null;
  verified_by: string;
  verified_by_name: string | null;
  method: TeachbackMethod | null;
  caregiver_present: boolean | null;
  occurred_at: string;
  event_count: number;
}
