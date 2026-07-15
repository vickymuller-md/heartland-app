import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { registerSchema, updatePasswordSchema } from '@/lib/schemas/auth';

const registerForm = fs.readFileSync(
  path.resolve(__dirname, '../../components/auth/register-form.tsx'),
  'utf-8',
);
const securityMigration = fs.readFileSync(
  path.resolve(__dirname, '../../supabase/migrations/00024_security_stop_ship.sql'),
  'utf-8',
);
const sandboxMigration = fs.readFileSync(
  path.resolve(__dirname, '../../supabase/migrations/00028_scale_sandbox_and_adoption.sql'),
  'utf-8',
);

const validRegistration = {
  email: 'patient@example.com',
  password: 'a secure phrase!',
  full_name: 'Test Patient',
  role: 'patient' as const,
  consent_accepted: true,
};

describe('Closed Provider Registration (AUTH-01)', () => {
  it('rejects provider as a public registration role', () => {
    expect(registerSchema.safeParse({ ...validRegistration, role: 'provider' }).success).toBe(false);
  });

  it('does not expose a provider role control or send role metadata', () => {
    expect(registerForm).not.toContain('value="provider"');
    expect(registerForm).not.toContain('role: data.role');
    expect(registerForm).toContain('Request verified provider access');
  });

  it('database trigger always creates a patient profile', () => {
    expect(securityMigration).toMatch(/VALUES\s*\(\s*NEW\.id,\s*'patient'/s);
    expect(securityMigration).not.toContain("NEW.raw_user_meta_data ->> 'role'");
  });
});

describe('Self-service sandbox tester', () => {
  it('accepts a tester registration but still rejects provider self-provisioning', () => {
    expect(registerSchema.safeParse({ ...validRegistration, role: 'tester' }).success).toBe(true);
    expect(registerSchema.safeParse({ ...validRegistration, role: 'provider' }).success).toBe(false);
  });

  it('uses a non-provider signup intent and a sandbox callback', () => {
    expect(registerForm).toContain('signup_intent = "sandbox"');
    expect(registerForm).toContain('"/sandbox"');
    expect(registerForm).not.toContain('signUpMetadata.role');
  });

  it('creates a tester without a patient row and gives it a 30-day retention limit', () => {
    expect(sandboxMigration).toContain("THEN 'tester'");
    expect(sandboxMigration).toContain("IF assigned_role = 'patient'");
    expect(sandboxMigration).toContain("now() + interval '30 days'");
    expect(sandboxMigration).not.toMatch(/assigned_role[^\n]*provider/);
  });
});

describe('Patient Registration (AUTH-02)', () => {
  it('accepts a patient with a 15-character password', () => {
    expect(registerSchema.safeParse(validRegistration).success).toBe(true);
  });

  it('rejects registration and password updates shorter than 15 characters', () => {
    expect(registerSchema.safeParse({ ...validRegistration, password: '12345678901234' }).success).toBe(false);
    expect(updatePasswordSchema.safeParse({
      password: '12345678901234',
      confirm_password: '12345678901234',
    }).success).toBe(false);
  });

  it('submits asserted consent and records it transactionally in the signup trigger', () => {
    expect(registerForm).toContain('consent_accepted: "true"');
    expect(securityMigration).toContain(
      "IF COALESCE(NEW.raw_user_meta_data ->> 'consent_accepted', '') = 'true' THEN",
    );
    expect(securityMigration).toMatch(/INSERT INTO public\.consents/s);
  });
});
