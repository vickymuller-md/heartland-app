import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../..', relativePath), 'utf8');
}

const authorization = read('lib/auth/authorization.ts');
const migration = read('supabase/migrations/00025_authorization_audit_hardening.sql');
const roleHotfix = read('supabase/migrations/00029_restore_authoritative_role_lookup.sql');
const publicSurfaceHardening = read('supabase/migrations/00030_reduce_public_database_surface.sql');
const alertCron = read('app/api/alert-scan/route.ts');
const healthCron = read('app/api/health/route.ts');
const dischargeAction = read('lib/discharge/actions.ts');

describe('Authoritative application authorization', () => {
  it('verifies identity and reads role from profiles, never user metadata', () => {
    expect(authorization).toContain('supabase.auth.getUser()');
    expect(authorization).toContain('.from("profiles")');
    expect(authorization).toContain('.select("role")');
    expect(authorization).not.toContain('user_metadata');
    expect(authorization).not.toContain('app_metadata');
  });

  it('fails closed without the fixed current registration consent', () => {
    expect(authorization).toContain('.from("consents")');
    expect(authorization).toContain('.eq("consent_type", "registration")');
    expect(authorization).toContain('.eq("consent_version", "v1.0")');
    expect(authorization).toContain('error: "Consent required"');
  });

  it('requires an active provider-patient relationship for patient-scoped work', () => {
    expect(authorization).toContain('authorizeProviderForPatient');
    expect(authorization).toContain('.eq("provider_id", auth.user.id)');
    expect(authorization).toContain('.eq("patient_id", patientId)');
    expect(authorization).toContain('.eq("status", "active")');
  });

  it('keeps database roles authoritative when the optional Auth Hook is absent', () => {
    expect(roleHotfix).toContain('FROM (SELECT (SELECT auth.uid()) AS user_id)');
    expect(roleHotfix).toContain('LEFT JOIN public.profiles AS profile');
    expect(roleHotfix).toContain("('provider', 'patient', 'tester')");
    expect(roleHotfix).not.toContain('user_metadata');
    expect(roleHotfix).not.toContain('auth.jwt()');
  });
});

describe('Database hardening', () => {
  it('removes anonymous application-table and trigger-function access', () => {
    expect(publicSurfaceHardening).toContain('FROM anon;');
    expect(publicSurfaceHardening).toContain('public.vitals');
    expect(publicSurfaceHardening).toContain('public.profiles');
    expect(publicSurfaceHardening).toContain("'handle_new_user'");
    expect(publicSurfaceHardening).toContain("'notify_vitals_insert'");
    expect(publicSurfaceHardening).toContain(
      'FROM PUBLIC, anon, authenticated',
    );
  });

  it('fixes the Auth Hook search path and preserves only its service caller', () => {
    expect(publicSurfaceHardening).toContain(
      "ALTER FUNCTION public.custom_access_token_hook(jsonb)\n  SET search_path = '';",
    );
    expect(publicSurfaceHardening).toContain('TO supabase_auth_admin;');
  });

  it.each([
    'patients',
    'vitals',
    'symptoms',
    'medications',
    'medication_logs',
    'alerts',
    'provider_notes',
    'lab_results',
    'discharge_records',
    'discharge_followups',
    'provider_messages',
    'quality_metric_records',
  ])('revokes broad mutations on %s', (table) => {
    expect(migration).toMatch(
      new RegExp(`REVOKE INSERT, UPDATE, DELETE ON TABLE public\\.${table}`),
    );
  });

  it('makes clinical observations append-only to authenticated clients', () => {
    const observationSection = migration.slice(
      migration.indexOf('-- 5. Append-only observations and symptoms'),
      migration.indexOf('-- 6. Medication, adherence, reminders, and education'),
    );
    expect(observationSection).not.toContain('GRANT UPDATE');
    expect(observationSection).toContain('GRANT INSERT (\n  patient_id, recorded_at');
  });

  it('protects public access-request review state', () => {
    expect(migration).toContain("status = 'pending'");
    expect(migration).toContain('reviewed_at IS NULL');
    expect(migration).toContain('reviewed_by IS NULL');
    expect(migration).toContain(
      'GRANT INSERT (full_name, email, npi, state, facility, role_claim, message)',
    );
  });

  it('enforces alert state transitions and server-owned attribution', () => {
    expect(migration).toContain('GRANT UPDATE (status) ON public.alerts');
    expect(migration).toContain('OLD.status = \'open\' AND NEW.status = \'acknowledged\'');
    expect(migration).toContain("OLD.status IN ('open', 'acknowledged') AND NEW.status = 'resolved'");
    expect(migration).toContain('NEW.acknowledged_by := actor');
    expect(migration).toContain('NEW.resolved_by := actor');
  });

  it('adds database constraints for direct-API validation bypasses', () => {
    expect(migration).toContain('CONSTRAINT vitals_clinical_ranges');
    expect(migration).toContain('CONSTRAINT lab_results_clinical_ranges');
    expect(migration).toContain('CONSTRAINT quality_metric_values_valid');
    expect(migration).toContain('CONSTRAINT provider_messages_content_length');
  });
});

describe('Metadata-only append-only audit', () => {
  it('stores actor, operation, resource, and relationship IDs without row payload', () => {
    const tableDefinition = migration.match(
      /CREATE TABLE public\.audit_events \([\s\S]*?\n\);/,
    )?.[0] ?? '';
    expect(tableDefinition).toContain('actor_id');
    expect(tableDefinition).toContain('resource_id');
    expect(tableDefinition).toContain('patient_id');
    expect(tableDefinition).not.toContain('payload');
    expect(tableDefinition).not.toContain('row_data');
  });

  it('rejects updates/deletes and gives clients no direct table privileges', () => {
    expect(migration).toContain('audit events are append-only');
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON public.audit_events');
    expect(migration).toContain(
      'REVOKE ALL ON TABLE public.audit_events FROM PUBLIC, anon, authenticated',
    );
  });

  it('audits the critical clinical and administrative tables', () => {
    for (const table of ['profiles', 'provider_patient_links', 'vitals', 'alerts', 'consents']) {
      expect(migration).toContain(`'${table}'`);
    }
    expect(migration).toContain('AFTER INSERT OR UPDATE OR DELETE');
  });
});

describe('Operational security', () => {
  it('uses constant-time bearer comparison for both cron endpoints', () => {
    expect(alertCron).toContain('timingSafeEqual');
    expect(healthCron).toContain('timingSafeEqual');
    expect(alertCron).not.toContain('authHeader !==');
    expect(healthCron).not.toContain('authHeader !==');
  });

  it('creates discharge + five follow-ups in one database transaction', () => {
    expect(dischargeAction).toContain(".rpc('create_discharge_with_followups'");
    expect(migration).toContain('jsonb_array_length(p_followups) <> 5');
    expect(migration).toContain('count(DISTINCT followup ->> \'type\')');
  });

  it('does not expose database error objects from cron failures', () => {
    expect(alertCron).not.toContain("console.error('[alert-scan] Error:', error)");
    expect(healthCron).not.toContain('error.message');
  });
});
