import { describe, expect, it } from 'vitest';
import { emptyExtraction } from '@/lib/sandbox-ai/engine';
import { checkInToSbarInput, draftSbarFromCheckIn } from '@/lib/sandbox-ai/sbar';
import { SANDBOX_PATIENTS } from '@/lib/sandbox/fixtures';

const maria = SANDBOX_PATIENTS.find((patient) => patient.id === 'demo-maria')!;
const robert = SANDBOX_PATIENTS.find((patient) => patient.id === 'demo-robert')!;

const mariaExtraction = { ...emptyExtraction(), weightLbs: 179.5, dyspnea: 2, edema: 2 };

describe('checkInToSbarInput', () => {
  it('maps check-in values over the synthetic fixture with sensible fallbacks', () => {
    const input = checkInToSbarInput(maria, mariaExtraction);
    expect(input.patient_name).toBe('Maria Santos');
    expect(input.vitals?.weight_lbs).toBe(179.5);
    expect(input.vitals?.sbp).toBe(108); // not collected in the check-in -> last synthetic value
    expect(input.vitals?.heart_rate).toBe(82);
    expect(input.vitals?.spo2).toBeNull(); // never sourced from fixtures: check-in only
    expect(input.risk_tier).toBe('high');
    expect(input.track_assignment).toBe('A');
    expect(input.facility_tier).toBe(2);
  });

  it('parses fixture medication doses into dosage and frequency', () => {
    const meds = checkInToSbarInput(maria, mariaExtraction).medications;
    expect(meds).toContainEqual({ name: 'Sacubitril/valsartan', dosage: '49/51 mg', frequency: 'twice daily' });
    expect(meds).toContainEqual({ name: 'Spironolactone', dosage: '25 mg', frequency: 'daily' });
    const gap = meds.find((medication) => medication.name === 'SGLT2 inhibitor')!;
    expect(gap.dosage).toBe('Not documented');
  });

  it('parses fixture labs into numeric values and treats non-numeric as missing', () => {
    const labs = checkInToSbarInput(maria, mariaExtraction).labs[0];
    expect(labs.potassium).toBe(4.7);
    expect(labs.creatinine).toBe(1.42);
    expect(labs.egfr).toBe(41);
    expect(labs.nt_probnp).toBeNull(); // fixture value is "Not available"
  });

  it('maps the analog-track patient to Track B', () => {
    expect(checkInToSbarInput(robert, emptyExtraction()).track_assignment).toBe('B');
  });
});

describe('draftSbarFromCheckIn', () => {
  it('drafts S and B from data and leaves A and R to the provider', () => {
    const draft = draftSbarFromCheckIn(maria, mariaExtraction);
    expect(draft.situation).toContain('Maria Santos');
    expect(draft.situation).toContain('Weight 179.5 lbs');
    expect(draft.background).toContain('Digital Track (Track A)');
    expect(draft.assessment).toContain('Provider to add clinical assessment');
    expect(draft.recommendation).toContain('Provider to complete');
  });
});
