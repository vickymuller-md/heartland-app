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
const scaleMigration = fs.readFileSync(
  path.resolve(__dirname, '../../supabase/migrations/00028_scale_sandbox_and_adoption.sql'),
  'utf8',
);
const receiptActions = fs.readFileSync(path.resolve(__dirname, '../../lib/vitals/submission-actions.ts'), 'utf8');
const receiptMigration = fs.readFileSync(path.resolve(__dirname, '../../supabase/migrations/00045_vitals_evaluation_recovery.sql'), 'utf8');

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
  it('routes every capture channel through durable evaluation', () => {
    expect(vitalsActions).not.toContain('persistImmediateAlert');
    expect(vitalsActions).toContain('return submitCapturedVitals(previous, formData)');
    expect(vitalsActions).toContain('return submitCapturedProviderVitals(previous, formData)');
    expect(vitalsActions).toContain('return submitCapturedVitalsBatch(previous, formData)');
    expect(receiptActions).toContain("rpc('finalize_vitals_submission_evaluation'");
    expect(receiptMigration).toContain('public.coalesce_patient_alert');
    expect(vitalsActions).not.toContain(".from('vitals').insert");
    expect(vitalsActions).not.toContain(".from('alerts').insert");
  });

  it('distinguishes saved observations from unconfirmed evaluation', () => {
    const receiptState = fs.readFileSync(path.resolve(__dirname, '../../lib/vitals/submission-receipt.ts'), 'utf8');
    expect(receiptState).toContain('Your record is saved. Evaluation is not confirmed');
    expect(receiptState).toContain('receipt.rule_version === expected');
  });
});

describe('Persistent alert coalescence', () => {
  it('coalesces by active patient signal and refreshes the canonical work item', () => {
    expect(scaleMigration).toContain('CREATE OR REPLACE FUNCTION public.coalesce_patient_alert');
    expect(scaleMigration).toContain('alert.flags && normalized_flags');
    expect(scaleMigration).toContain('pg_advisory_xact_lock');
    expect(scaleMigration).toContain('occurrence_count = public.alerts.occurrence_count + 1');
    expect(scaleMigration).toContain('refresh_coalesced_alert_work_item');
  });

  it('keeps coalescence server-only and consolidates legacy duplicates without deletion', () => {
    expect(scaleMigration).toMatch(/REVOKE ALL ON FUNCTION public\.coalesce_patient_alert[\s\S]*FROM PUBLIC, anon, authenticated/);
    expect(scaleMigration).toContain("SET status = 'resolved'");
    expect(scaleMigration).toContain('CREATE TABLE public.alert_consolidation_events');
    expect(scaleMigration).toContain('resolving an alert requires an outcome');
    expect(scaleMigration).not.toContain('DELETE FROM public.alerts');
  });
});
