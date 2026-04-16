import { describe, it, expect } from 'vitest';
import {
  DUAL_TRACKS,
  HOZHO_TRIAL,
  TITRATION_DECISIONS,
  SAFETY_GATES,
  STEP_DEFINITIONS,
} from '@/lib/titration/constants';

// ==========================================================================
// TITR-03: Dual-Track Telephone/Digital Titration
// Protocol v3.3 Module 3, Section 3.2
// ==========================================================================
describe('TITR-03 Dual-Track definitions', () => {
  it('DUAL_TRACKS.trackA has exactly 5 features matching protocol Section 3.2', () => {
    expect(DUAL_TRACKS.trackA.features).toHaveLength(5);
    expect(DUAL_TRACKS.trackA.features[0]).toContain('Smartphone');
    expect(DUAL_TRACKS.trackA.features[1]).toContain('Bluetooth');
    expect(DUAL_TRACKS.trackA.features[2]).toContain('App-based');
    expect(DUAL_TRACKS.trackA.features[3]).toContain('Automated alerts');
    expect(DUAL_TRACKS.trackA.features[4]).toContain('Video visits');
  });

  it('DUAL_TRACKS.trackB has exactly 5 features matching protocol Section 3.2', () => {
    expect(DUAL_TRACKS.trackB.features).toHaveLength(5);
    expect(DUAL_TRACKS.trackB.features[0]).toContain('Paper diary');
    expect(DUAL_TRACKS.trackB.features[1]).toContain('Standard devices');
    expect(DUAL_TRACKS.trackB.features[2]).toContain('Voice telephone');
    expect(DUAL_TRACKS.trackB.features[3]).toContain('Verbal report');
    expect(DUAL_TRACKS.trackB.features[4]).toContain('Phone visits only');
  });

  it('DUAL_TRACKS.note states both tracks follow identical clinical decision algorithms', () => {
    expect(DUAL_TRACKS.note).toContain('identical clinical decision algorithms');
  });
});

// ==========================================================================
// TITR-04: Hozho Trial Evidence Badge
// Protocol v3.3 Module 3, Section 3.1
// ==========================================================================
describe('TITR-04 Hozho Trial evidence', () => {
  it('HOZHO_TRIAL has 6 parameters matching protocol Section 3.1', () => {
    expect(HOZHO_TRIAL.parameters).toHaveLength(6);
  });

  it('HOZHO_TRIAL year is 2024', () => {
    expect(HOZHO_TRIAL.year).toBe(2024);
  });

  it('HOZHO_TRIAL population: "103 American Indians with HF in rural Navajo Nation"', () => {
    const pop = HOZHO_TRIAL.parameters.find((p) => p.parameter === 'Population');
    expect(pop!.result).toBe('103 American Indians with HF in rural Navajo Nation');
  });

  it('HOZHO_TRIAL primary outcome shows 66.2% vs 13.1%', () => {
    const outcome = HOZHO_TRIAL.parameters.find((p) => p.parameter === 'Primary Outcome');
    expect(outcome!.result).toContain('66.2%');
    expect(outcome!.result).toContain('13.1%');
  });

  it('HOZHO_TRIAL absolute increase is 53%', () => {
    const increase = HOZHO_TRIAL.parameters.find((p) => p.parameter === 'Absolute Increase');
    expect(increase!.result).toBe('53%');
  });

  it('HOZHO_TRIAL telehealth completion is 80.5% adherence', () => {
    const completion = HOZHO_TRIAL.parameters.find((p) => p.parameter === 'Telehealth Completion');
    expect(completion!.result).toContain('80.5%');
  });
});

// ==========================================================================
// TITR-07: Content Matches Protocol Module 3 Exactly
// ==========================================================================
describe('TITR-07 Content matches protocol Module 3', () => {
  it('TITRATION_DECISIONS contains exactly 7 parameter-action entries', () => {
    expect(TITRATION_DECISIONS).toHaveLength(7);
  });

  it('SAFETY_GATES contains exactly 5 gate evaluators (SBP, HR, K+, Cr, eGFR)', () => {
    expect(SAFETY_GATES).toHaveLength(5);
  });

  it('TITRATION_DECISIONS[0] parameter uses unicode >= symbol', () => {
    expect(TITRATION_DECISIONS[0].parameter).toBe('SBP \u2265 100 mmHg AND asymptomatic');
  });

  it('TITRATION_DECISIONS[0] action: "UPTITRATE to next dose level"', () => {
    expect(TITRATION_DECISIONS[0].action).toBe('UPTITRATE to next dose level');
  });

  it('TITRATION_DECISIONS[5] action contains "HOLD MRA/finerenone and ARNI"', () => {
    expect(TITRATION_DECISIONS[5].action).toContain('HOLD MRA/finerenone and ARNI');
  });

  it('TITRATION_DECISIONS[6] action contains "HOLD ARNI/MRA"', () => {
    expect(TITRATION_DECISIONS[6].action).toContain('HOLD ARNI/MRA');
  });

  it('STEP_DEFINITIONS contains exactly 5 steps', () => {
    expect(STEP_DEFINITIONS).toHaveLength(5);
  });

  it('STEP_DEFINITIONS step labels match wizard steps', () => {
    const labels = STEP_DEFINITIONS.map((s) => s.label);
    expect(labels).toEqual([
      'Pre-Call Vitals',
      'Medication Review',
      'Safety Gate Check',
      'Titration Decision',
      'Plan & Follow-Up',
    ]);
  });
});
