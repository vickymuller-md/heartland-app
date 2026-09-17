import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PrintSection } from '@/app/(public)/gdmt-pathway/print-section';
import {
  LVEF_BOUNDARIES,
  HFREF_PATHWAY_LABEL,
  LVEF_GE_40_PATHWAY_LABEL,
} from '@/lib/gdmt/constants';

// ==========================================================================
// LVEF 40% boundary: which pathway carries the MRA and SGLT2i lines.
// The MRA/SGLT2i pathway was labeled "HFpEF (LVEF >=50%)" on the tabs and
// "HFpEF (LVEF >40%)" in print, so no patient between 40% and 49% reached
// finerenone even though that range is the core of its approved indication.
// Source: adjudication packet 2026-09-17, F2 option A; dossier
// O2_ADJUDICACAO_2 §2.4; KERENDIA label §1 (LVEF >= 40%);
// 2022 AHA/ACC/HFSA Table 4 (HFrEF <=40, HFmrEF 41-49, HFpEF >=50).
// ==========================================================================

describe('LVEF_BOUNDARIES', () => {
  it('declares the 2022 AHA/ACC/HFSA phenotype boundaries once', () => {
    expect(LVEF_BOUNDARIES.hfrefMax).toBe(40);
    expect(LVEF_BOUNDARIES.hfmrefMin).toBe(41);
    expect(LVEF_BOUNDARIES.hfmrefMax).toBe(49);
    expect(LVEF_BOUNDARIES.hfpefMin).toBe(50);
  });

  it('puts the MRA/SGLT2i pathway floor at the finerenone label boundary of 40', () => {
    expect(LVEF_BOUNDARIES.mraSglt2iPathwayMin).toBe(40);
  });
});

describe('pathway labels (below / equal / above 40%)', () => {
  it('LVEF 39% is covered by the HFrEF pathway label', () => {
    expect(39).toBeLessThanOrEqual(LVEF_BOUNDARIES.hfrefMax);
    expect(HFREF_PATHWAY_LABEL).toMatch(/<=40%/);
  });

  it('LVEF exactly 40% is inside the MRA/SGLT2i pathway', () => {
    expect(40).toBeGreaterThanOrEqual(LVEF_BOUNDARIES.mraSglt2iPathwayMin);
    expect(LVEF_GE_40_PATHWAY_LABEL).toMatch(/>=40%/);
  });

  it('LVEF 41-49% is named in the MRA/SGLT2i pathway label', () => {
    expect(LVEF_GE_40_PATHWAY_LABEL).toMatch(/HFmrEF 41-49%/);
    expect(LVEF_GE_40_PATHWAY_LABEL).toMatch(/HFpEF >=50%/);
  });

  it('the MRA/SGLT2i pathway is never labeled ">40%" or "HFpEF" alone', () => {
    expect(LVEF_GE_40_PATHWAY_LABEL).not.toMatch(/>40%/);
    expect(LVEF_GE_40_PATHWAY_LABEL.startsWith('HFpEF')).toBe(false);
  });
});

describe('the printed pathway uses the same boundary as the screen', () => {
  it('prints the LVEF >=40% heading instead of "HFpEF (LVEF >40%)"', () => {
    render(<PrintSection />);
    expect(screen.getByText(new RegExp(LVEF_GE_40_PATHWAY_LABEL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeInTheDocument();
    expect(screen.queryByText(/HFpEF \(LVEF >40%\)/)).not.toBeInTheDocument();
  });

  it('keeps the quadruple-therapy heading on the HFrEF pathway', () => {
    render(<PrintSection />);
    expect(screen.getByText(/Quadruple Therapy/)).toBeInTheDocument();
  });
});
