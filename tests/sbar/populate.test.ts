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

import { describe, it, expect } from 'vitest';

// ── Helper: minimal valid input (all null/empty) ─────────────
function minimalInput(overrides: Partial<SbarInput> = {}): SbarInput {
  return {
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
        labs: [
          {
            collected_at: '2026-03-20',
            potassium: 4.2,
            creatinine: 1.1,
            egfr: 62,
            bnp: 450,
            nt_probnp: null,
            sodium: null,
          },
        ],
      });

      const result = populateSbar(input);

      expect(result.background).toContain('K+ 4.2 mEq/L');
      expect(result.background).toContain('Creatinine 1.1 mg/dL');
      expect(result.background).toContain('eGFR 62 mL/min');
      expect(result.background).toContain('BNP 450 pg/mL');
    });

    it('handles empty labs -- shows "no recent labs"', () => {
      const input = minimalInput({ labs: [] });
      const result = populateSbar(input);

      expect(result.background).toContain('no recent labs');
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
