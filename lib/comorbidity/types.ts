// Phase 17: Comorbidity Manager types
// Source: HEARTLAND Protocol Module 6

export type ComorbidityKey =
  | 'afib'
  | 'osa'
  | 'iron_deficiency'
  | 'diabetes'
  | 'ckd'
  | 'copd'
  | 'depression'
  | 'hypertension';

export interface ComorbidityDetail {
  key: ComorbidityKey;
  label: string;
  keyConsiderations: string;
  whatToDo: string;
  gdmtInteractions: string[];
}

export interface ReferralCriteriaInput {
  lvef: number | null;
  gdmtDurationMonths: number | null;
  hfHospitalizationsLast12m: number | null;
}

export type ReferralResult = 'refer' | 'monitor' | 'insufficient_data';

export interface ReferralEvaluation {
  result: ReferralResult;
  gateMet: boolean;
  additionalCriteria: string[];
  recommendation: string;
}

export interface DeviceCriteriaInput {
  lvef: number | null;
  lbbb: boolean;
  qrsMs: number | null;
  gdmtDurationMonths: number | null;
}

export type DeviceResult =
  | 'crt_candidate'
  | 'possible_crt'
  | 'icd_only'
  | 'monitor'
  | 'insufficient_data';

export interface DeviceEvaluation {
  result: DeviceResult;
  recommendation: string;
}
