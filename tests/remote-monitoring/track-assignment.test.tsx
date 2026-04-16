import { describe, it, expect } from 'vitest';
import { assignTrack } from '@/lib/remote-monitoring/engine';
import type { TrackAssessment } from '@/lib/remote-monitoring/types';

// ==========================================================================
// RMON-01/02: Track Assignment Engine — All 8 Boolean Combinations
// Protocol v3.3 Module 5, Table 4
// ==========================================================================
describe('assignTrack pure function', () => {
  it('smartphone=true + apps=true + telephone=true -> Track A (Digital)', () => {
    const assessment: TrackAssessment = {
      smartphoneConnectivity: true,
      comfortableWithApps: true,
      reliableTelephone: true,
    };
    const result = assignTrack(assessment);
    expect(result.track).toBe('track-a');
    expect(result.label).toContain('Digital');
    expect(result.rationale).toBeTruthy();
  });

  it('smartphone=true + apps=true + telephone=false -> Track A (Digital)', () => {
    const assessment: TrackAssessment = {
      smartphoneConnectivity: true,
      comfortableWithApps: true,
      reliableTelephone: false,
    };
    const result = assignTrack(assessment);
    expect(result.track).toBe('track-a');
  });

  it('smartphone=true + apps=false + telephone=true -> Hybrid', () => {
    const assessment: TrackAssessment = {
      smartphoneConnectivity: true,
      comfortableWithApps: false,
      reliableTelephone: true,
    };
    const result = assignTrack(assessment);
    expect(result.track).toBe('hybrid');
    expect(result.label).toContain('Hybrid');
  });

  it('smartphone=true + apps=false + telephone=false -> Hybrid', () => {
    const assessment: TrackAssessment = {
      smartphoneConnectivity: true,
      comfortableWithApps: false,
      reliableTelephone: false,
    };
    const result = assignTrack(assessment);
    expect(result.track).toBe('hybrid');
  });

  it('smartphone=false + apps=false + telephone=true -> Track B (Analog)', () => {
    const assessment: TrackAssessment = {
      smartphoneConnectivity: false,
      comfortableWithApps: false,
      reliableTelephone: true,
    };
    const result = assignTrack(assessment);
    expect(result.track).toBe('track-b');
    expect(result.label).toContain('Analog');
  });

  it('smartphone=false + apps=true + telephone=true -> Track B (Analog)', () => {
    const assessment: TrackAssessment = {
      smartphoneConnectivity: false,
      comfortableWithApps: true,
      reliableTelephone: true,
    };
    const result = assignTrack(assessment);
    expect(result.track).toBe('track-b');
    expect(result.label).toContain('Analog');
  });

  it('smartphone=false + apps=false + telephone=false -> Track B (Analog) with CHW note', () => {
    const assessment: TrackAssessment = {
      smartphoneConnectivity: false,
      comfortableWithApps: false,
      reliableTelephone: false,
    };
    const result = assignTrack(assessment);
    expect(result.track).toBe('track-b');
    expect(result.rationale).toContain('CHW');
  });

  it('smartphone=false + apps=true + telephone=false -> Track B (Analog)', () => {
    const assessment: TrackAssessment = {
      smartphoneConnectivity: false,
      comfortableWithApps: true,
      reliableTelephone: false,
    };
    const result = assignTrack(assessment);
    expect(result.track).toBe('track-b');
    expect(result.rationale).toContain('CHW');
  });

  it('every combination returns a valid track and non-empty rationale', () => {
    const booleans = [true, false];
    for (const s of booleans) {
      for (const a of booleans) {
        for (const t of booleans) {
          const result = assignTrack({
            smartphoneConnectivity: s,
            comfortableWithApps: a,
            reliableTelephone: t,
          });
          expect(['track-a', 'track-b', 'hybrid']).toContain(result.track);
          expect(result.label).toBeTruthy();
          expect(result.rationale.length).toBeGreaterThan(0);
        }
      }
    }
  });
});
