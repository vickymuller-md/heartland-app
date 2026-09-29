/**
 * populateSbar -- Tests
 * Requirement: SBAR-02 (auto-populate from patient data)
 * Source: HEARTLAND Protocol v3.3 -- Phase 15 SBAR Handoff Generator
 *
 * Tests for the populate function that fills SBAR sections
 * from patient vitals, medications, labs, track assignment,
 * facility tier, and risk tier.
 */

import { populateSbar } from '@/lib/sbar/populate';
import type { SbarInput, SbarData } from '@/lib/sbar/types';
import type { EffectiveLabObservation } from '@/lib/labs/effective';
import { LAB_OBSERVATION_FIELDS } from '@/lib/labs/quality';

import { describe, it, expect } from 'vitest';

const patientId = '65000000-0000-4000-8000-000000000001';
const resultId = '65000000-0000-4000-8000-000000000011';
const now = new Date('2026-09-29T12:00:00Z');
function lab(analyte: EffectiveLabObservation['analyte'], overrides: Partial<EffectiveLabObservation> = {}): EffectiveLabObservation {
  const original = overrides.original_lab_result_id ?? resultId;
  return { id: `${original}:${analyte}`, patient_id: patientId, original_lab_result_id: original,
    analyte, root_id: null, version_id: null, revision: null, status: 'original',
    effective_lab_result_id: original, value: '4.2', collected_at: '2026-03-20T10:00:00Z',
    notes: null, lab_facility: null, evaluation_status: null, ...overrides };
}

// ── Helper: minimal valid input (all null/empty) ─────────────
function minimalInput(overrides: Partial<SbarInput> = {}): SbarInput {
  return {
    patient_id: patientId,
    patient_name: 'Test Patient',
    vitals: null,
    medications: [],
    labs: [],
    risk_tier: null,
    track_assignment: null,
    facility_tier: null,
    ...overrides,
  };
}

describe('populateSbar', () => {
  // ── Situation Section ──────────────────────────────────────

  describe('Situation section', () => {
    it('fills Situation with patient name and latest vitals', () => {
      const input = minimalInput({
        patient_name: 'Jane Doe',
        risk_tier: 'high',
        vitals: {
          recorded_at: '2026-03-20T10:00:00Z',
          weight_lbs: 185,
          sbp: 110,
          dbp: 70,
          heart_rate: 82,
          spo2: 96,
        },
      });

      const result: SbarData = populateSbar(input);

      expect(result.situation).toContain('Jane Doe');
      expect(result.situation).toContain('High');
      expect(result.situation).toContain('185 lbs');
      expect(result.situation).toContain('110/70 mmHg');
      expect(result.situation).toContain('82 bpm');
      expect(result.situation).toContain('96%');
    });

    it('handles null vitals -- uses "not recorded" fallback', () => {
      const input = minimalInput({ vitals: null });
      const result = populateSbar(input);

      expect(result.situation).toContain('not recorded');
    });
  });

  // ── Background Section ─────────────────────────────────────

  describe('Background section', () => {
    it('fills Background with medications', () => {
      const input = minimalInput({
        medications: [
          { name: 'Carvedilol', dosage: '6.25mg', frequency: 'twice daily' },
        ],
      });

      const result = populateSbar(input);

      expect(result.background).toContain('Carvedilol 6.25mg twice daily');
    });

    it('handles empty medications array -- shows "none recorded"', () => {
      const input = minimalInput({ medications: [] });
      const result = populateSbar(input);

      expect(result.background).toContain('none recorded');
    });

    it('fills Background with lab values', () => {
      const input = minimalInput({
        labs: [lab('potassium'), lab('creatinine', { value: '1.1' }),
          lab('egfr', { value: '62' }), lab('bnp', { value: '450' })],
      });

      const result = populateSbar(input);

      expect(result.background).toContain('Potassium: 4.2 mEq/L');
      expect(result.background).toContain('Creatinine: 1.1 mg/dL');
      expect(result.background).toContain('eGFR: 62 mL/min/1.73m²');
      expect(result.background).toContain('BNP: 450 pg/mL');
    });

    it('handles empty labs as missing without claiming recency', () => {
      const input = minimalInput({ labs: [] });
      const result = populateSbar(input);

      expect(result.background).toContain('Recorded laboratory sources: none available.');
      expect(result.background).not.toContain('recent labs');
    });

    it('maps track_assignment "A" to "Digital Track (Track A)"', () => {
      const input = minimalInput({ track_assignment: 'A' });
      const result = populateSbar(input);

      expect(result.background).toContain('Digital Track (Track A)');
    });

    it('maps track_assignment "B" to "Analog Track (Track B)"', () => {
      const input = minimalInput({ track_assignment: 'B' });
      const result = populateSbar(input);

      expect(result.background).toContain('Analog Track (Track B)');
    });

    it('maps track_assignment "hybrid" to "Hybrid"', () => {
      const input = minimalInput({ track_assignment: 'hybrid' });
      const result = populateSbar(input);

      expect(result.background).toContain('Hybrid');
    });

    it('maps null track_assignment to "not assigned"', () => {
      const input = minimalInput({ track_assignment: null });
      const result = populateSbar(input);

      expect(result.background).toContain('not assigned');
    });

    it('includes facility tier when present', () => {
      const input = minimalInput({ facility_tier: 2 });
      const result = populateSbar(input);

      expect(result.background).toContain('Tier 2');
    });

    it('handles null facility tier -- shows "not recorded"', () => {
      const input = minimalInput({ facility_tier: null });
      const result = populateSbar(input);

      // "not recorded" for facility tier specifically
      expect(result.background).toMatch(/not recorded/i);
    });
  });

  // ── Assessment Section ─────────────────────────────────────

  describe('Assessment section', () => {
    it('fills Assessment with risk tier "Moderate"', () => {
      const input = minimalInput({ risk_tier: 'moderate' });
      const result = populateSbar(input);

      expect(result.assessment).toContain('Moderate');
    });

    it('handles null risk tier -- shows "not calculated"', () => {
      const input = minimalInput({ risk_tier: null });
      const result = populateSbar(input);

      expect(result.assessment).toContain('not calculated');
    });
  });

  // ── Recommendation Section ─────────────────────────────────

  describe('Recommendation section', () => {
    it('pre-fills with structured provider placeholder', () => {
      const input = minimalInput();
      const result = populateSbar(input);

      expect(result.recommendation).toContain('Provider to complete');
    });
  });

  // ── Null Safety ────────────────────────────────────────────

  describe('Null safety', () => {
    it('does not throw with all null/empty data', () => {
      const input: SbarInput = {
        patient_id: patientId,
        patient_name: 'X',
        vitals: null,
        labs: [],
        medications: [],
        risk_tier: null,
        track_assignment: null,
        facility_tier: null,
      };

      expect(() => populateSbar(input)).not.toThrow();

      const result = populateSbar(input);
      expect(result.situation).toBeTruthy();
      expect(result.background).toBeTruthy();
      expect(result.assessment).toBeTruthy();
      expect(result.recommendation).toBeTruthy();
    });
  });
});

