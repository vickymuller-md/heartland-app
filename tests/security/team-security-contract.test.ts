import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const read = (relative: string) => fs.readFileSync(path.resolve(__dirname, '../..', relative), 'utf8');

describe('Governed team and MFA security contracts', () => {
  const migration = read('supabase/migrations/00027_team_security_operations.sql');
  const authorization = read('lib/auth/authorization.ts');
  const proxy = read('lib/supabase/proxy.ts');
  const accessRequest = read('app/actions/request-access.ts');

  it('requires provider AAL2 in application authorization and RLS', () => {
    expect(authorization).toContain('getAuthenticatorAssuranceLevel');
    expect(authorization).toContain('currentLevel !== "aal2"');
    expect(proxy).toContain('claims.aal !== "aal2"');
    expect(migration).toContain("auth.jwt() ->> 'aal'");
    expect(migration).toContain('public.provider_aal2()');
  });

  it('makes team grants governed and non-self-service', () => {
    expect(migration).toContain('CREATE TABLE public.organization_memberships');
    expect(migration).toContain('REVOKE ALL ON TABLE public.organization_memberships');
    expect(migration).not.toContain('GRANT INSERT ON TABLE public.organization_memberships TO authenticated');
    expect(migration).toContain('only a team manager can reassign work');
  });

  it('records delivery evidence without claiming device delivery', () => {
    expect(migration).toContain('CREATE TABLE public.notification_deliveries');
    expect(migration).toContain("channel = 'in_app'");
    expect(migration).toContain("state IN ('available', 'read', 'failed', 'superseded')");
  });

  it('removes direct anonymous access-request inserts and uses server-only throttling', () => {
    expect(migration).toContain('REVOKE INSERT ON TABLE public.access_requests FROM PUBLIC, anon, authenticated');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.submit_access_request');
    expect(migration).toContain('TO service_role');
    expect(accessRequest).toContain('createHmac');
    expect(accessRequest).toContain('supabaseAdmin.rpc("submit_access_request"');
  });

  it('makes patient linkage atomic, rate-limited, and non-direct', () => {
    expect(migration).toContain('CREATE TABLE public.linkage_lookup_rate_limits');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.request_provider_linkage');
    expect(migration).toContain(
      'DROP POLICY IF EXISTS "patients_insert_linkage_requests" ON public.provider_patient_links',
    );
  });

  it('validates every formerly NOT VALID clinical constraint', () => {
    for (const name of [
      'vitals_clinical_ranges',
      'lab_results_clinical_ranges',
      'patients_setup_steps_range',
      'patients_comorbidities_limit',
      'provider_notes_content_length',
      'provider_messages_content_length',
      'discharge_notes_length',
      'discharge_contact_notes_length',
      'quality_metric_values_valid',
    ]) {
      expect(migration).toContain(`VALIDATE CONSTRAINT ${name}`);
    }
  });
});
