import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const registerForm = fs.readFileSync(
  path.resolve(__dirname, '../../components/auth/register-form.tsx'),
  'utf-8',
);
const securityMigration = fs.readFileSync(
  path.resolve(__dirname, '../../supabase/migrations/00024_security_stop_ship.sql'),
  'utf-8',
);
const hardeningMigration = fs.readFileSync(
  path.resolve(__dirname, '../../supabase/migrations/00025_authorization_audit_hardening.sql'),
  'utf-8',
);

describe('Informed Consent (AUTH-03)', () => {
  it('registration form opens a consent dialog before signup', () => {
    expect(registerForm).toContain('setConsentOpen(true)');
    expect(registerForm).toContain('<ConsentDialog');
  });

  it('only submits consent metadata after the dialog is accepted', () => {
    expect(registerForm).toContain('await doSignUp({ ...values, consent_accepted: true })');
    expect(registerForm).toContain('consent_accepted: "true"');
  });
});

describe('Consent Persistence (DBSC-06)', () => {
  it('signup trigger atomically records explicit self-service consent', () => {
    expect(securityMigration).toContain("COALESCE(NEW.raw_user_meta_data ->> 'consent_accepted', '') = 'true'");
    expect(securityMigration).toContain('INSERT INTO public.consents');
  });

  it('allows an administrative invite without falsely recording consent', () => {
    expect(securityMigration).not.toContain("RAISE EXCEPTION 'registration consent is required'");
    expect(securityMigration).toContain('INSERT INTO public.patients (id)');
  });

  it('uses a fixed version/type and a server-generated timestamp', () => {
    expect(securityMigration).toContain("VALUES (NEW.id, 'v1.0', 'registration', true, now())");
  });

  it('makes current registration consent unique and gates clinical access', () => {
    expect(hardeningMigration).toContain('consents_user_version_type_unique');
    expect(hardeningMigration).toContain('public.has_registration_consent()');
    expect(hardeningMigration).toContain("consent_version = 'v1.0'");
  });
});
