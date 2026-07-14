import { describe, it, expect } from 'vitest';
import {
  HFREF_MEDICATIONS,
  HFPEF_MEDICATIONS,
  FINERENONE_SCENARIOS,
  SAFETY_GATE_RULES,
  GENERIC_BRIDGE_ITEMS,
  GENERIC_BRIDGE_PRINCIPLE,
  NON_PHARMACOLOGICAL,
} from '@/lib/gdmt/constants';
import { EVIDENCE_LEVEL_CONFIG } from '@/lib/gdmt/evidence-levels';

// ==========================================================================
// GDMT-01: HFrEF/HFpEF Decision Tree — Data Integrity
// Protocol v3.3 Module 2, Sections 2.1 and 2.2
// ==========================================================================
describe('GDMT-01: HFrEF/HFpEF Decision Tree', () => {
  it('HFREF_MEDICATIONS contains exactly 4 drug classes: ARNI, Beta-blocker, MRA, SGLT2i', () => {
    expect(HFREF_MEDICATIONS).toHaveLength(4);
    const classes = HFREF_MEDICATIONS.map((m) => m.drugClass);
    expect(classes).toEqual(['ARNI', 'Beta-blocker', 'MRA', 'SGLT2i']);
  });

  it('HFPEF_MEDICATIONS contains exactly 4 entries in priority order: SGLT2i, MRA, GLP-1 RA, Diuretics', () => {
    expect(HFPEF_MEDICATIONS).toHaveLength(4);
    HFPEF_MEDICATIONS.forEach((med, i) => {
      expect(med.priority).toBe(i + 1);
    });
    const classes = HFPEF_MEDICATIONS.map((m) => m.drugClass);
    expect(classes).toEqual(['SGLT2i', 'MRA', 'GLP-1 RA', 'Diuretics']);
  });
});

// ==========================================================================
// GDMT-05: Evidence Labels — Data Integrity
// Established (green), Emerging (yellow), Pragmatic (gray)
// ==========================================================================
describe('GDMT-05: Evidence Labels', () => {
  it('every HFrEF medication has evidenceLevel "established"', () => {
    HFREF_MEDICATIONS.forEach((med) => {
      expect(med.evidenceLevel).toBe('established');
    });
  });

  it('HFpEF medications reflect the 2025 finerenone label update', () => {
    const levels = HFPEF_MEDICATIONS.map((m) => m.evidenceLevel);
    expect(levels).toEqual(['established', 'established', 'emerging', 'pragmatic']);
  });

  it('EVIDENCE_LEVEL_CONFIG has entries for all three levels: established, emerging, pragmatic', () => {
    expect(EVIDENCE_LEVEL_CONFIG).toHaveProperty('established');
    expect(EVIDENCE_LEVEL_CONFIG).toHaveProperty('emerging');
    expect(EVIDENCE_LEVEL_CONFIG).toHaveProperty('pragmatic');
    expect(EVIDENCE_LEVEL_CONFIG.established.label).toBe('Established');
    expect(EVIDENCE_LEVEL_CONFIG.emerging.label).toBe('Emerging');
    expect(EVIDENCE_LEVEL_CONFIG.pragmatic.label).toBe('Pragmatic');
  });
});

