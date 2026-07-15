import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getSafeConfirmRedirect } from '@/lib/auth/redirects';

const proxySource = fs.readFileSync(
  path.resolve(__dirname, '../../lib/supabase/proxy.ts'),
  'utf-8',
);
const configSource = fs.readFileSync(
  path.resolve(__dirname, '../../supabase/config.toml'),
  'utf-8',
);

describe('Auth Callback Redirects', () => {
  it('allows only exact application-owned callback destinations', () => {
    expect(getSafeConfirmRedirect('/today')).toBe('/today');
    expect(getSafeConfirmRedirect('/dashboard')).toBe('/dashboard');
    expect(getSafeConfirmRedirect('/update-password')).toBe('/update-password');
    expect(getSafeConfirmRedirect('/sandbox')).toBe('/sandbox');
  });

  it.each([
    'https://evil.example',
    '//evil.example',
    '/today?next=https://evil.example',
    '/dashboard/anything',
    null,
  ])('rejects unsafe callback destination %s', (destination) => {
    expect(getSafeConfirmRedirect(destination)).toBe('/today');
  });
});

describe('Cross-Role Blocking (AUTH-09)', () => {
  it('classifies all provider clinical areas as provider-only', () => {
    for (const prefix of [
      '/dashboard', '/patients', '/alerts', '/invite', '/titration-worklist',
      '/discharge', '/comorbidity-manager', '/quality-metrics', '/reports',
    ]) {
      expect(proxySource).toContain(`"${prefix}"`);
    }
  });

  it('classifies all patient portal areas as patient-only', () => {
    for (const prefix of [
      '/today', '/medications', '/education', '/profile', '/history', '/link-provider',
    ]) {
      expect(proxySource).toContain(`"${prefix}"`);
    }
  });

  it('uses verified server-controlled claims and never user metadata', () => {
    expect(proxySource).toContain('supabase.auth.getClaims()');
    expect(proxySource).not.toContain('user_metadata');
  });

  it('routes tester accounts only to the synthetic sandbox without MFA', () => {
    expect(proxySource).toContain('role !== "tester"');
    expect(proxySource).toContain('SANDBOX_PREFIX');
    expect(proxySource).toMatch(/role === "provider" && claims\.aal !== "aal2"/);
    expect(proxySource).not.toMatch(/role === "tester" && claims\.aal/);
  });
});

describe('Session Persistence (AUTH-04)', () => {
  it('refreshes cookies through the SSR client and sets bounded local sessions', () => {
    expect(proxySource).toContain('setAll(cookiesToSet)');
    expect(configSource).toContain('timebox = "12h"');
    expect(configSource).toContain('inactivity_timeout = "30m"');
  });

  it('requires confirmation, secure password changes, and supports TOTP', () => {
    expect(configSource).toContain('enable_confirmations = true');
    expect(configSource).toContain('secure_password_change = true');
    expect(configSource).toMatch(/\[auth\.mfa\.totp\][\s\S]*enroll_enabled = true[\s\S]*verify_enabled = true/);
  });
});