describe('effective SBAR laboratory projection', () => {
  it('selects each analyte by its own collection and keeps exact decimals/microseconds', () => {
    const input = minimalInput({ labs: [
      lab('potassium', { value: '4.20000000000000001', collected_at: '2026-09-20T08:00:00.000001-04:00' }),
      lab('creatinine', { value: '1.234567890123456789', collected_at: '2026-01-01T10:00:00Z' }),
      lab('potassium', { value: '9', original_lab_result_id: '65000000-0000-4000-8000-000000000012', collected_at: '2026-09-20T12:00:00Z' }),
    ] });
    const text = populateSbar(input, now).background;
    expect(text).toContain('Potassium: 4.20000000000000001 mEq/L; collected 2026-09-20T12:00:00.000001Z');
    expect(text).toContain('Creatinine: 1.234567890123456789 mg/dL; collected 2026-01-01');
    expect(text).not.toContain('Potassium: 9');
    expect(text).toContain('recency and clinical suitability not assessed');
  });
  it('shows corrected status, exact revision and pending processing, not clinical review', () => {
    const text = populateSbar(minimalInput({ labs: [lab('potassium', {
      root_id: resultId, version_id: resultId, revision: '9223372036854775807', status: 'corrected',
      effective_lab_result_id: '65000000-0000-4000-8000-000000000099', evaluation_status: 'pending',
    })] }), now).background;
    expect(text).toContain('corrected, revision 9223372036854775807; alert processing pending');
    expect(text).not.toMatch(/reviewed|normal/i);
  });
  it('never revives older values after cancellation', () => {
    const text = populateSbar(minimalInput({ labs: [lab('potassium', { value: '3.1' }), lab('potassium', {
      original_lab_result_id: '65000000-0000-4000-8000-000000000012', collected_at: '2026-09-21T00:00:00Z',
      root_id: resultId, version_id: resultId, revision: '2', status: 'cancelled', value: null, effective_lab_result_id: null,
    })] }), now).background;
    expect(text).toContain('Potassium: cancelled; no current value');
    expect(text).not.toContain('3.1');
  });
  it.each(Object.keys(LAB_OBSERVATION_FIELDS) as EffectiveLabObservation['analyte'][])('does not offer negative %s as usable', (analyte) => {
    const text = populateSbar(minimalInput({ labs: [lab(analyte, { value: '-1' })] }), now).background;
    expect(text).toContain(`${LAB_OBSERVATION_FIELDS[analyte].label}: not usable; Invalid recorded value`);
    expect(text).not.toContain('-1');
  });
  it('blocks future and conflicting sources without using older values', () => {
    const future = populateSbar(minimalInput({ labs: [lab('bnp', { value: '7', collected_at: '2027-01-01T00:00:00Z' })] }), now);
    expect(future.background).toContain('BNP: not usable; Future collection time');
    const conflicting = populateSbar(minimalInput({ labs: [lab('bnp'), lab('bnp', {
      original_lab_result_id: '65000000-0000-4000-8000-000000000012', value: '4.200000000000000001',
    })] }), now);
    expect(conflicting.background).toContain('BNP: not usable; Conflicting current sources');
  });
  it('rejects malformed, duplicate and wrong-patient sources rather than hiding them', () => {
    expect(() => populateSbar(minimalInput({ patient_id: 'bad' }), now)).toThrow();
    expect(() => populateSbar(minimalInput({ labs: [lab('bnp', { collected_at: 'bad' })] }), now)).toThrow();
    expect(() => populateSbar(minimalInput({ labs: [lab('bnp'), lab('bnp')] }), now)).toThrow();
    expect(() => populateSbar(minimalInput({ labs: [lab('bnp', { patient_id: resultId })] }), now)).toThrow();
  });
});
