/**
 * Remote Monitoring — TypeScript Interfaces
 *
 * Protocol v3.3 Module 5: Remote Patient Monitoring
 * Track Assignment (Table 4), Red Flag Alerts (Section 5.2),
 * Billing Codes (Section 5.3), TIM-HF2 Evidence (Section 5.1)
 */

export interface TrackAssessment {
  smartphoneConnectivity: boolean;
  comfortableWithApps: boolean;
  reliableTelephone: boolean;
}

export type TrackType = 'track-a' | 'track-b' | 'hybrid';

export interface TrackRecommendation {
  track: TrackType;
  label: string;
  rationale: string;
}

export type SeverityLevel = 'emergency' | 'urgent' | 'same-day';

export interface RedFlagAlert {
  id: string;
  finding: string;
  action: string;
  severity: SeverityLevel;
}

export interface BillingCode {
  code: string;
  description: string;
  verification: string;
}

export interface TimHf2Outcome {
  outcome: string;
  result: string;
}

export interface TimHf2Evidence {
  name: string;
  year: number;
  outcomes: TimHf2Outcome[];
}
