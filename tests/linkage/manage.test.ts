import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(
  path.resolve(__dirname, '../../lib/actions/linkage.ts'),
  'utf8',
);

describe('Provider Linkage Management (AUTH-07)', () => {
  it('validates link IDs before issuing database queries', () => {
    expect(source.match(/z\.string\(\)\.uuid\(\)\.safeParse\(linkId\)/g)).toHaveLength(2);
  });

  it('requires the central provider guard for accept and reject', () => {
    expect(source.match(/authorize\("provider"\)/g)).toHaveLength(2);
  });

  it('binds both transitions to the authenticated provider and pending state', () => {
    expect(source.match(/\.eq\("provider_id", auth\.user\.id\)/g)).toHaveLength(2);
    expect(source.match(/\.eq\("status", "pending"\)/g)).toHaveLength(2);
  });

  it('checks affected rows so RLS cannot become a false success', () => {
    expect(source.match(/\.select\("id"\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(source.match(/!data \|\| data\.length === 0/g)).toHaveLength(2);
  });

  it('returns generic failures instead of raw database errors', () => {
    expect(source).not.toContain('error.message');
    expect(source).toContain('Unable to update linkage');
  });
});
