/**
 * Organization settings -- alert-response target removed from the surface.
 *
 * organizations.alert_sla_minutes has no consumer that enforces overdue
 * escalation or backup, so the form and the read-only card no longer show it.
 * The column stays and the server action still accepts the field when a form
 * sends it.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { OrganizationSettingsForm } from '@/app/(provider)/team/team-forms';
import type { OrganizationSettings } from '@/lib/team/types';

const { authorize, revalidatePath, update } = vi.hoisted(() => ({
  authorize: vi.fn(),
  revalidatePath: vi.fn(),
  update: vi.fn(),
}));

vi.mock('@/lib/auth/authorization', () => ({ authorize }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/product-analytics/actions', () => ({ trackProductEvent: vi.fn() }));

const organization: OrganizationSettings = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Rural Health Clinic',
  timezone: 'America/Denver',
  alert_sla_minutes: 60,
  downtime_contact: null,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('OrganizationSettingsForm', () => {
  it('does not render an alert-response target field', () => {
    render(<OrganizationSettingsForm organization={organization} />);

    expect(screen.queryByText(/alert-response target/i)).toBeNull();
    expect(document.querySelector('[name="alertSlaMinutes"]')).toBeNull();
    expect(document.querySelector('[name="name"]')).not.toBeNull();
    expect(document.querySelector('[name="timezone"]')).not.toBeNull();
    expect(document.querySelector('[name="downtimeContact"]')).not.toBeNull();
  });
});

describe('updateOrganizationSettings', () => {
  function mockSupabase() {
    const eq = vi.fn(() => ({ select: async () => ({ data: [{ id: organization.id }], error: null }) }));
    update.mockReturnValue({ eq });
    authorize.mockResolvedValue({
      authorized: true,
      supabase: { from: () => ({ update }) },
    });
  }

  it('saves without alertSlaMinutes and leaves the column untouched', async () => {
    mockSupabase();
    const { updateOrganizationSettings } = await import('@/lib/team/actions');

    const formData = new FormData();
    formData.set('organizationId', organization.id);
    formData.set('name', organization.name);
    formData.set('timezone', organization.timezone);
    formData.set('downtimeContact', '');

    const result = await updateOrganizationSettings(null, formData);

    expect(result).toEqual({ success: true });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0]).not.toHaveProperty('alert_sla_minutes');
  });

  it('still writes alertSlaMinutes when a form supplies it', async () => {
    mockSupabase();
    const { updateOrganizationSettings } = await import('@/lib/team/actions');

    const formData = new FormData();
    formData.set('organizationId', organization.id);
    formData.set('name', organization.name);
    formData.set('timezone', organization.timezone);
    formData.set('downtimeContact', '');
    formData.set('alertSlaMinutes', '45');

    const result = await updateOrganizationSettings(null, formData);

    expect(result).toEqual({ success: true });
    expect(update.mock.calls[0][0]).toMatchObject({ alert_sla_minutes: 45 });
  });
});
