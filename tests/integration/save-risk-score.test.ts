import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveRiskScore } from '@/lib/integration/actions';
import { RISK_VARIABLES } from '@/lib/risk-score/constants';
import { RISK_FRAMEWORK_VERSION } from '@/lib/risk-score/schema';

const { rpc, authorize, revalidate } = vi.hoisted(() => ({ rpc: vi.fn(), authorize: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/auth/authorization', () => ({ authorizeProviderForPatient: authorize }));
vi.mock('next/cache', () => ({ revalidatePath: revalidate }));
const actor = 'ffe00000-0000-4000-8000-000000000001';
const patient = 'ffe00000-0000-4000-8000-000000000002';
const request = 'ffe00000-0000-4000-8000-000000000003';
function form() {
  const data = new FormData();
  Object.entries({ actorId: actor, patientId: patient, requestId: request, version: RISK_FRAMEWORK_VERSION,
    inputs: JSON.stringify(Object.fromEntries(RISK_VARIABLES.map(v => [v.key, false]))),
  }).forEach(([k,v]) => data.set(k,v));
  return data;
}
describe('recording a risk assessment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorize.mockResolvedValue({ authorized: true, user: { id: actor }, supabase: { rpc } });
    rpc.mockResolvedValue({ data: request, error: null });
  });
  it('submits the factors and version and confirms the exact receipt', async () => {
    const data = form();
    data.set('score', '18');
    expect((await saveRiskScore(null, data)).success).toBe(true);
    expect(rpc).toHaveBeenCalledWith('record_risk_assessment', {
      p_expected_actor: actor, p_patient_id: patient, p_request_id: request,
      p_version: RISK_FRAMEWORK_VERSION, p_factors: JSON.parse(String(data.get('inputs'))),
    });
    expect(revalidate).toHaveBeenCalledWith('/dashboard');
  });
  it('requires ten explicit factors and the displayed version', async () => {
    const data = form();
    data.set('inputs', '{}');
    expect((await saveRiskScore(null, data)).success).toBe(false);
    const outdated = form();
    outdated.set('version', 'earlier');
    expect((await saveRiskScore(null, outdated)).success).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('checks the active provider and patient before writing', async () => {
    const data = form();
    data.set('actorId', patient);
    expect((await saveRiskScore(null, data)).success).toBe(false);
    authorize.mockResolvedValue({ authorized: false, error: 'Unauthorized' });
    expect((await saveRiskScore(null, form())).success).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('does not display success when the database did not confirm the operation', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect((await saveRiskScore(null, form())).success).toBe(false);
    expect(revalidate).not.toHaveBeenCalled();
  });
});
