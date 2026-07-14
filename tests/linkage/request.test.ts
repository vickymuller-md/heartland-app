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

  it('uses the atomic, rate-limited provider linkage RPC', () => {
    expect(source).toContain('.rpc("request_provider_linkage", { p_code: code })');
    expect(source).not.toContain('.eq("provider_code", code)');
  });

  it('does not create linkage rows directly from the application', () => {
    const requestSource = source.slice(0, source.indexOf('export async function acceptLinkage'));
    expect(requestSource).not.toContain('.from("provider_patient_links")');
    expect(requestSource).not.toContain('.insert({');
  });

  it('does not expose database errors', () => {
    expect(source).not.toContain('error.message');
    expect(source).toContain('Unable to request linkage');
  });
});
