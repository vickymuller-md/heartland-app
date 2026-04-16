import { describe, it } from 'vitest'

describe('Provider Medication View (MEDS-05)', () => {
  describe('Adherence Summary Query', () => {
    it.todo('getAdherenceSummary returns totalDoses and takenDoses for 30-day window')
    it.todo('getAdherenceSummary computes adherenceRate as percentage')
    it.todo('getAdherenceSummary returns per-medication breakdown')
    it.todo('getAdherenceSummary only returns data for linked patients (RLS)')
  })

  describe('Medication List Query', () => {
    it.todo('getPatientMedications returns active medications for patient')
    it.todo('getPatientMedications includes dosage and frequency')
    it.todo('provider query respects provider_patient_links RLS')
  })
})
