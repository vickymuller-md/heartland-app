-- ED01: atomic self-assessment, distinct from professional teach-back (00040).
-- Deploy the matching client in the same authorized window. Old raw writes fail
-- closed. One bounded receipt per progress row; no general erasure or audit-log claim.

CREATE TABLE public.education_response_state (
  progress_id uuid PRIMARY KEY REFERENCES public.education_progress(id) ON DELETE CASCADE,
  revision bigint NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740990),
  request_id uuid NOT NULL,
  selected_option integer NOT NULL CHECK (selected_option BETWEEN 0 AND 3),
  content_version text NOT NULL,
  correct boolean NOT NULL
);
ALTER TABLE public.education_response_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.education_response_state FROM PUBLIC, anon, authenticated, service_role;

REVOKE INSERT, UPDATE, DELETE ON public.education_progress FROM PUBLIC, anon, authenticated;
-- Table revocation does not revoke the column grants introduced by 00025.
DO $$
DECLARE column_names text;
BEGIN
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO column_names
  FROM pg_attribute WHERE attrelid='public.education_progress'::regclass
    AND attnum>0 AND NOT attisdropped;
  EXECUTE format('REVOKE INSERT (%s), UPDATE (%s) ON public.education_progress FROM PUBLIC, anon, authenticated', column_names, column_names);
END $$;
DROP POLICY IF EXISTS patients_insert_own_education_progress ON public.education_progress;
DROP POLICY IF EXISTS patients_update_own_education_progress ON public.education_progress;

CREATE FUNCTION public.education_response_version() RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT '0e09e605951318ccbfdd93a53cd2c87e67645c46d859ac022ed4bcb7b32ca03a'::text
$$;
CREATE FUNCTION public.education_answer_key(p_domain_id text) RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT answer FROM (VALUES
    ('daily_weight',1), ('medications',2), ('warning_signs',2), ('what_is_hf',1),
    ('sodium_restriction',0), ('fluid_management',1), ('when_to_call',2), ('activity_guidance',1)
  ) AS keys(domain_id,answer) WHERE domain_id=p_domain_id
