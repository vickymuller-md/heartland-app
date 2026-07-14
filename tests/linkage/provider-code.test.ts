import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const generationMigration = fs.readFileSync(
  path.resolve(__dirname, '../../supabase/migrations/00002_provider_codes_and_invites.sql'),
  'utf8',
);
const hardeningMigration = fs.readFileSync(
  path.resolve(__dirname, '../../supabase/migrations/00025_authorization_audit_hardening.sql'),
  'utf8',
);

describe('Provider Code Generation and Disclosure', () => {
  it('generates six characters from the no-lookalike alphabet', () => {
    expect(generationMigration).toContain("chars text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'");
    expect(generationMigration).toContain('FOR i IN 1..6 LOOP');
  });

  it('enforces database uniqueness', () => {
    expect(generationMigration).toContain('provider_code text UNIQUE');
    expect(generationMigration).toContain('EXIT WHEN NOT EXISTS');
  });

  it('removes bulk provider-profile disclosure', () => {
    expect(hardeningMigration).toContain(
      'DROP POLICY IF EXISTS "patients_read_provider_codes" ON public.profiles',
    );
    expect(hardeningMigration).toContain('lookup_provider_by_code');
    expect(hardeningMigration).toContain('RETURNS TABLE (id uuid, full_name text)');
  });

  it('requires exact validated code and current consent', () => {
    expect(hardeningMigration).toContain("p_code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$'");
    expect(hardeningMigration).toContain('AND public.has_registration_consent()');
  });
});
