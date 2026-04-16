/**
 * HEARTLAND Patient Education -- TypeScript Types
 *
 * Source: HEARTLAND Protocol v3.3, Module 4 (Teach-Back Domains)
 * Requirements: EDUC-01 through EDUC-05, RMON-06
 */

export type TrackVariant = 'track_a' | 'track_b' | 'common';

export interface EducationDomain {
  id: string;
  title: string;
  tier: 'core' | 'extended'; // core = Tier 1+, extended = Tier 2/3 only
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
