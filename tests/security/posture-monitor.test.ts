import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const route = fs.readFileSync(path.join(root, 'app/api/security-monitor/route.ts'), 'utf8');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/00027_team_security_operations.sql'),
  'utf8',
);
const vercel = fs.readFileSync(path.join(root, 'vercel.json'), 'utf8');

describe('aggregate security posture monitor', () => {
  it('requires constant-time cron authorization and stores aggregate-only signals', () => {
    expect(route).toContain('timingSafeEqual');
    expect(route).toContain('CRON_SECRET');
    expect(route).toContain("from('security_posture_snapshots')");
    expect(route).not.toContain("from('patients')");
    expect(route).not.toContain('full_name');
  });

  it('keeps snapshots service-only and schedules daily collection', () => {
    expect(migration).toContain('CREATE TABLE public.security_posture_snapshots');
    expect(migration).toContain(
      'REVOKE ALL ON TABLE public.security_posture_snapshots FROM PUBLIC, anon, authenticated',
    );
    expect(vercel).toContain('/api/security-monitor');
  });
});
