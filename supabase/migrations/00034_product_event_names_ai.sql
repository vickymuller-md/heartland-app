-- The product_events table enforces its own event-name allowlist (third layer
-- after Zod and the RPC). Extend it with the sandbox AI demonstration events
-- introduced in 00033.

ALTER TABLE public.product_events
  DROP CONSTRAINT product_events_event_name_check,
  ADD CONSTRAINT product_events_event_name_check CHECK (event_name IN (
    'workspace_view', 'daily_loop_view', 'work_item_reviewed',
    'work_item_actioned', 'work_item_awaiting', 'work_item_closed',
    'work_item_reassigned', 'saved_view_created', 'patient_brief_view',
    'patient_today_view', 'access_review', 'sandbox_view',
    'sandbox_first_action', 'sandbox_task_completed', 'sandbox_returned',
    'queue_page_view', 'fhir_export_created', 'offline_draft_saved',
    'ai_checkin_started', 'ai_checkin_completed', 'ai_checkin_fallback',
    'ai_call_sim_run', 'ai_escalation_demonstrated'
  ));
