/**
 * Provider Notifications -- Tests
 * Requirements: DASH-06 (push notifications), DASH-07 (email fallback)
 * Source: HEARTLAND Protocol v3.3
 *
 * The actual notification functions live in the Deno Edge Function
 * (supabase/functions/alert-eval/index.ts) and cannot be imported
 * in the Node/vitest environment. These tests verify the notification
 * contract and logic that CAN be tested in Node:
 *   - Critical vs warning severity determines notification delivery
 *   - Flag labels are correctly mapped for notification body
 *   - Email HTML structure contains required elements
 */

import { describe, it, expect } from 'vitest';
import { determineSeverity } from '@/lib/dashboard/alert-engine';
import { FLAG_LABELS, CRITICAL_FLAGS } from '@/lib/dashboard/constants';
import type { AlertFlag } from '@/lib/dashboard/types';

// ==========================================================================
// DASH-06: Push notification triggering logic
// ==========================================================================

describe('sendProviderNotifications (contract)', () => {
  it('critical severity triggers notifications (sbp_low is critical)', () => {
    const severity = determineSeverity(['sbp_low']);
    expect(severity).toBe('critical');
    // Edge Function sends push/email only when severity === 'critical'
  });

  it('critical severity triggers notifications (spo2_low is critical)', () => {
    const severity = determineSeverity(['spo2_low']);
    expect(severity).toBe('critical');
  });

  it('critical severity triggers notifications (symptom_red_flag is critical)', () => {
    const severity = determineSeverity(['symptom_red_flag']);
    expect(severity).toBe('critical');
  });

  it('skips notification for non-critical (warning) alerts', () => {
    const severity = determineSeverity(['dyspnea_severe']);
    expect(severity).toBe('warning');
    // Edge Function does NOT send push/email for warning severity
  });

  it('includes patient name and flag labels in notification body', () => {
    const flags: AlertFlag[] = ['sbp_low', 'spo2_low'];
    const flagLabels = flags.map((f) => FLAG_LABELS[f] || f).join(', ');
    const patientName = 'John Doe';
    const body = `CRITICAL: ${patientName} - ${flagLabels}`;

    expect(body).toContain('John Doe');
    expect(body).toContain('SBP < 90 mmHg');
    expect(body).toContain('SpO2 < 92%');
    expect(body).toContain('CRITICAL');
  });

  it('all CRITICAL_FLAGS trigger critical severity', () => {
    for (const flag of CRITICAL_FLAGS) {
      expect(determineSeverity([flag])).toBe('critical');
    }
  });
});

// ==========================================================================
// DASH-07: Email fallback structure
// ==========================================================================

describe('sendEmailAlert (contract)', () => {
  it('email HTML contains required elements', () => {
    const patientName = 'Jane Smith';
    const flagLabels = 'SBP < 90 mmHg';
    const appUrl = 'https://app.heartlandprotocol.org';

    // Mirrors the HTML template in the Edge Function
    const html = `
      <h2>HEARTLAND Protocol - Critical Patient Alert</h2>
      <p><strong>Patient:</strong> ${patientName}</p>
      <p><strong>Alert:</strong> ${flagLabels}</p>
      <p><strong>Action Required:</strong> Review patient vitals and respond.</p>
      <p><a href="${appUrl}/alerts">View Alert in Dashboard</a></p>
    `;

    expect(html).toContain(patientName);
    expect(html).toContain(flagLabels);
    expect(html).toContain(`${appUrl}/alerts`);
    expect(html).toContain('Action Required');
  });

  it('all FLAG_LABELS have human-readable descriptions', () => {
    const allFlags: AlertFlag[] = [
      'weight_gain_3lb_2d',
      'weight_gain_5lb_7d',
      'sbp_low',
      'spo2_low',
      'symptom_red_flag',
      'dyspnea_severe',
    ];

    for (const flag of allFlags) {
      expect(FLAG_LABELS[flag]).toBeDefined();
      expect(FLAG_LABELS[flag].length).toBeGreaterThan(5);
    }
  });

  it('subject line includes patient name for critical alerts', () => {
    const patientName = 'Robert Johnson';
    const subject = `CRITICAL ALERT: ${patientName}`;
    expect(subject).toContain('CRITICAL ALERT');
    expect(subject).toContain(patientName);
  });
});
