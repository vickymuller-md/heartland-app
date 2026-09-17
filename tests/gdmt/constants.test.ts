import { describe, it, expect } from 'vitest';
import {
  HFREF_MEDICATIONS,
  HFPEF_MEDICATIONS,
  FINERENONE_SCENARIOS,
  SAFETY_GATE_RULES,
  GENERIC_BRIDGE_ITEMS,
  GENERIC_BRIDGE_PRINCIPLE,
  NON_PHARMACOLOGICAL,
  SGLT2I_RENAL_GATES,
  EPLERENONE_GUIDE,
  FINERENONE_DOSING,
  FINERENONE_CONTRAINDICATIONS,
  FINERENONE_INTERACTIONS,
  FINERENONE_MONITORING,
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
      expect(arni!.safetyGates).toEqual([
        'SBP >100',
        'K+ <5.5',
        'eGFR <30: start at half the usual dose (ENTRESTO label 2.7); no renal floor',
      ]);
    });

    it('HFrEF Beta-blocker: agent is "Carvedilol", starting "3.125 mg BID", target "25 mg BID (50 if >85kg)"', () => {
      const bb = HFREF_MEDICATIONS.find((m) => m.id === 'beta-blocker');
      expect(bb).toBeDefined();
      expect(bb!.agent).toBe('Carvedilol');
      expect(bb!.startingDose).toBe('3.125 mg BID');
      expect(bb!.targetDose).toBe('25 mg BID (50 if >85kg)');
      expect(bb!.safetyGates).toEqual(['HR >50', 'SBP >90']);
    });

    it('HFrEF MRA: spironolactone or eplerenone, starting "12.5-25 mg daily", target "25-50 mg daily"', () => {
      const mra = HFREF_MEDICATIONS.find((m) => m.id === 'mra');
      expect(mra).toBeDefined();
      expect(mra!.agent).toBe('Spironolactone or eplerenone');
      expect(mra!.startingDose).toBe('12.5-25 mg daily');
      expect(mra!.targetDose).toBe('25-50 mg daily');
      expect(mra!.safetyGates.slice(0, 2)).toEqual(['eGFR >30', 'K+ <5.0']);
    });

    it('HFrEF MRA carries the eGFR 30-50 dose reduction', () => {
      const mra = HFREF_MEDICATIONS.find((m) => m.id === 'mra');
      const reduction = mra!.safetyGates.find((g) => g.includes('eGFR 30-50'));
      expect(reduction).toBeDefined();
      expect(reduction).toMatch(/half the dose|25 mg every other day/i);
    });

    it('HFrEF SGLT2i: agent is "Dapagliflozin or Empagliflozin", dose "10 mg daily"', () => {
      const sglt2i = HFREF_MEDICATIONS.find((m) => m.id === 'sglt2i');
      expect(sglt2i).toBeDefined();
      expect(sglt2i!.agent).toBe('Dapagliflozin or Empagliflozin');
      expect(sglt2i!.startingDose).toBe('10 mg daily');
      expect(sglt2i!.targetDose).toBe('10 mg daily (no titration)');
      expect(sglt2i!.safetyGates).toEqual(SGLT2I_RENAL_GATES);
    });

    it('SGLT2i renal gates are per agent and per moment, with no eGFR >20 floor', () => {
      expect(SGLT2I_RENAL_GATES).toHaveLength(2);
      expect(SGLT2I_RENAL_GATES[0]).toMatch(/^Dapagliflozin: do not initiate if eGFR <25/);
      expect(SGLT2I_RENAL_GATES[0]).toMatch(/may continue 10 mg/);
      expect(SGLT2I_RENAL_GATES[1]).toMatch(/^Empagliflozin: no eGFR floor/);
      expect(SGLT2I_RENAL_GATES.join(' ')).not.toMatch(/eGFR >20/);
    });

    it('the HFpEF SGLT2i card carries the same renal gates as the HFrEF card', () => {
      const hfpefSglt2i = HFPEF_MEDICATIONS.find((m) => m.id === 'sglt2i-hfpef');
      expect(hfpefSglt2i!.safetyGates).toEqual(SGLT2I_RENAL_GATES);
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

  // ========================================================================
  // Eplerenone: the guideline alternative to spironolactone
  // Source: INSPRA label (DailyMed SPL 1a52bedc-8e2c-4116-a296-a87770676b4a);
  // 2022 AHA/ACC/HFSA COR 1 A; RALES (gynecomastia in 10% of men)
  // ========================================================================
  describe('Eplerenone reference (F11)', () => {
    it('carries the label dose and the 4-week target', () => {
      expect(EPLERENONE_GUIDE.startingDose).toMatch(/25 mg once daily/);
      expect(EPLERENONE_GUIDE.targetDose).toMatch(/50 mg once daily/);
      expect(EPLERENONE_GUIDE.targetDose).toMatch(/4 weeks/);
    });

    it('carries both label contraindications: CrCl <=30 mL/min and K+ >5.5 mEq/L', () => {
      const joined = EPLERENONE_GUIDE.contraindications.join(' ');
      expect(joined).toMatch(/creatinine clearance <=30 mL\/min/i);
      expect(joined).toMatch(/potassium >5\.5 mEq\/L/i);
    });

    it('warns that creatinine clearance is not interchangeable with eGFR', () => {
      expect(EPLERENONE_GUIDE.unitCaution).toMatch(/not interchangeable/i);
    });

    it('carries the four potassium bands of label Table 1, including >=6.0 with the restart rule', () => {
      expect(EPLERENONE_GUIDE.potassiumBands).toHaveLength(4);
      const ranges = EPLERENONE_GUIDE.potassiumBands.map((b) => b.range);
      expect(ranges).toEqual(['<5.0', '5.0-5.4', '5.5-5.9', '>=6.0']);
      const highest = EPLERENONE_GUIDE.potassiumBands[3];
      expect(highest.action).toMatch(/withhold/i);
      expect(highest.action).toMatch(/restart at 25 mg every other day/i);
      expect(highest.action).toMatch(/<5\.5/);
    });
  });

  describe('Finerenone Decision Guide (Section 2.2)', () => {
    it('FINERENONE_SCENARIOS contains exactly 5 clinical scenarios', () => {
      expect(FINERENONE_SCENARIOS).toHaveLength(5);
    });

    // F3: no automatic MRA preference in LVEF >=40%. FINEARTS-HF increased
    // hyperkalemia (HR 2.16 for K+ >5.5, JAMA Cardiol 2025) and there is no
    // head-to-head trial against spironolactone in heart failure.
    it('states no automatic preference and never claims lower hyperkalemia', () => {
      const joined = FINERENONE_SCENARIOS.map((s) => `${s.suggestedApproach} ${s.rationale}`).join(' ');
      expect(joined).toMatch(/No automatic preference/i);
      expect(joined).not.toMatch(/finerenone preferred/i);
      expect(joined).not.toMatch(/lower hyperkalemia/i);
      expect(joined).not.toMatch(/either acceptable/i);
    });
  });

  // ========================================================================
  // Finerenone dose, contraindications and monitoring (F4, F12, F10)
  // Source: KERENDIA label, DailyMed SPL fc726765-5d5a-4d6e-b037-b847bda9fb7c
  // (rev. 8/2025), sections 1, 2.1, 2.3, 4, 5.1, 7.1, 8.6 and Table 1
  // ========================================================================
  describe('Finerenone dosing (F4)', () => {
    it('has two initiation bands split at eGFR 60, with distinct starting and target doses', () => {
      expect(FINERENONE_DOSING.bands).toHaveLength(2);
      const [full, reduced] = FINERENONE_DOSING.bands;

      expect(full.minEgfr).toBe(60);
      expect(full.maxEgfr).toBeNull();
      expect(full.startingDose).toBe('20 mg once daily');
      expect(full.targetDose).toBe('40 mg once daily');

      expect(reduced.minEgfr).toBe(25);
      expect(reduced.maxEgfr).toBe(60);
      expect(reduced.startingDose).toBe('10 mg once daily');
      expect(reduced.targetDose).toBe('20 mg once daily');
    });

    it('never prints the starting dose as the target dose', () => {
      for (const band of FINERENONE_DOSING.bands) {
        expect(band.startingDose).not.toBe(band.targetDose);
      }
    });

    it('does not recommend initiation below eGFR 25', () => {
      expect(FINERENONE_DOSING.notRecommendedBelowEgfr).toBe(25);
      expect(FINERENONE_DOSING.belowThresholdAction).toMatch(/not recommended/i);
    });

    it('the LVEF >=40% MRA card carries the banded doses, not a single 10-20 mg range', () => {
      const mra = HFPEF_MEDICATIONS.find((m) => m.id === 'mra-hfpef');
      expect(mra!.startingDose).not.toBe(mra!.targetDose);
      expect(mra!.targetDose).toMatch(/40 mg/);
    });
  });

  describe('Finerenone contraindications and interactions (F12)', () => {
    it('lists strong CYP3A4 inhibitors and adrenal insufficiency as contraindications', () => {
      const joined = FINERENONE_CONTRAINDICATIONS.join(' ');
      expect(joined).toMatch(/strong CYP3A4 inhibitors/i);
      expect(joined).toMatch(/adrenal insufficiency/i);
    });

    it('lists grapefruit, CYP3A4 inducers and Child-Pugh C among the interactions', () => {
      const joined = FINERENONE_INTERACTIONS.join(' ');
      expect(joined).toMatch(/grapefruit/i);
      expect(joined).toMatch(/inducers/i);
      expect(joined).toMatch(/Child-Pugh C/i);
    });
  });

  describe('Finerenone monitoring (F10)', () => {
    it('keeps the 1-week recheck and adds the 4-week label milestone, each with its source', () => {
      expect(FINERENONE_MONITORING.labelMinimum).toMatch(/4 weeks/);
      expect(FINERENONE_MONITORING.labelMinimum).toMatch(/KERENDIA/);
      expect(FINERENONE_MONITORING.protocolAddition).toMatch(/1 week/);
      expect(FINERENONE_MONITORING.protocolAddition).toMatch(/2022 AHA\/ACC\/HFSA/);
      expect(FINERENONE_MONITORING.protocolAddition).toMatch(/does not replace/i);
    });

    it('does not attribute the 1-week recheck to FINEARTS-HF', () => {
      expect(FINERENONE_MONITORING.protocolAddition).not.toMatch(/FINEARTS/);
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
