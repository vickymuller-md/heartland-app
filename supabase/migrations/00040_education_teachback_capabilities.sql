-- Professional teach-back records and per-member capabilities.
-- A patient self-assessment (education_progress) and a professional verification are two
-- distinct records and are never collapsed: education_progress is not touched here, and the
-- derived state (pending | verified | not_verified | deferred | not_applicable) is read from
-- the newest teach-back event per domain instead of being materialised on a column.
-- Writing a teach-back requires the `educate` authorization in an organization that actually
-- serves that patient; the organization is chosen among those where the actor holds it.
-- Credential evidence never lands in the member-readable table: it lives in a separate
-- manager-only table, so a member reading its team's capabilities sees no licence strings.
-- No historical backfill, no change to existing objects, no accountability/work-item change
-- (that half of the O4 design ships separately as 00041).

-- ---------------------------------------------------------------------------
-- 1. Per-member capabilities (no credential strings in this table)
-- ---------------------------------------------------------------------------
CREATE TABLE public.member_authorizations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id   uuid NOT NULL REFERENCES public.organization_memberships(id) ON DELETE RESTRICT,
  capability      text NOT NULL CHECK (capability IN (
    'reconcile_medications', 'educate', 'monitor',
    'recommend', 'change_medication', 'clinical_disposition'
  )),
  granted_by      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  granted_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz,
  revoked_at      timestamptz,
  grant_source    text NOT NULL DEFAULT 'manager_grant'
                    CHECK (grant_source IN ('manager_grant', 'bootstrap_00040')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at IS NULL OR expires_at > granted_at),
  CHECK (revoked_at IS NULL OR revoked_at >= granted_at)
);

CREATE UNIQUE INDEX member_authorizations_active_unique
  ON public.member_authorizations (membership_id, capability)
  WHERE revoked_at IS NULL;
CREATE INDEX member_authorizations_capability_idx
  ON public.member_authorizations (capability, revoked_at);

