/**
 * The database stores track_assignment as 'A' | 'B' | 'hybrid'; the education
 * screens branch on 'track_a' | 'track_b'. Without this mapping every patient,
 * including 61 Track A patients in production, received Track B content.
 */
import { describe, it, expect } from 'vitest';
import { trackKeyFromAssignment } from '@/lib/education/types';

describe('trackKeyFromAssignment', () => {
  it('maps the stored Track A value to digital-track content', () => {
    expect(trackKeyFromAssignment('A')).toBe('track_a');
  });
  it('maps the stored Track B value to paper-track content', () => {
    expect(trackKeyFromAssignment('B')).toBe('track_b');
  });
  it('keeps hybrid as its own badge key (content falls back to Track B downstream)', () => {
    expect(trackKeyFromAssignment('hybrid')).toBe('hybrid');
  });
  it('defaults null and unknown values to Track B (RMON-06)', () => {
    expect(trackKeyFromAssignment(null)).toBe('track_b');
    expect(trackKeyFromAssignment(undefined)).toBe('track_b');
    expect(trackKeyFromAssignment('C')).toBe('track_b');
  });
  it('passes already-normalized keys through', () => {
    expect(trackKeyFromAssignment('track_a')).toBe('track_a');
  });
});
