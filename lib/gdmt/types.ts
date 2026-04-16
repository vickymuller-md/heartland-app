export type EvidenceLevel = 'established' | 'emerging' | 'pragmatic';
export type HfType = 'hfref' | 'hfpef';

export interface Medication {
  id: string;
  drugClass: string;
  agent: string;
  startingDose: string;
  targetDose: string;
  safetyGates: string[];
  evidenceLevel: EvidenceLevel;
  evidenceContext?: string;
  priority?: number;
  notes?: string;
}

export interface FinerenoneScenario {
  clinicalScenario: string;
  suggestedApproach: string;
  rationale: string;
}

export interface SafetyGateRule {
  condition: string;
  action: 'uptitrate' | 'hold';
}

export interface GenericBridgeItem {
  drugClass: string;
  agent: string;
  monthlyCost: string;
  note?: string;
}
