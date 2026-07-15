import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const actionSource = fs.readFileSync(
  path.resolve(__dirname, '../../lib/product-analytics/actions.ts'),
  'utf8',
);
const migration = fs.readFileSync(
  path.resolve(__dirname, '../../supabase/migrations/00031_public_sandbox_telemetry.sql'),
  'utf8',
);

describe('public sandbox telemetry boundary', () => {
  it('accepts only fixed sandbox events and hashes a rotating network bucket', () => {
    expect(actionSource).toContain("data.area !== 'sandbox'");
    expect(actionSource).toContain("'sandbox_view'");
    expect(actionSource).toContain("'sandbox_first_action'");
    expect(actionSource).toContain("'sandbox_task_completed'");
    expect(actionSource).toContain("'sandbox_returned'");
    expect(actionSource).toContain("createHmac('sha256', rateSecret)");
    expect(actionSource).toContain('dailyBucket');
    expect(actionSource).not.toContain('user-agent');
  });

  it('stores no raw address and exposes no anonymous database grant', () => {
    expect(migration).toContain('public_sandbox_rate_limits');
    expect(migration).toContain("requester_hash ~ '^[0-9a-f]{64}$'");
    expect(migration).not.toMatch(/\b(ip|email|cookie|user_agent)\s+(text|inet|varchar)/i);
    expect(migration).toContain('FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('FROM PUBLIC, anon, authenticated');
    expect(migration).toContain('TO service_role');
  });

  it('rate-limits writes and records only actorless synthetic events', () => {
    expect(migration).toContain('IF v_event_count > 120');
    expect(migration).toContain("p_event_id, NULL, 'tester', p_event_name, 'sandbox'");
    expect(migration).toContain("p_event_name NOT IN (");
    expect(migration).toContain("actor_id IS NULL");
    expect(migration).toContain("interval '48 hours'");
  });
});
