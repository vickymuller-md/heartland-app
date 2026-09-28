import { z } from 'zod';

export const EXCEPTION_CATEGORIES = ['ownership', 'vitals', 'laboratory', 'scan_capture', 'scan_rule', 'scan_routing', 'notification', 'notification_routing'] as const;
export const EXCEPTION_LABELS: Record<(typeof EXCEPTION_CATEGORIES)[number], string> = {
  ownership: 'Responsibility', vitals: 'Vital-sign evaluation', laboratory: 'Laboratory evaluation',
  scan_capture: 'Scheduled capture', scan_rule: 'Scheduled evaluation', scan_routing: 'Scan episode review',
  notification: 'Notification transport records', notification_routing: 'Notification routing review',
};
export const EXCEPTION_REASONS = {
  patient_unassigned: 'Patient no longer assigned to this organization',
  legacy_owner: 'Legacy ownership needs individual reconciliation',
  unaccepted: 'Acceptance has not been recorded',
  inactive_member: 'Assigned member is no longer active',
  no_active_link: 'Assigned member no longer has an active patient link',
  no_monitor_authorization: 'Assigned member lacks current monitoring authorization',
  evaluation_pending: 'Evaluation remains pending',
  evaluation_failed: 'Evaluation could not be completed',
  capture_pending: 'Source capture remains pending',
  capture_failed: 'Source capture could not be completed',
  blocked_scope: 'Current access scope does not permit processing',
  missed_capture_window: 'Capture window ended before a snapshot was saved',
  rule_blocked: 'Saved inputs require technical review',
  needs_episode_adjudication: 'A new signal refers to closed work; human episode review is required',
  critical_created: 'Captured after creation of critical work',
  critical_escalated: 'Captured after work escalated to critical',
  critical_reassigned: 'Captured after critical work changed assignee',
  captured_inactive_org: 'At capture: organization was inactive',
  captured_inactive_member: 'At capture: assigned member was ineligible',
  captured_no_patient_scope: 'At capture: patient scope was unavailable',
  captured_no_active_link: 'At capture: assigned member had no active patient link',
  captured_no_monitor_authorization: 'At capture: assigned member lacked monitoring authorization',
  captured_blocked_preference: 'At capture: assigned member’s preference blocked transport',
  closed_work_later_signal: 'A later signal refers to closed work; human episode review remains required',
  critical_new_flag: 'An additional flag reached already-critical work; human routing review remains required',
  transport_pending: 'Transport has not started for the next destination',
  transport_sending: 'A transport attempt has started; its outcome is not confirmed',
  transport_accepted: 'The service accepted the request; delivery and reading are not confirmed',
  transport_unknown: 'The transport outcome is uncertain; automatic resend is blocked',
  transport_blocked: 'Transport requires authorized operational review',
  dispatch_authorization: 'Current recipient authorization does not permit transport',
  dispatch_preference: 'The assigned recipient’s notification preference blocks transport',
  dispatch_configuration: 'Transport configuration requires technical review',
  dispatch_rejection: 'The service rejected the request; automatic retry is disabled',
  dispatch_email_attempt_exists: 'An email attempt is already recorded; no automatic resend',
  dispatch_closed: 'The associated work is closed; no further transport is permitted',
  dispatch_resolved: 'The source signal is resolved; no further transport is permitted',
  dispatch_superseded_recipient: 'Responsibility changed; no further transport to the former recipient',
  dispatch_superseded_generation: 'This transport event has been superseded',
  dispatch_destination_limit: 'The complete destination set exceeds the controlled processing limit',
  dispatch_worker_lost_confirmation: 'The processor lost confirmation after start; no automatic resend',
} as const;

const notificationEvents = ['critical_created', 'critical_escalated', 'critical_reassigned'] as const;
const captureReasons = ['captured_inactive_org', 'captured_inactive_member', 'captured_no_patient_scope',
  'captured_no_active_link', 'captured_no_monitor_authorization', 'captured_blocked_preference'] as const;
const routingReasons = ['closed_work_later_signal', 'critical_new_flag'] as const;
const dispatchReasons = Object.keys(EXCEPTION_REASONS).filter((code) => code.startsWith('dispatch_'));
const transportStates = ['pending', 'sending', 'accepted', 'unknown', 'blocked'];
const reason = z.enum(Object.keys(EXCEPTION_REASONS) as [keyof typeof EXCEPTION_REASONS, ...(keyof typeof EXCEPTION_REASONS)[]]);
export const operationalExceptionSchema = z.object({
  key: z.string().min(1).max(200), category: z.enum(EXCEPTION_CATEGORIES),
  patient_id: z.uuid(), work_item_id: z.uuid().nullable(),
  state: z.enum(['pending', 'failed', 'blocked', 'needs_review', 'sending', 'accepted', 'unknown']),
  reasons: z.array(reason).min(1), recorded_at: z.string().min(1),
}).strict().refine((row) => {
  const events: readonly string[] = notificationEvents;
  const blocks: readonly string[] = captureReasons;
  const routing: readonly string[] = routingReasons;
  if (row.category === 'notification') {
    if (row.reasons[1]?.startsWith('transport_')) {
      return row.work_item_id !== null && row.key.startsWith('notification:') && events.includes(row.reasons[0])
        && transportStates.includes(row.state) && row.reasons[1] === `transport_${row.state}`
        && (row.reasons.length === 2 || (row.reasons.length === 3 && dispatchReasons.includes(row.reasons[2])))
        && (row.state !== 'blocked' || row.reasons.length === 3)
        && (!['pending', 'sending', 'accepted'].includes(row.state) || row.reasons.length === 2)
        && (row.state !== 'unknown' || row.reasons.length === 2 || row.reasons[2] === 'dispatch_worker_lost_confirmation');
    }
    return row.work_item_id !== null && row.key.startsWith('notification:')
      && events.includes(row.reasons[0])
      && ((row.state === 'pending' && row.reasons.length === 1)
        || (row.state === 'blocked' && row.reasons.length === 2 && blocks.includes(row.reasons[1])));
  }
  if (row.category === 'notification_routing') {
    return row.work_item_id !== null && row.key.startsWith('notification_routing:')
      && row.state === 'needs_review' && row.reasons.length === 1 && routing.includes(row.reasons[0]);
  }
  return !['sending', 'accepted', 'unknown'].includes(row.state)
    && row.reasons.every((code) => !events.includes(code) && !blocks.includes(code) && !routing.includes(code)
      && !code.startsWith('transport_') && !code.startsWith('dispatch_'));
}, 'Unsupported notification category, state or historical reasons');

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const exceptionPageSchema = z.object({
  items: z.array(operationalExceptionSchema).max(25),
  next_cursor: z.string().min(1).max(200).nullable(),
  detail_authorized: z.boolean(),
  counts: z.object({ ownership: count, vitals: count, laboratory: count,
    scan_capture: count, scan_rule: count, scan_routing: count,
    notification: count, notification_routing: count }).strict().nullable(),
}).strict().refine((value) => value.detail_authorized || (value.items.length === 0 && value.next_cursor === null));

export type ExceptionPage = z.infer<typeof exceptionPageSchema>;
export type ExceptionResult = { data: ExceptionPage; error: null } | { data: null; error: string };
export const EXCEPTION_LOAD_ERROR = 'Operational exceptions are unavailable. Do not interpret this as no pending work.';
