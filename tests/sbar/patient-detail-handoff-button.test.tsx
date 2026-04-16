/**
 * PatientDetailPage -- Generate Handoff Button Tests
 * Requirement: SBAR-05 (generate handoff button on patient detail)
 * Source: HEARTLAND Protocol v3.3 -- Phase 15 SBAR Handoff Generator
 *
 * File-content tests (fs.readFileSync pattern from Phase 11) since the
 * patient detail page is a Server Component that cannot be rendered in tests.
 */

import fs from 'fs';
import { describe, it, expect } from 'vitest';

const src = fs.readFileSync(
  'app/(provider)/patients/[patientId]/page.tsx',
  'utf8'
);

describe('PatientDetailPage -- Generate Handoff button', () => {
  it('contains Generate Handoff text', () => {
    expect(src).toContain('Generate Handoff');
  });

  it('contains link to /sbar route', () => {
    expect(src).toContain('/sbar');
  });
});
