import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/00036_atomic_sandbox_ai_rate_limits.sql'),
  'utf8',
);
const functionBody = migration.split('AS $$')[1]?.split('$$;')[0] ?? '';

describe('atomic sandbox AI rate-limit migration', () => {
  it('serializes each kind before reading any bucket', () => {
    const lock = functionBody.indexOf('pg_advisory_xact_lock');
    const firstBucketRead = functionBody.indexOf('INTO v_global_count');

    expect(lock).toBeGreaterThan(-1);
    expect(firstBucketRead).toBeGreaterThan(lock);
  });

  it('validates every bucket before any capacity increment', () => {
    const capGate = functionBody.indexOf('IF v_global_count >= v_global_cap');
    const bucketReads = [
      'INTO v_global_count',
      'INTO v_requester_count',
      'INTO v_session_count',
    ].map((token) => functionBody.indexOf(token));
    const increments = [...functionBody.matchAll(/INSERT INTO public\.public_sandbox_rate_limits/g)]
      .map((match) => match.index);
    const gateBlock = functionBody.slice(capGate, increments[0]);

    expect(capGate).toBeGreaterThan(-1);
    expect(bucketReads).toHaveLength(3);
    expect(bucketReads.every((index) => index > -1 && index < capGate)).toBe(true);
    expect(gateBlock).toContain('OR v_requester_count >= v_requester_cap');
    expect(gateBlock).toContain('OR v_session_count >= v_session_cap');
    expect(gateBlock).toContain('RETURN false');
    expect(increments).toHaveLength(3);
    expect(increments.every((index) => index > capGate)).toBe(true);
  });
});
