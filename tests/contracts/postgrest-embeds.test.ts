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