// ==========================================================================
// GDMT-09: Content Matches Protocol v3.3 Module 2 Exactly
// Each assertion references specific values from reference/clinical_content.md
// ==========================================================================
describe('GDMT-09: Content Matches Protocol', () => {
  describe('HFrEF Quadruple Therapy (Table from Section 2.1)', () => {
    it('HFrEF ARNI: agent is "Sacubitril/valsartan", starting "24/26 mg BID", target "97/103 mg BID"', () => {
      const arni = HFREF_MEDICATIONS.find((m) => m.id === 'arni');
      expect(arni).toBeDefined();
      expect(arni!.agent).toBe('Sacubitril/valsartan');
      expect(arni!.startingDose).toBe('24/26 mg BID');
      expect(arni!.targetDose).toBe('97/103 mg BID');
      expect(arni!.safetyGates).toEqual(['SBP >100', 'K+ <5.5']);
    });

    it('HFrEF Beta-blocker: agent is "Carvedilol", starting "3.125 mg BID", target "25 mg BID (50 if >85kg)"', () => {
      const bb = HFREF_MEDICATIONS.find((m) => m.id === 'beta-blocker');
      expect(bb).toBeDefined();
      expect(bb!.agent).toBe('Carvedilol');
      expect(bb!.startingDose).toBe('3.125 mg BID');
      expect(bb!.targetDose).toBe('25 mg BID (50 if >85kg)');
      expect(bb!.safetyGates).toEqual(['HR >50', 'SBP >90']);
    });

    it('HFrEF MRA: agent is "Spironolactone", starting "12.5-25 mg daily", target "25-50 mg daily"', () => {
      const mra = HFREF_MEDICATIONS.find((m) => m.id === 'mra');
      expect(mra).toBeDefined();
      expect(mra!.agent).toBe('Spironolactone');
      expect(mra!.startingDose).toBe('12.5-25 mg daily');
      expect(mra!.targetDose).toBe('25-50 mg daily');
      expect(mra!.safetyGates).toEqual(['eGFR >30', 'K+ <5.0']);
    });

    it('HFrEF SGLT2i: agent is "Dapagliflozin or Empagliflozin", dose "10 mg daily"', () => {
      const sglt2i = HFREF_MEDICATIONS.find((m) => m.id === 'sglt2i');
      expect(sglt2i).toBeDefined();
      expect(sglt2i!.agent).toBe('Dapagliflozin or Empagliflozin');
      expect(sglt2i!.startingDose).toBe('10 mg daily');
      expect(sglt2i!.targetDose).toBe('10 mg daily (no titration)');
      expect(sglt2i!.safetyGates).toEqual(['eGFR >20']);
    });
  });

  describe('HFpEF Evidence Context (Table from Section 2.2)', () => {
    it('HFpEF priority 1 SGLT2i has evidenceContext mentioning EMPEROR-Preserved and DELIVER', () => {
      const sglt2i = HFPEF_MEDICATIONS[0];
      expect(sglt2i.evidenceContext).toContain('EMPEROR-Preserved');
      expect(sglt2i.evidenceContext).toContain('DELIVER');
    });

    it('HFpEF priority 2 MRA has evidenceContext mentioning FINEARTS-HF', () => {
      const mra = HFPEF_MEDICATIONS[1];
      expect(mra.evidenceContext).toContain('FINEARTS-HF');
    });
  });

  describe('Finerenone Decision Guide (Section 2.2)', () => {
    it('FINERENONE_SCENARIOS contains exactly 5 clinical scenarios', () => {
      expect(FINERENONE_SCENARIOS).toHaveLength(5);
    });
  });

  describe('Safety Gates (Section 2.2 Titration Safety Gates Summary)', () => {
    it('SAFETY_GATE_RULES contains 3 uptitrate and 4 hold conditions', () => {
      const uptitrate = SAFETY_GATE_RULES.filter((r) => r.action === 'uptitrate');
      const hold = SAFETY_GATE_RULES.filter((r) => r.action === 'hold');
      expect(uptitrate).toHaveLength(3);
      expect(hold).toHaveLength(4);
    });
  });

  describe('Generic Bridge (Section 2.4)', () => {
    it('GENERIC_BRIDGE_ITEMS contains 4 drugs each at $4/month', () => {
      expect(GENERIC_BRIDGE_ITEMS).toHaveLength(4);
      GENERIC_BRIDGE_ITEMS.forEach((item) => {
        expect(item.monthlyCost).toBe('$4/month');
      });
    });

    it('GENERIC_BRIDGE_PRINCIPLE states generic therapy is superior to no therapy', () => {
      expect(GENERIC_BRIDGE_PRINCIPLE).toContain('Generic therapy is superior to NO therapy');
    });
  });

  describe('Non-Pharmacological (Section 2.3)', () => {
    it('NON_PHARMACOLOGICAL has sodium (<2,000 mg/day), activity, and cardiac rehab entries', () => {
      expect(NON_PHARMACOLOGICAL.sodium.target).toBe('<2,000 mg/day');
      expect(NON_PHARMACOLOGICAL.activity.target).toContain('Walking 5-10 min daily');
      expect(NON_PHARMACOLOGICAL.cardiacRehab.target).toContain('Class I recommendation');
    });
  });
});
