-- Local inert operator visibility. No dispatch, acknowledgement, replay or grants.
-- Grant expiry is observed at server read time, not at transaction start.
CREATE FUNCTION public.operational_monitor_current(p_org uuid,p_member uuid,p_at timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT public.is_active_org_member(p_org,p_member)
    AND EXISTS(SELECT 1 FROM public.consents WHERE user_id=p_member AND consent_type='registration'
      AND consent_version='v1.0' AND accepted)
    AND EXISTS(SELECT 1 FROM public.member_authorizations AS grant_row
      JOIN public.organization_memberships AS membership ON membership.id=grant_row.membership_id
      WHERE membership.organization_id=p_org AND membership.user_id=p_member AND membership.status='active'
        AND grant_row.capability='monitor' AND grant_row.revoked_at IS NULL
        AND (grant_row.expires_at IS NULL OR grant_row.expires_at>p_at))
$$;
REVOKE ALL ON FUNCTION public.operational_monitor_current(uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.operational_exception_detail_allowed(p_org uuid,p_patient uuid)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
  SELECT COALESCE((SELECT auth.role())='authenticated' AND (SELECT auth.uid()) IS NOT NULL
    AND public.provider_aal2()
    AND public.work_ownership_member_eligible(p_org,p_patient,(SELECT auth.uid()),clock_timestamp()),false)
$$;
REVOKE ALL ON FUNCTION public.operational_exception_detail_allowed(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.operational_exception_rows(p_org uuid)
RETURNS TABLE(key text,category text,patient_id uuid,work_item_id uuid,state text,reasons text[],recorded_at timestamptz)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
  WITH ownership AS (
    SELECT item.*,array_remove(ARRAY[
      CASE WHEN NOT public.org_has_patient(p_org,item.patient_id) THEN 'patient_unassigned' END,
      CASE WHEN item.accountability_source IS NULL OR item.accountability_source='legacy_fan_out' THEN 'legacy_owner' END,
      CASE WHEN item.accepted_at IS NULL THEN 'unaccepted' END,
      CASE WHEN NOT public.is_active_org_member(p_org,item.assigned_to) THEN 'inactive_member' END,
      CASE WHEN NOT EXISTS(SELECT 1 FROM public.provider_patient_links AS link
        WHERE link.provider_id=item.assigned_to AND link.patient_id=item.patient_id AND link.status='active') THEN 'no_active_link' END,
      CASE WHEN NOT public.operational_monitor_current(p_org,item.assigned_to,clock_timestamp()) THEN 'no_monitor_authorization' END
    ],NULL)::text[] AS reason_codes
    FROM public.work_items AS item WHERE item.organization_id=p_org AND item.status<>'closed'
  ), patients AS (
    SELECT assignment.patient_id FROM public.organization_patient_assignments AS assignment
    WHERE assignment.organization_id=p_org AND assignment.status='active'
  )
  SELECT 'ownership:'||item.id,'ownership',item.patient_id,item.id,'needs_review',item.reason_codes,item.created_at
    FROM ownership AS item WHERE cardinality(item.reason_codes)>0
  UNION ALL
  SELECT 'vitals:'||evaluation.request_id,'vitals',attempt.patient_id,NULL::uuid,
    evaluation.status,ARRAY[CASE WHEN evaluation.status='failed' THEN 'evaluation_failed' ELSE 'evaluation_pending' END],receipt.captured_at
    FROM public.vitals_submission_evaluations AS evaluation
    JOIN public.vitals_submission_attempts AS attempt USING(request_id)
    JOIN public.vitals_submission_receipts AS receipt USING(request_id)
    JOIN patients ON patients.patient_id=attempt.patient_id
    WHERE evaluation.status<>'complete'
  UNION ALL
  SELECT 'laboratory:'||evaluation.id,'laboratory',evaluation.patient_id,NULL::uuid,
    CASE WHEN evaluation.last_error_code IS NULL THEN 'pending' ELSE 'failed' END,
    ARRAY[CASE WHEN evaluation.last_error_code IS NULL THEN 'evaluation_pending' ELSE 'evaluation_failed' END],evaluation.created_at
    FROM public.lab_alert_evaluations AS evaluation JOIN patients USING(patient_id)
    WHERE evaluation.status='pending'
  UNION ALL
  SELECT 'scan_capture:'||receipt.id,'scan_capture',receipt.patient_id,NULL::uuid,
    CASE WHEN receipt.capture_status IN('pending','failed') THEN receipt.capture_status ELSE 'blocked' END,
    ARRAY[CASE receipt.capture_status WHEN 'pending' THEN 'capture_pending' WHEN 'failed' THEN 'capture_failed'
      WHEN 'blocked_scope' THEN 'blocked_scope' ELSE 'missed_capture_window' END],run.created_at
    FROM public.alert_scan_patients AS receipt JOIN patients USING(patient_id)
    JOIN public.alert_scan_runs AS run ON run.id=receipt.run_id WHERE receipt.capture_status<>'captured'
  UNION ALL
  SELECT 'scan_rule:'||evaluation.receipt_id||':'||evaluation.rule,'scan_rule',receipt.patient_id,NULL::uuid,
    evaluation.status,ARRAY[CASE evaluation.status WHEN 'pending' THEN 'evaluation_pending' WHEN 'failed' THEN 'evaluation_failed'
      ELSE CASE WHEN evaluation.error_code='blocked_scope' THEN 'blocked_scope' ELSE 'rule_blocked' END END],
    COALESCE(evaluation.processed_at,run.created_at)
    FROM public.alert_scan_evaluations AS evaluation
    JOIN public.alert_scan_patients AS receipt ON receipt.id=evaluation.receipt_id
    JOIN patients ON patients.patient_id=receipt.patient_id
    JOIN public.alert_scan_runs AS run ON run.id=receipt.run_id
    WHERE receipt.capture_status='captured' AND evaluation.status<>'complete'
  UNION ALL
  SELECT 'scan_routing:'||evaluation.receipt_id||':'||evaluation.rule||':'||item.id,'scan_routing',item.patient_id,item.id,
    'needs_review',ARRAY['needs_episode_adjudication']::text[],evaluation.processed_at
    FROM public.alert_scan_evaluations AS evaluation
    JOIN public.alert_scan_patients AS receipt ON receipt.id=evaluation.receipt_id
    JOIN public.work_items AS item ON item.id=ANY(evaluation.prior_item_ids)
      AND item.patient_id=receipt.patient_id AND item.organization_id=p_org
    WHERE evaluation.error_code='needs_episode_adjudication'
  UNION ALL
  SELECT 'notification:'||intent.id,'notification',intent.patient_id,intent.work_item_id,intent.state,
    array_remove(ARRAY[intent.event_kind,CASE WHEN intent.blocked_reason IS NOT NULL THEN 'captured_'||intent.blocked_reason END],NULL),intent.captured_at
    FROM public.notification_intents AS intent
    JOIN public.work_items AS item ON item.id=intent.work_item_id
      AND item.patient_id=intent.patient_id AND item.organization_id=intent.organization_id
    WHERE intent.organization_id=p_org AND intent.state IN('pending','blocked')
  UNION ALL
  SELECT 'notification_routing:'||exception.id,'notification_routing',exception.patient_id,exception.work_item_id,
    'needs_review',ARRAY[exception.reason],exception.recorded_at
    FROM public.notification_routing_exceptions AS exception
    JOIN public.work_items AS item ON item.id=exception.work_item_id
      AND item.patient_id=exception.patient_id AND item.organization_id=exception.organization_id
    WHERE exception.organization_id=p_org
$$;
REVOKE ALL ON FUNCTION public.operational_exception_rows(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.get_operational_exceptions(p_organization_id uuid,p_after text DEFAULT NULL,p_limit integer DEFAULT 25)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' SET timezone='UTC' AS $$
DECLARE v_manager boolean; v_monitor boolean; v_result jsonb;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'authenticated' OR (SELECT auth.uid()) IS NULL
    OR NOT COALESCE(public.provider_aal2() AND public.is_active_org_member(p_organization_id),false) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Operational exceptions not authorized';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 25
    OR (p_after IS NOT NULL AND char_length(p_after) NOT BETWEEN 1 AND 200) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid exception page';
  END IF;
  v_manager:=public.is_org_manager(p_organization_id);
  v_monitor:=public.operational_monitor_current(p_organization_id,(SELECT auth.uid()),clock_timestamp());
  WITH exceptions AS MATERIALIZED(SELECT * FROM public.operational_exception_rows(p_organization_id)),
  page AS MATERIALIZED(
    SELECT row.* FROM exceptions AS row
    WHERE v_monitor AND public.operational_exception_detail_allowed(p_organization_id,row.patient_id)
      AND (p_after IS NULL OR row.key COLLATE "C">p_after COLLATE "C")
    ORDER BY row.key COLLATE "C" LIMIT p_limit+1
  ), visible AS(SELECT * FROM page ORDER BY key COLLATE "C" LIMIT p_limit)
  SELECT jsonb_build_object(
    'items',COALESCE((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.key COLLATE "C") FROM visible AS row),'[]'::jsonb),
    'next_cursor',CASE WHEN (SELECT count(*) FROM page)>p_limit
      THEN (SELECT key FROM visible ORDER BY key COLLATE "C" DESC LIMIT 1) END,
    'detail_authorized',v_monitor,
    'counts',CASE WHEN v_manager THEN (SELECT jsonb_build_object(
      'ownership',count(*) FILTER(WHERE category='ownership'),
      'vitals',count(*) FILTER(WHERE category='vitals'),
      'laboratory',count(*) FILTER(WHERE category='laboratory'),
      'scan_capture',count(*) FILTER(WHERE category='scan_capture'),
      'scan_rule',count(*) FILTER(WHERE category='scan_rule'),
      'scan_routing',count(*) FILTER(WHERE category='scan_routing'),
      'notification',count(*) FILTER(WHERE category='notification'),
      'notification_routing',count(*) FILTER(WHERE category='notification_routing')) FROM exceptions) END
  ) INTO v_result;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_operational_exceptions(uuid,text,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_operational_exceptions(uuid,text,integer) TO authenticated;

-- Preserve legacy signature and its narrowed authority; propagate volatile read semantics.
CREATE OR REPLACE FUNCTION public.get_unowned_work(p_organization_id uuid)
RETURNS TABLE(work_item_id uuid,patient_id uuid,reason_code text,status text,created_at timestamptz)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
  SELECT item.id,item.patient_id,CASE WHEN row.reasons[1]='legacy_owner' THEN 'legacy_fan_out' ELSE row.reasons[1] END,item.status,item.created_at
  FROM public.operational_exception_rows(p_organization_id) AS row
  JOIN public.work_items AS item ON item.id=row.work_item_id
  WHERE row.category='ownership' AND public.is_org_manager(p_organization_id)
    AND public.operational_exception_detail_allowed(p_organization_id,item.patient_id)
  ORDER BY item.created_at DESC,item.id
$$;
REVOKE ALL ON FUNCTION public.get_unowned_work(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_unowned_work(uuid) TO authenticated;
