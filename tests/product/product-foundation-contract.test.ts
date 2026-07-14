import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const migration = fs.readFileSync(
  path.resolve(__dirname, '../../supabase/migrations/00026_daily_loop_product_foundation.sql'),
  'utf8',
);
const vitalsActions = fs.readFileSync(
  path.resolve(__dirname, '../../lib/vitals/actions.ts'),
  'utf8',
);

describe('Daily Loop database contract', () => {
  it('enables RLS and restricts work to an owning linked provider', () => {
    expect(migration).toContain('ALTER TABLE public.work_items ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('public.provider_has_patient(patient_id)');
    expect(migration).toContain('provider_id = (SELECT auth.uid())');
  });

  it('enforces legal state changes and a required close outcome', () => {
    expect(migration).toContain('invalid work item transition');
    expect(migration).toContain('closing requires an outcome');
    expect(migration).toContain('awaiting status requires a future due date');
  });

  it('keeps work-item events append-only and audit-covered', () => {
    expect(migration).toContain('work item events are append-only');
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON public.work_item_events');
    expect(migration).toContain('AFTER INSERT OR UPDATE OR DELETE ON public.work_items');
  });
});

describe('Privacy-safe adoption telemetry', () => {
  it('contains no patient or free-text payload columns', () => {
    const definition = migration.match(
      /CREATE TABLE public\.product_events \([\s\S]*?\n\);/,
    )?.[0] ?? '';
    expect(definition).toMatch(/event_name\s+text/);
    expect(definition).toMatch(/duration_ms\s+int/);
    expect(definition).not.toContain('patient_id');
    expect(definition).not.toContain('payload');
    expect(definition).not.toContain('metadata');
  });
});

describe('Immediate alert persistence contract', () => {
  it('persists mapped red flags after patient, provider, and batch submissions', () => {
    expect(vitalsActions).toContain('persistImmediateAlert');
    expect(vitalsActions.match(/await persistImmediateAlert\(/g)).toHaveLength(3);
    expect(vitalsActions).toContain(".from('alerts')");
    expect(vitalsActions).toContain('shouldDeduplicate');
  });

  it('fails visibly when alert delivery cannot be confirmed', () => {
    expect(vitalsActions).toContain('alert delivery could not be confirmed');
    expect(vitalsActions).toContain('operational alert delivery was not confirmed');
  });
});
