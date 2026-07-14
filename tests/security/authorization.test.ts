import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCreateClient } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}));

import { authorize, authorizeProviderForPatient } from '@/lib/auth/authorization';

interface ClientFixture {
  user?: Record<string, unknown> | null;
  authError?: Error | null;
  profile?: { role: string } | null;
  consent?: { id: string } | null;
  link?: { id: string } | null;
}

function query(response: unknown) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data: response, error: null }),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.limit.mockReturnValue(builder);
  return builder;
}

function makeClient(fixture: ClientFixture) {
  const tables: Record<string, ReturnType<typeof query>> = {
    profiles: query(fixture.profile ?? null),
    consents: query(fixture.consent ?? null),
    provider_patient_links: query(fixture.link ?? null),
  };

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: fixture.user ?? null },
        error: fixture.authError ?? null,
      }),
    },
    from: vi.fn((table: string) => tables[table]),
    tables,
  };
}

describe('central authorization guard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fails before querying data when identity is not verified', async () => {
    const client = makeClient({ user: null });
    mockCreateClient.mockResolvedValue(client);

    await expect(authorize('provider')).resolves.toEqual({
      authorized: false,
      error: 'Not authenticated',
    });
    expect(client.from).not.toHaveBeenCalled();
  });

  it('ignores a forged provider role in user metadata', async () => {
    const client = makeClient({
      user: { id: 'user-1', user_metadata: { role: 'provider' } },
      profile: { role: 'patient' },
      consent: { id: 'consent-1' },
    });
    mockCreateClient.mockResolvedValue(client);

    await expect(authorize('provider')).resolves.toEqual({
      authorized: false,
      error: 'Unauthorized',
    });
  });

  it('fails closed when current registration consent is absent', async () => {
    const client = makeClient({
      user: { id: 'provider-1' },
      profile: { role: 'provider' },
      consent: null,
    });
    mockCreateClient.mockResolvedValue(client);

    await expect(authorize('provider')).resolves.toEqual({
      authorized: false,
      error: 'Consent required',
    });
  });

  it('authorizes patient-scoped provider work only with an active link', async () => {
    const client = makeClient({
      user: { id: 'provider-1', email: 'provider@example.com' },
      profile: { role: 'provider' },
      consent: { id: 'consent-1' },
      link: { id: 'link-1' },
    });
    mockCreateClient.mockResolvedValue(client);

    const result = await authorizeProviderForPatient(
      '00000000-0000-4000-a000-000000000001',
    );
    expect(result).toMatchObject({ authorized: true, role: 'provider' });
    expect(client.tables.provider_patient_links.eq).toHaveBeenCalledWith(
      'status',
      'active',
    );
  });

  it('denies a provider without an active patient link', async () => {
    const client = makeClient({
      user: { id: 'provider-1' },
      profile: { role: 'provider' },
      consent: { id: 'consent-1' },
      link: null,
    });
    mockCreateClient.mockResolvedValue(client);

    await expect(
      authorizeProviderForPatient('00000000-0000-4000-a000-000000000001'),
    ).resolves.toEqual({
      authorized: false,
      error: 'Unauthorized',
    });
  });
});