-- Credential evidence, kept out of the member-readable surface. Only a manager of the
-- same organization (is_org_manager already requires AAL2) may read it.
CREATE TABLE public.member_authorization_evidence (
  authorization_id uuid PRIMARY KEY REFERENCES public.member_authorizations(id) ON DELETE RESTRICT,
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  evidence_ref     text NOT NULL CHECK (char_length(btrim(evidence_ref)) BETWEEN 3 AND 500),
  recorded_by      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at       timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX member_authorization_evidence_org_idx
  ON public.member_authorization_evidence (organization_id);

ALTER TABLE public.member_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_authorization_evidence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members_read_authorizations"
  ON public.member_authorizations FOR SELECT TO authenticated
  USING (
    public.provider_aal2()
    AND EXISTS (
      SELECT 1 FROM public.organization_memberships AS membership
      WHERE membership.id = member_authorizations.membership_id
        AND public.is_active_org_member(membership.organization_id)
    )
  );

CREATE POLICY "managers_read_authorization_evidence"
  ON public.member_authorization_evidence FOR SELECT TO authenticated
  USING (public.is_org_manager(organization_id));

-- No write grant to any role: granting and revoking go through the SECURITY DEFINER
-- RPCs below, which are the only path that can record the D-06 evidence requirement.
REVOKE ALL ON TABLE public.member_authorizations, public.member_authorization_evidence
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.member_authorizations TO authenticated, service_role;
GRANT SELECT ON TABLE public.member_authorization_evidence TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Verified teach-back (append-only; references profiles, never patients)
-- ---------------------------------------------------------------------------
-- PGRST201 rule: no new primary or unique key combines a patients FK with a profiles FK,
-- so PostgREST never reads these tables as a patients/profiles junction. education_progress
-- already keys the patient by profiles(id) (00004), and this table follows it.
CREATE TABLE public.education_teachbacks (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  domain_id          text NOT NULL CHECK (char_length(btrim(domain_id)) BETWEEN 2 AND 64),
  organization_id    uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  verified_by        uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  outcome            text NOT NULL CHECK (outcome IN (
    'verified', 'not_verified', 'deferred', 'not_applicable'
  )),
  reason             text CHECK (reason IS NULL OR char_length(btrim(reason)) BETWEEN 3 AND 1000),
  method             text CHECK (method IS NULL OR method IN ('in_person', 'telephone', 'video', 'written')),
  language           text CHECK (language IS NULL OR char_length(btrim(language)) BETWEEN 2 AND 12),
  caregiver_present  boolean,
  occurred_at        timestamptz NOT NULL DEFAULT now() CHECK (isfinite(occurred_at)),
  created_at         timestamptz NOT NULL DEFAULT clock_timestamp(),
  -- A deferral or a not-applicable is a documented decision, mirroring work_items.outcome
  -- (00026) and alerts.resolution_note (00028).
  CHECK (
    outcome NOT IN ('deferred', 'not_applicable')
    OR (reason IS NOT NULL AND char_length(btrim(reason)) >= 3)
  )
);

CREATE INDEX education_teachbacks_patient_domain_idx
  ON public.education_teachbacks (patient_id, domain_id, occurred_at DESC, created_at DESC, id DESC);
CREATE INDEX education_teachbacks_org_idx
  ON public.education_teachbacks (organization_id, occurred_at DESC);

ALTER TABLE public.education_teachbacks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "patients_read_own_teachbacks"
  ON public.education_teachbacks FOR SELECT TO authenticated
  USING (
    public.get_user_role() = 'patient'
    AND public.has_registration_consent()
    AND patient_id = (SELECT auth.uid())
  );

CREATE POLICY "providers_read_linked_teachbacks"
  ON public.education_teachbacks FOR SELECT TO authenticated
  USING (public.provider_has_patient(patient_id));

REVOKE ALL ON TABLE public.education_teachbacks
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.education_teachbacks TO authenticated, service_role;

CREATE FUNCTION public.reject_education_teachback_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'Education teach-back records are append-only';
END;
$$;

CREATE TRIGGER immutable_education_teachbacks
  BEFORE UPDATE OR DELETE ON public.education_teachbacks
  FOR EACH ROW EXECUTE FUNCTION public.reject_education_teachback_mutation();

REVOKE ALL ON FUNCTION public.reject_education_teachback_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Capability lookup
-- ---------------------------------------------------------------------------
-- Internal, ungranted: other SECURITY DEFINER functions use it to filter a set of
-- organizations without the caller gate raising mid-query.
CREATE FUNCTION public.member_capability_granted(
  p_capability text,
  p_organization_id uuid,
  p_user_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.member_authorizations AS grant_row
    JOIN public.organization_memberships AS membership
      ON membership.id = grant_row.membership_id
    WHERE membership.organization_id = p_organization_id
      AND membership.user_id = COALESCE(p_user_id, (SELECT auth.uid()))
      AND membership.status = 'active'
      AND grant_row.capability = p_capability
      AND grant_row.revoked_at IS NULL
      AND (grant_row.expires_at IS NULL OR grant_row.expires_at > now())
  )
$$;

REVOKE ALL ON FUNCTION public.member_capability_granted(text, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- Client-facing lookup. Gated on the caller's own active membership in that organization,
-- so it cannot be used to enumerate the capabilities of arbitrary users in arbitrary teams.
CREATE FUNCTION public.member_has_capability(
  p_capability text,
  p_organization_id uuid,
  p_user_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL
    OR NOT public.provider_aal2()
    OR NOT public.is_active_org_member(p_organization_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Capability lookup not authorized';
  END IF;
  RETURN public.member_capability_granted(p_capability, p_organization_id, p_user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.member_has_capability(text, uuid, uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.member_has_capability(text, uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Granting and revoking a capability (manager of the same organization)
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.grant_member_capability(
  p_membership_id uuid,
  p_capability text,
  p_evidence_ref text DEFAULT NULL,
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor uuid := (SELECT auth.uid());
  org uuid;
  evidence text := NULLIF(btrim(COALESCE(p_evidence_ref, '')), '');
  new_id uuid;
BEGIN
  SELECT membership.organization_id INTO org
  FROM public.organization_memberships AS membership
  WHERE membership.id = p_membership_id AND membership.status = 'active';

  IF org IS NULL OR actor IS NULL OR NOT public.is_org_manager(org) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Capability grant not authorized';
  END IF;
  IF p_capability NOT IN (
    'reconcile_medications', 'educate', 'monitor',
    'recommend', 'change_medication', 'clinical_disposition'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Unknown capability';
  END IF;
  -- D-06: medication change and clinical disposition never derive from a role; they
  -- require recorded evidence. The string is stored in the manager-only table.
  IF p_capability IN ('change_medication', 'clinical_disposition')
    AND (evidence IS NULL OR char_length(evidence) < 3) THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'This capability requires recorded credential evidence';
  END IF;
  IF p_expires_at IS NOT NULL AND p_expires_at <= now() THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Capability expiry must be in the future';
  END IF;

  INSERT INTO public.member_authorizations (membership_id, capability, granted_by, expires_at)
  VALUES (p_membership_id, p_capability, actor, p_expires_at)
  ON CONFLICT (membership_id, capability) WHERE revoked_at IS NULL
  DO UPDATE SET expires_at = EXCLUDED.expires_at
  RETURNING id INTO new_id;

  IF evidence IS NOT NULL THEN
    INSERT INTO public.member_authorization_evidence (
      authorization_id, organization_id, evidence_ref, recorded_by
    ) VALUES (new_id, org, evidence, actor)
    ON CONFLICT (authorization_id) DO UPDATE
      SET evidence_ref = COALESCE(EXCLUDED.evidence_ref, member_authorization_evidence.evidence_ref),
          recorded_by = EXCLUDED.recorded_by,
          updated_at = clock_timestamp();
  END IF;

  RETURN new_id;
END;
$$;

CREATE FUNCTION public.revoke_member_capability(p_authorization_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor uuid := (SELECT auth.uid());
  org uuid;
BEGIN
  SELECT membership.organization_id INTO org
  FROM public.member_authorizations AS grant_row
  JOIN public.organization_memberships AS membership
    ON membership.id = grant_row.membership_id
  WHERE grant_row.id = p_authorization_id;

  IF org IS NULL OR actor IS NULL OR NOT public.is_org_manager(org) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Capability revocation not authorized';
  END IF;

  UPDATE public.member_authorizations AS grant_row
  SET revoked_at = now()
  WHERE grant_row.id = p_authorization_id AND grant_row.revoked_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.grant_member_capability(uuid, text, text, timestamptz)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.revoke_member_capability(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.grant_member_capability(uuid, text, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_member_capability(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Recording a teach-back
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.record_education_teachback(
  p_patient_id uuid,
  p_domain_id text,
  p_outcome text,
  p_reason text DEFAULT NULL,
  p_method text DEFAULT NULL,
  p_language text DEFAULT NULL,
  p_caregiver_present boolean DEFAULT NULL,
  p_occurred_at timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  actor uuid := (SELECT auth.uid());
  org uuid;
  serves boolean;
  new_id uuid;
  moment timestamptz := COALESCE(p_occurred_at, now());
BEGIN
  -- provider_has_patient already requires the provider role, consent and AAL2 (00027).
  IF actor IS NULL OR NOT public.provider_has_patient(p_patient_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Education record not authorized';
  END IF;
  IF NOT pg_catalog.isfinite(moment) OR moment > now() + interval '1 minute' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid teach-back timestamp';
  END IF;
  IF p_outcome NOT IN ('verified', 'not_verified', 'deferred', 'not_applicable') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid teach-back outcome';
  END IF;
  IF p_outcome IN ('deferred', 'not_applicable')
    AND (p_reason IS NULL OR char_length(btrim(p_reason)) < 3) THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'Deferred or not-applicable requires a documented reason';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.organization_patient_assignments AS assignment
    WHERE assignment.patient_id = p_patient_id
      AND assignment.status = 'active'
      AND public.is_active_org_member(assignment.organization_id, actor)
  ) INTO serves;

  IF NOT serves THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Education record not authorized';
  END IF;

  -- The organization recorded is one where the actor actually holds `educate`, not merely
  -- the oldest assignment: filtering after the choice would reject a legitimate record.
  SELECT assignment.organization_id INTO org
  FROM public.organization_patient_assignments AS assignment
  WHERE assignment.patient_id = p_patient_id
    AND assignment.status = 'active'
    AND public.is_active_org_member(assignment.organization_id, actor)
    AND public.member_capability_granted('educate', assignment.organization_id, actor)
  ORDER BY assignment.assigned_at ASC, assignment.id ASC
  LIMIT 1;

  IF org IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Recording education requires the educate authorization';
  END IF;

  INSERT INTO public.education_teachbacks (
    patient_id, domain_id, organization_id, verified_by, outcome,
    reason, method, language, caregiver_present, occurred_at
  ) VALUES (
    p_patient_id, btrim(p_domain_id), org, actor, p_outcome,
    NULLIF(btrim(COALESCE(p_reason, '')), ''), p_method,
    NULLIF(btrim(COALESCE(p_language, '')), ''), p_caregiver_present, moment
  ) RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_education_teachback(uuid, text, text, text, text, text, boolean, timestamptz)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.record_education_teachback(uuid, text, text, text, text, text, boolean, timestamptz)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Reading the derived state without inventing history
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.get_education_teachback_state(p_patient_id uuid)
RETURNS TABLE (
  domain_id text,
  outcome text,
  reason text,
  verified_by uuid,
  verified_by_name text,
  method text,
  caregiver_present boolean,
  occurred_at timestamptz,
  event_count int
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT DISTINCT ON (record.domain_id)
    record.domain_id, record.outcome, record.reason, record.verified_by,
    verifier.full_name, record.method, record.caregiver_present, record.occurred_at,
    (SELECT count(*)::int FROM public.education_teachbacks AS same
      WHERE same.patient_id = record.patient_id AND same.domain_id = record.domain_id)
  FROM public.education_teachbacks AS record
  JOIN public.profiles AS verifier ON verifier.id = record.verified_by
  WHERE record.patient_id = p_patient_id
    AND (
      public.provider_has_patient(p_patient_id)
      OR (
        public.get_user_role() = 'patient'
        AND public.has_registration_consent()
        AND p_patient_id = (SELECT auth.uid())
      )
    )
  -- occurred_at defaults to now(), which is the transaction timestamp: two events recorded
  -- in one transaction would tie and fall through to a random uuid. created_at is
  -- clock_timestamp(), so the later statement is the later record.
  ORDER BY record.domain_id, record.occurred_at DESC, record.created_at DESC, record.id DESC
$$;

REVOKE ALL ON FUNCTION public.get_education_teachback_state(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_education_teachback_state(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. Bootstrap: `educate` for the roles that already deliver education
-- ---------------------------------------------------------------------------
-- Owner, admin and clinician only. Seeding every active membership would include
-- `coordinator` (00027) and make "authorization" a synonym for "has a login". The
-- grant_source marks these as role-derived, so a manager can review and revoke them.
-- None of the other five capabilities is seeded: they have no consumer yet.
INSERT INTO public.member_authorizations (membership_id, capability, granted_by, grant_source)
SELECT membership.id, 'educate',
       COALESCE(owner.user_id, membership.created_by),
       'bootstrap_00040'
FROM public.organization_memberships AS membership
LEFT JOIN LATERAL (
  SELECT m2.user_id FROM public.organization_memberships AS m2
  WHERE m2.organization_id = membership.organization_id
    AND m2.role = 'owner' AND m2.status = 'active'
  ORDER BY m2.created_at ASC LIMIT 1
) AS owner ON true
WHERE membership.status = 'active'
  AND membership.role IN ('owner', 'admin', 'clinician')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 8. Comments
-- ---------------------------------------------------------------------------
COMMENT ON TABLE public.member_authorizations IS
  'Per-membership clinical capabilities; readable by the team, carries no credential strings, written only by grant_member_capability / revoke_member_capability.';
COMMENT ON COLUMN public.member_authorizations.grant_source IS
  'manager_grant for a deliberate grant; bootstrap_00040 for the role-derived educate seed applied by this migration.';
COMMENT ON TABLE public.member_authorization_evidence IS
  'Credential evidence backing one capability grant; readable only by a manager of the same organization.';
COMMENT ON TABLE public.education_teachbacks IS
  'Append-only professional verification of patient education, one row per event; never merged with the patient self-assessment in education_progress.';
COMMENT ON FUNCTION public.member_capability_granted(text, uuid, uuid) IS
  'Internal capability check for other definer functions; ungranted so it cannot be used as an oracle.';
COMMENT ON FUNCTION public.member_has_capability(text, uuid, uuid) IS
  'Capability check for clients, restricted to organizations where the caller is an active AAL2 member.';
COMMENT ON FUNCTION public.grant_member_capability(uuid, text, text, timestamptz) IS
  'Grants one capability to an active membership; manager only; medication change and clinical disposition require credential evidence.';
COMMENT ON FUNCTION public.revoke_member_capability(uuid) IS
  'Revokes one active capability grant without deleting its history; manager of the same organization only.';
COMMENT ON FUNCTION public.record_education_teachback(uuid, text, text, text, text, text, boolean, timestamptz) IS
  'Records one professional teach-back for a linked patient in an organization where the actor holds the educate authorization.';
COMMENT ON FUNCTION public.get_education_teachback_state(uuid) IS
  'Newest teach-back per education domain for one patient, with the number of events; domains with no event are absent, never reported as completed.';
