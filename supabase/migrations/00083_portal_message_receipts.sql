BEGIN;
-- The message ID is the operation receipt. Existing portal messages keep their IDs.
CREATE FUNCTION public.record_portal_message(p_expected_actor uuid, p_patient_id uuid, p_request_id uuid,
  p_template text, p_subject text, p_body text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE v_actor uuid := auth.uid(); v_saved public.provider_messages%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR p_expected_actor IS DISTINCT FROM v_actor OR public.provider_aal2() IS NOT TRUE THEN
    RAISE EXCEPTION 'Provider session unavailable' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM public.provider_patient_links WHERE provider_id=v_actor AND patient_id=p_patient_id AND status='active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Patient link unavailable' USING ERRCODE='42501'; END IF;
  IF p_request_id IS NULL OR p_template IS NULL OR p_template NOT IN ('dose_change','appointment','lab_order','general')
     OR coalesce(length(trim(p_subject)),0)=0 OR length(p_subject)>200
     OR coalesce(length(trim(p_body)),0)=0 OR length(p_body)>2000 THEN
    RAISE EXCEPTION 'Invalid message' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.provider_messages(id, patient_id, provider_id, template_type, subject, body)
    VALUES(p_request_id,p_patient_id,v_actor,p_template,p_subject,p_body) ON CONFLICT(id) DO NOTHING;
  SELECT * INTO STRICT v_saved FROM public.provider_messages WHERE id=p_request_id;
  IF (v_saved.provider_id,v_saved.patient_id,v_saved.template_type,v_saved.subject,v_saved.body)
    IS DISTINCT FROM (v_actor,p_patient_id,p_template,p_subject,p_body) THEN
    RAISE EXCEPTION 'Message does not match previous operation' USING ERRCODE='22023';
  END IF;
  RETURN p_request_id;
END;
$$;

CREATE FUNCTION public.confirm_portal_message_read(p_expected_patient uuid, p_message_id uuid) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE v_actor uuid := auth.uid(); v_read_at timestamptz;
BEGIN
  IF v_actor IS NULL OR p_expected_patient IS DISTINCT FROM v_actor OR public.get_user_role() IS DISTINCT FROM 'patient'
     OR public.has_registration_consent() IS NOT TRUE THEN
    RAISE EXCEPTION 'Patient session unavailable' USING ERRCODE='42501';
  END IF;
  SELECT read_at INTO v_read_at FROM public.provider_messages WHERE id=p_message_id AND patient_id=v_actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Message unavailable' USING ERRCODE='42501'; END IF;
  IF v_read_at IS NULL THEN
    UPDATE public.provider_messages SET read_at=clock_timestamp() WHERE id=p_message_id AND patient_id=v_actor RETURNING read_at INTO v_read_at;
  END IF;
  RETURN v_read_at;
END;
$$;
REVOKE ALL ON FUNCTION public.record_portal_message(uuid,uuid,uuid,text,text,text), public.confirm_portal_message_read(uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_portal_message(uuid,uuid,uuid,text,text,text), public.confirm_portal_message_read(uuid,uuid) TO authenticated;
REVOKE INSERT, INSERT(patient_id,provider_id,template_type,subject,body)
  ON public.provider_messages FROM PUBLIC, anon, authenticated;
REVOKE UPDATE(read_at) ON public.provider_messages FROM PUBLIC, anon, authenticated;
COMMIT;
