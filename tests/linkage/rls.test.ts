import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const migration = fs.readFileSync(
  path.resolve(__dirname, '../../supabase/migrations/00025_authorization_audit_hardening.sql'),
  'utf8',
);

describe('Linkage RLS Policies', () => {
  it('scopes provider reads to auth.uid and requires consent', () => {
    expect(migration).toMatch(
      /CREATE POLICY "providers_select_own_links"[\s\S]*public\.has_registration_consent\(\)[\s\S]*provider_id = \(SELECT auth\.uid\(\)\)/,
    );
  });

  it('scopes patient reads to auth.uid and requires consent', () => {
    expect(migration).toMatch(
      /CREATE POLICY "patients_select_own_links"[\s\S]*public\.has_registration_consent\(\)[\s\S]*patient_id = \(SELECT auth\.uid\(\)\)/,
    );
  });

  it('allows patients to create only pending self-link requests', () => {
    expect(migration).toMatch(
      /CREATE POLICY "patients_insert_linkage_requests"[\s\S]*patient_id = \(SELECT auth\.uid\(\)\)[\s\S]*status = 'pending'[\s\S]*invite_email IS NULL/,
    );
  });

  it('allows providers to review only their own pending links', () => {
    expect(migration).toMatch(
      /CREATE POLICY "providers_review_pending_links"[\s\S]*provider_id = \(SELECT auth\.uid\(\)\)[\s\S]*status = 'pending'/,
    );
  });

  it('blocks principal-column mutation and hard delete', () => {
    const linkSection = migration.slice(
      migration.indexOf('DROP POLICY IF EXISTS "providers_select_own_links"'),
      migration.indexOf('-- 5. Append-only observations and symptoms'),
    );
    expect(linkSection).toContain(
      'REVOKE INSERT, UPDATE, DELETE ON TABLE public.provider_patient_links',
    );
    expect(linkSection).not.toContain('GRANT UPDATE (provider_id');
  });
});
