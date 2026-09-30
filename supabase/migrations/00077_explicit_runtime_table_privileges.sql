-- Runtime reads must not depend on installation-specific default privileges.
-- Existing RLS remains authoritative; no policies or clinical rules change.
-- Do not grant privileges to PUBLIC/anon, alter defaults, or reopen receipted writes.
GRANT SELECT ON TABLE
  public.profiles,
  public.consents,
  public.patients,
  public.provider_patient_links,
  public.vitals,
  public.symptoms,
  public.medications,
  public.medication_logs,
  public.education_progress,
  public.alerts,
  public.provider_notes,
  public.alert_preferences,
  public.scheduled_followups,
  public.discharge_records,
  public.discharge_followups,
  public.provider_messages,
  public.quality_metric_records
TO authenticated;

-- Exact columns used by health, expired-sandbox lookup and aggregate reports.
GRANT SELECT (id, role, sandbox_expires_at, state, created_at)
  ON public.profiles TO service_role;
GRANT SELECT (id) ON public.alerts TO service_role;
GRANT SELECT (id, content) ON public.provider_notes TO service_role;
GRANT SELECT (id, status) ON public.access_requests TO service_role;

-- invitePatient compensates a failed Auth invitation by id AND status='invited'.
GRANT SELECT (id, status), DELETE ON public.provider_patient_links TO service_role;

-- No new raw lab_results read/write grant: current readers use the effective
-- observation projection. Existing installation grants are not silently revoked
-- here (00038 retains trusted ingestion). RPC/journal boundaries stay unchanged.
