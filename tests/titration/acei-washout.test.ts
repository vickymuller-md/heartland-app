import { describe, it, expect } from 'vitest';
import { checkAceiArniWashout, ACEI_ARNI_WASHOUT_HOURS } from '@/lib/titration/acei';

// SAFE-07 composed behavior: with ACEi on the list and ARNI under consideration,
// the provider must see the 36-hour washout warning (PARADIGM-HF / ACC/AHA 2022).
// Existing primitive tests cover the single-drug detectors; this file asserts
// the combined warning contract.

describe('checkAceiArniWashout', () => {
  it('warns when patient is on lisinopril and ARNI is being considered', () => {
    const status = checkAceiArniWashout({
      medications: [{ name: 'Lisinopril 10mg' }, { name: 'Carvedilol 12.5mg' }],
      arniBeingConsidered: true,
    });
    expect(status.showWarning).toBe(true);
    expect(status.message).toMatch(/36h/);
    expect(status.message).toMatch(/angioedema/i);
  });

  it('warns when both ACEi and ARNI are present in the current med list', () => {
    // Edge case: both drugs already listed (misprescription or mid-switch).
    const status = checkAceiArniWashout({
      medications: [
        { name: 'Ramipril 5mg' },
        { name: 'Entresto 49/51mg' },
      ],
      arniBeingConsidered: false,
    });
    expect(status.showWarning).toBe(true);
  });

  it('does not warn when patient is on ACEi but ARNI is NOT being considered', () => {
    const status = checkAceiArniWashout({
      medications: [{ name: 'Enalapril 5mg' }],
      arniBeingConsidered: false,
    });
    expect(status.showWarning).toBe(false);
  });

  it('does not warn when patient has no ACEi and ARNI is being considered', () => {
    const status = checkAceiArniWashout({
      medications: [{ name: 'Carvedilol 25mg' }, { name: 'Spironolactone 25mg' }],
      arniBeingConsidered: true,
    });
    expect(status.showWarning).toBe(false);
  });

  it('is case-insensitive across brand and generic names', () => {
    const status = checkAceiArniWashout({
      medications: [{ name: 'LISINOPRIL 20MG TAB' }],
      arniBeingConsidered: true,
    });
    expect(status.showWarning).toBe(true);
  });

  it('exports the washout period for UI display', () => {
    expect(ACEI_ARNI_WASHOUT_HOURS).toBe(36);
  });
});
