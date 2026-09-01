/**
 * Unified call-patient resolver. Before this module, both call finalizers did
 * `SANDBOX_PATIENTS.find(id) ?? SANDBOX_PATIENTS[0]` — any unknown patientId
 * silently became Maria Santos, weight-trend red flags included. Population
 * ids (`pop-<ordinal>-d<day>`) now resolve to the deterministic chart the
 * review queue was built from, so a call escalates for exactly the reason the
 * queue showed. Unparsable ids keep today's fixture fallback.
 */

import { SANDBOX_PATIENTS } from '@/lib/sandbox/fixtures';
import { getPopulationPatientChart } from '@/lib/sandbox/population';
import type { SandboxLab, SandboxVitalPoint } from '@/lib/sandbox/types';

/** The minimum both finalizers consume: latest vitals + weight labels + named labs. */
export interface CallPatientChart {
  id: string;
  name: string;
  vitals: SandboxVitalPoint[];
  labs: SandboxLab[];
}

export const POPULATION_CALL_ID = /^pop-(\d{1,4})-d([0-4])$/;

export function resolveCallPatient(patientId: string): CallPatientChart {
  const match = POPULATION_CALL_ID.exec(patientId);
  if (match) {
    // The id's dayIndex is authoritative — the server holds no visitor state.
    const chart = getPopulationPatientChart(Number(match[1]), Number(match[2]));
    return { id: patientId, name: chart.name, vitals: chart.vitals, labs: chart.labs };
  }
  const fixture = SANDBOX_PATIENTS.find((entry) => entry.id === patientId) ?? SANDBOX_PATIENTS[0];
  return { id: fixture.id, name: fixture.name, vitals: fixture.vitals, labs: fixture.labs };
}
