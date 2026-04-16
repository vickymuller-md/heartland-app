import { describe, it, expect } from 'vitest';
import {
  getPerDrugRecommendations,
  detectAceiPresence,
  isArniBeingConsidered,
} from '@/lib/titration/engine';
import type { VitalSigns } from '@/lib/titration/types';

const NORMAL_VITALS: VitalSigns = { sbp: 120, hr: 70, potassium: 4.0, creatinine: 1.0 };

// ==========================================================================
// TITR-01: Per-Drug-Class Titration Recommendations
// Source: HEARTLAND Protocol v3.3 Module 3
// ==========================================================================
describe('getPerDrugRecommendations', () => {
  it('K+ 5.8 -> MRA=hold, ARNI=hold, Beta-blocker=uptitrate, SGLT2i=uptitrate', () => {
    const recs = getPerDrugRecommendations(
      { ...NORMAL_VITALS, potassium: 5.8 },
      ['MRA', 'ARNI', 'Beta-blocker', 'SGLT2i'],
    );
    const mra = recs.find((r) => r.drugClass === 'MRA');
    const arni = recs.find((r) => r.drugClass === 'ARNI');
    const bb = recs.find((r) => r.drugClass === 'Beta-blocker');
    const sglt2 = recs.find((r) => r.drugClass === 'SGLT2i');

    expect(mra!.action).toBe('hold');
    expect(arni!.action).toBe('hold');
    expect(bb!.action).toBe('uptitrate');
    expect(sglt2!.action).toBe('uptitrate');
  });

  it('HR 45 -> Beta-blocker=reduce, MRA=uptitrate', () => {
    const recs = getPerDrugRecommendations(
      { ...NORMAL_VITALS, hr: 45 },
      ['Beta-blocker', 'MRA'],
    );
    const bb = recs.find((r) => r.drugClass === 'Beta-blocker');
    const mra = recs.find((r) => r.drugClass === 'MRA');

    expect(bb!.action).toBe('reduce');
    expect(mra!.action).toBe('uptitrate');
  });

  it('SBP 85 -> ARNI=reduce, Beta-blocker=uptitrate (SBP only blocks ARNI)', () => {
    const recs = getPerDrugRecommendations(
      { ...NORMAL_VITALS, sbp: 85 },
      ['ARNI', 'Beta-blocker'],
    );
    const arni = recs.find((r) => r.drugClass === 'ARNI');
    const bb = recs.find((r) => r.drugClass === 'Beta-blocker');

    expect(arni!.action).toBe('reduce');
    expect(bb!.action).toBe('uptitrate');
  });

  it('eGFR 28 -> MRA=hold (eGFR <=30), SGLT2i=uptitrate (eGFR >20)', () => {
    const recs = getPerDrugRecommendations(
      { ...NORMAL_VITALS, egfr: 28 } as VitalSigns,
      ['MRA', 'SGLT2i'],
    );
    const mra = recs.find((r) => r.drugClass === 'MRA');
    const sglt2 = recs.find((r) => r.drugClass === 'SGLT2i');

    expect(mra!.action).toBe('hold');
    expect(mra!.safetyGateFailed).toBe('eGFR');
    expect(sglt2!.action).toBe('uptitrate');
  });

  it('eGFR 18 -> MRA=hold, SGLT2i=hold', () => {
    const recs = getPerDrugRecommendations(
      { ...NORMAL_VITALS, egfr: 18 } as VitalSigns,
      ['MRA', 'SGLT2i'],
    );
    const mra = recs.find((r) => r.drugClass === 'MRA');
    const sglt2 = recs.find((r) => r.drugClass === 'SGLT2i');

    expect(mra!.action).toBe('hold');
    expect(sglt2!.action).toBe('hold');
  });

  it('egfr undefined -> both MRA and SGLT2i uptitrate (no eGFR gate fires)', () => {
    const recs = getPerDrugRecommendations(
      { ...NORMAL_VITALS },
      ['MRA', 'SGLT2i'],
    );
    const mra = recs.find((r) => r.drugClass === 'MRA');
    const sglt2 = recs.find((r) => r.drugClass === 'SGLT2i');

    expect(mra!.action).toBe('uptitrate');
    expect(sglt2!.action).toBe('uptitrate');
  });
});

// ==========================================================================
// TITR-02: ACEi Detection and ARNI Consideration
// ==========================================================================
describe('detectAceiPresence / isArniBeingConsidered', () => {
  it('detectAceiPresence returns true for lisinopril + carvedilol list', () => {
    expect(detectAceiPresence(['Lisinopril 10mg', 'Carvedilol 6.25mg'])).toBe(true);
  });

  it('detectAceiPresence returns false for carvedilol + spironolactone list', () => {
    expect(detectAceiPresence(['Carvedilol 6.25mg', 'Spironolactone 25mg'])).toBe(false);
  });

  it('detectAceiPresence returns true for enalapril', () => {
    expect(detectAceiPresence(['Enalapril 5mg'])).toBe(true);
  });

  it('detectAceiPresence returns true for ramipril', () => {
    expect(detectAceiPresence(['Ramipril 2.5mg'])).toBe(true);
  });

  it('isArniBeingConsidered returns true when ARNI in list', () => {
    expect(isArniBeingConsidered(['ARNI', 'Beta-blocker'])).toBe(true);
  });

  it('isArniBeingConsidered returns false when ARNI not in list', () => {
    expect(isArniBeingConsidered(['Beta-blocker', 'MRA'])).toBe(false);
  });
});
