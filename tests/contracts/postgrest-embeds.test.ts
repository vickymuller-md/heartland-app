// @vitest-environment node
/**
 * PostgREST embed contract.
 *
 * Migrations 00037/00038 added tables that reference both `patients` and `profiles`,
 * which made every unhinted `profiles(...)` embed from `patients` ambiguous (PGRST201)
 * and broke the provider workspace in production on 2026-09-17. This contract runs
 * the exact embed shapes the App uses against a real PostgREST endpoint, so a future
 * migration that adds another patients/profiles junction fails here, not in production.
 *
 * Opt-in: needs HEARTLAND_REST_CONTRACT=1 plus NEXT_PUBLIC_SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY (read from the environment or .env.local). Read-only.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { labCollectionMicros } from '@/lib/labs/quality';

function loadEnvLocal(): Record<string, string> {
  try {
    const text = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
    const out: Record<string, string> = {};
    for (const line of text.split('\n')) {
      const match = /^([A-Z0-9_]+)=["']?([^"'\n]*)["']?$/.exec(line.trim());
      if (match) out[match[1]] = match[2];
    }
    return out;
  } catch {
    return {};
  }
}

const env = { ...loadEnvLocal(), ...process.env };
const enabled = env.HEARTLAND_REST_CONTRACT === '1' && !!env.NEXT_PUBLIC_SUPABASE_URL && !!env.SUPABASE_SERVICE_ROLE_KEY;

// Every embed the App issues that a new migration could make ambiguous, with its hint.
// The last entry is deliberately unhinted: it is the one embed still shipping that way, so
// this case is what fails first if a migration ever adds a second path between those tables.
const EMBEDS: Array<{ table: string; select: string; used_by: string }> = [
  { table: 'patients', select: 'id,profiles!patients_id_fkey(full_name)', used_by: 'lib/dashboard/queries.ts, worklist-queries.ts, metrics-queries.ts' },
  { table: 'alerts', select: 'id,patients!inner(profiles!patients_id_fkey(full_name))', used_by: 'lib/dashboard/queries.ts alerts list' },
  { table: 'work_items', select: 'id,patients!work_items_patient_id_fkey(profiles!patients_id_fkey(full_name)),assignee:profiles!work_items_assigned_to_fkey(full_name)', used_by: 'lib/daily-loop/queries.ts' },
  { table: 'work_items', select: 'id,recipient:profiles!work_items_transfer_pending_to_fkey(full_name),offered_by:profiles!work_items_transfer_offered_by_fkey(full_name)', used_by: 'lib/daily-loop/queries.ts — 00041 adds three more work_items→profiles paths, so these embeds must stay hinted' },
  { table: 'provider_messages', select: 'id,patients!provider_messages_patient_id_fkey(profiles!patients_id_fkey(full_name))', used_by: 'lib/inbox/queries.ts' },
  { table: 'organization_memberships', select: 'id,organizations(timezone)', used_by: 'lib/daily-loop/queries.ts:90 — unhinted, resolves only while organization_memberships has exactly one relationship to organizations' },
];

async function rest(table: string, select: string) {
  const url = `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}&limit=1`;
  const response = await fetch(url, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY!, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
  });
  const body = await response.json();
  return { status: response.status, body };
}

describe.skipIf(!enabled)('PostgREST embeds between patients and profiles', () => {
  for (const embed of EMBEDS) {
    it(`${embed.table}: ${embed.select} resolves (${embed.used_by})`, async () => {
      const { status, body } = await rest(embed.table, embed.select);
      expect(status, JSON.stringify(body)).toBe(200);
      expect(Array.isArray(body)).toBe(true);
    });
  }

  it('documents that the unhinted embed is ambiguous, so hints are not optional', async () => {
    const { status, body } = await rest('patients', 'id,profiles(full_name)');
    expect(status).toBe(300);
    expect(body.code).toBe('PGRST201');
  });
});

// This consumer is authenticated, not service-role. A service-role embed alone
// cannot verify its column privileges or RLS. Supply a real AAL2 synthetic session
// and a known saved lab; the contract performs no writes or account creation.
const historyEnabled = env.HEARTLAND_REST_CONTRACT === '1'
  && !!env.NEXT_PUBLIC_SUPABASE_URL && !!env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  && !!env.HEARTLAND_REST_AUTH_ACCESS_TOKEN && !!env.HEARTLAND_REST_LAB_ID
  && !!env.HEARTLAND_REST_PATIENT_ID && !!env.HEARTLAND_REST_LAB_COLLECTION;

describe.skipIf(!historyEnabled)('authenticated laboratory history embed', () => {
  it('returns the exact saved lab and original collection through the provider session', async () => {
    // This is a credential-type check, not JWT authentication. PostgREST verifies
    // the signature and current RLS; do not substitute a privileged service key.
    const claims = JSON.parse(Buffer.from(env.HEARTLAND_REST_AUTH_ACCESS_TOKEN!.split('.')[1], 'base64url').toString());
    expect(claims.role).toBe('authenticated');
    expect(claims.aal).toBe('aal2');
    expect(claims.user_role).toBe('provider');
    const query = new URLSearchParams({
      select: 'id,lab_result_id,patient_id,status,attempt_count,source_assessment,lab_results!lab_alert_evaluations_lab_result_id_fkey(collected_at)',
      lab_result_id: `eq.${env.HEARTLAND_REST_LAB_ID}`, patient_id: `eq.${env.HEARTLAND_REST_PATIENT_ID}`, limit: '2',
    });
    const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/lab_alert_evaluations?${query}`, {
      headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, Authorization: `Bearer ${env.HEARTLAND_REST_AUTH_ACCESS_TOKEN}` },
    });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].lab_result_id).toBe(env.HEARTLAND_REST_LAB_ID);
    expect(body[0].patient_id).toBe(env.HEARTLAND_REST_PATIENT_ID);
    const actualCollection = labCollectionMicros(body[0].lab_results.collected_at);
    const expectedCollection = labCollectionMicros(env.HEARTLAND_REST_LAB_COLLECTION!);
    expect(actualCollection).not.toBeNull();
    expect(expectedCollection).not.toBeNull();
    expect(actualCollection).toBe(expectedCollection);
  });
});
