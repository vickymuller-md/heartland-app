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
    expect(registerForm).toContain('Request verified access');
  });

  it('database trigger always creates a patient profile', () => {
    expect(securityMigration).toMatch(/VALUES\s*\(\s*NEW\.id,\s*'patient'/s);
    expect(securityMigration).not.toContain("NEW.raw_user_meta_data ->> 'role'");
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
