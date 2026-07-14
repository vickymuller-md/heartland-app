import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(
  path.resolve(__dirname, '../../lib/actions/invite.ts'),
  'utf8',
);

describe('Provider Invite Flow (AUTH-05)', () => {
  it('requires the central provider authorization guard', () => {
    expect(source).toContain('authorize("provider")');
  });

  it('normalizes and validates the email before any mutation', () => {
    expect(source).toContain('.trim().toLowerCase().email().max(320)');
    expect(source.indexOf('emailSchema.safeParse')).toBeLessThan(
      source.indexOf('.from("provider_patient_links")'),
    );
  });

  it('creates the invitation through the caller-scoped RLS client', () => {
    expect(source).toContain('auth.supabase');
    expect(source).toContain('status: "invited"');
    expect(source).not.toContain('supabaseAdmin\n    .from("provider_patient_links")\n    .insert');
  });

  it('never writes an authorization role into user metadata', () => {
    expect(source).not.toContain('role: "patient"');
    expect(source).not.toContain('invited_by_provider');
    expect(source).not.toContain('invited_by_name');
  });

  it('routes invited users through explicit consent, then password setup', () => {
    expect(source).toContain('/consent?invited=1');
    expect(source).not.toContain('/register?invite_provider=');
  });

  it('removes the pending link when email delivery fails and hides raw errors', () => {
    expect(source).toContain('.delete()');
    expect(source).toContain('Unable to send invitation');
    expect(source).not.toContain('error.message');
  });
});
