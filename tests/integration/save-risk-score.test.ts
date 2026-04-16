// INTG-01: Risk calculator result saved to patient profile
// Imports will fail RED until lib/integration/actions.ts exists
import { describe, it, expect } from 'vitest';

describe('saveRiskScore (INTG-01)', () => {
  it('exports saveRiskScore function from lib/integration/actions', async () => {
    const mod = await import('@/lib/integration/actions');
    expect(mod.saveRiskScore).toBeDefined();
    expect(typeof mod.saveRiskScore).toBe('function');
  });

  it.todo('saves score, tier, and risk_scored_at to patients table via upsert -- INTEGRATION');
  it.todo('returns { success: false } when patient not linked to provider (RLS blocks) -- INTEGRATION');
  it.todo('revalidates /patients/[id] and /dashboard paths on success -- INTEGRATION');
  it.todo('returns { success: false, error: "Validation failed" } for score outside 0-18 -- INTEGRATION');
});
