// INTG-03: Track assignment saved to patients.track_assignment
// Key: engine returns 'track-a'|'track-b'|'hybrid', DB expects 'A'|'B'|'hybrid'
import { describe, it, expect } from 'vitest';

// Pure function tests -- no Supabase mocking needed
import { TRACK_MAP } from '@/lib/integration/actions';

describe('saveTrackAssignment (INTG-03)', () => {
  it('maps track-a -> A before writing to patients.track_assignment', () => {
    expect(TRACK_MAP['track-a']).toBe('A');
  });

  it('maps track-b -> B before writing to patients.track_assignment', () => {
    expect(TRACK_MAP['track-b']).toBe('B');
  });

  it('passes hybrid through unchanged', () => {
    expect(TRACK_MAP['hybrid']).toBe('hybrid');
  });

  it('returns undefined for unknown track string (invalid)', () => {
    expect(TRACK_MAP['track-c']).toBeUndefined();
    expect(TRACK_MAP['unknown']).toBeUndefined();
  });

  it('has exactly 3 valid mappings', () => {
    expect(Object.keys(TRACK_MAP)).toHaveLength(3);
  });
});
