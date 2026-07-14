import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(
  path.resolve(__dirname, '../../lib/actions/linkage.ts'),
  'utf8',
);

describe('Patient Linkage Request (AUTH-06)', () => {
  it('requires a consent-gated patient identity', () => {
    expect(source).toContain('authorize("patient")');
  });

  it('normalizes and strictly validates provider codes', () => {
    expect(source).toContain('rawCode.toUpperCase().trim()');
    expect(source).toContain('^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$');
  });

  it('uses the minimum-disclosure provider lookup RPC', () => {
    expect(source).toContain('.rpc("lookup_provider_by_code", { p_code: code })');
    expect(source).not.toContain('.eq("provider_code", code)');
  });

  it('binds a pending request to the authenticated patient', () => {
    expect(source).toContain('patient_id: auth.user.id');
    expect(source).toContain('status: "pending"');
  });

  it('does not expose database errors', () => {
    expect(source).not.toContain('error.message');
    expect(source).toContain('Unable to request linkage');
  });
});