$$;
REVOKE ALL ON FUNCTION public.education_response_version(), public.education_answer_key(text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.get_education_response_context(p_expected_actor uuid, p_domain_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
  IF public.education_answer_key(p_domain_id) IS NULL THEN
    RAISE EXCEPTION 'Invalid education domain' USING ERRCODE='22023';
  END IF;
  -- Exactly one statement snapshots authorization, progress and bounded receipt.
  SELECT jsonb_build_object(
    'actorId', p.id, 'domainId', p_domain_id,
    'contentVersion', public.education_response_version(),
    'revision', coalesce(s.revision,0), 'attempts', coalesce(e.attempts,0),
    'completed', coalesce(e.completed,false),
    'lastResponse', CASE WHEN s.progress_id IS NULL THEN NULL ELSE jsonb_build_object(
      'requestId',s.request_id, 'baseRevision',s.revision-1,
      'selectedOption',s.selected_option, 'contentVersion',s.content_version,
      'correct',s.correct) END
  ) INTO result
  FROM public.profiles p
  JOIN public.consents c ON c.user_id=p.id AND c.consent_type='registration'
    AND c.consent_version='v1.0' AND c.accepted
  LEFT JOIN public.education_progress e ON e.patient_id=p.id AND e.domain_id=p_domain_id
  LEFT JOIN public.education_response_state s ON s.progress_id=e.id
  WHERE auth.role()='authenticated' AND p.id=auth.uid() AND p.id=p_expected_actor
    AND p.role='patient';
  IF result IS NULL THEN RAISE EXCEPTION 'Education access denied' USING ERRCODE='42501'; END IF;
  RETURN result;
END $$;

CREATE FUNCTION public.submit_education_response(
  p_expected_actor uuid, p_domain_id text, p_request_id uuid,
  p_selected_option integer, p_expected_revision bigint, p_content_version text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path='' SET lock_timeout='5s' AS $$
DECLARE
  progress public.education_progress%ROWTYPE;
  receipt public.education_response_state%ROWTYPE;
  current_revision bigint;
  answer integer;
  is_correct boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' OR auth.uid() IS NULL
    OR p_expected_actor IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Education access denied' USING ERRCODE='42501';
  END IF;
  answer := public.education_answer_key(p_domain_id);
  IF answer IS NULL OR p_request_id IS NULL OR p_selected_option IS NULL
    OR p_selected_option NOT BETWEEN 0 AND 3 OR p_expected_revision IS NULL
    OR p_expected_revision NOT BETWEEN 0 AND 9007199254740989
    OR p_content_version IS DISTINCT FROM public.education_response_version() THEN
    RAISE EXCEPTION 'Invalid education response' USING ERRCODE='22023';
  END IF;

  -- Profile/consent before domain/progress, and authorization before any replay.
  PERFORM 1 FROM public.profiles WHERE id=p_expected_actor AND role='patient' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Education access denied' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.consents WHERE user_id=p_expected_actor
    AND consent_type='registration' AND consent_version='v1.0' AND accepted FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Education access denied' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('education-response:'||p_expected_actor::text||':'||p_domain_id,0));
  -- Recheck against current rows after any wait; no fallback role lookup.
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=p_expected_actor AND role='patient')
    OR NOT public.has_registration_consent() THEN
    RAISE EXCEPTION 'Education access denied' USING ERRCODE='42501';
  END IF;
  SELECT * INTO progress FROM public.education_progress
    WHERE patient_id=p_expected_actor AND domain_id=p_domain_id FOR UPDATE;
  SELECT * INTO receipt FROM public.education_response_state WHERE progress_id=progress.id;
  current_revision := coalesce(receipt.revision,0);

  IF receipt.request_id=p_request_id THEN
    IF receipt.selected_option IS DISTINCT FROM p_selected_option
      OR receipt.content_version IS DISTINCT FROM p_content_version
      OR receipt.revision-1 IS DISTINCT FROM p_expected_revision THEN
      RAISE EXCEPTION 'Response identity mismatch' USING ERRCODE='22023';
    END IF;
    RETURN jsonb_build_object('status','saved','context',
      public.get_education_response_context(p_expected_actor,p_domain_id));
  END IF;
  IF current_revision<>p_expected_revision THEN
    RETURN jsonb_build_object('status','conflict');
  END IF;
  -- Overflow raises before either new state or progress can commit. Replay above
  -- still succeeds when the saved counter has reached the smallint maximum.
  IF coalesce(progress.attempts,0)>=32767 THEN
    RAISE EXCEPTION 'Education attempt limit reached' USING ERRCODE='22003';
  END IF;
  is_correct := p_selected_option=answer;
  INSERT INTO public.education_progress(patient_id,domain_id,attempts,completed,completed_at)
    VALUES(p_expected_actor,p_domain_id,1,is_correct,CASE WHEN is_correct THEN now() ELSE NULL END)
    ON CONFLICT(patient_id,domain_id) DO UPDATE SET
      attempts=public.education_progress.attempts+1,
      completed=public.education_progress.completed OR EXCLUDED.completed,
      completed_at=CASE WHEN public.education_progress.completed THEN public.education_progress.completed_at
        WHEN EXCLUDED.completed THEN now() ELSE NULL END
    RETURNING * INTO progress;
  INSERT INTO public.education_response_state(progress_id,revision,request_id,selected_option,content_version,correct)
    VALUES(progress.id,current_revision+1,p_request_id,p_selected_option,p_content_version,is_correct)
    ON CONFLICT(progress_id) DO UPDATE SET revision=EXCLUDED.revision, request_id=EXCLUDED.request_id,
      selected_option=EXCLUDED.selected_option, content_version=EXCLUDED.content_version, correct=EXCLUDED.correct;
  RETURN jsonb_build_object('status','saved','context',
    public.get_education_response_context(p_expected_actor,p_domain_id));
END $$;
REVOKE ALL ON FUNCTION public.get_education_response_context(uuid,text),
  public.submit_education_response(uuid,text,uuid,integer,bigint,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_education_response_context(uuid,text),
  public.submit_education_response(uuid,text,uuid,integer,bigint,text) TO authenticated;

COMMENT ON TABLE public.education_response_state IS
  'Bounded latest self-assessment receipt. Not professional verification or an immutable history. Deleted with its progress row; existing patient erasure restrictions remain.';
