-- Read-only recipient preparation. No ownership write, grant, notification or backfill.
-- Candidate reads do not promise eligibility at a later write; 00050 gates remain authoritative.
CREATE FUNCTION public.work_ownership_target_page(p_org uuid,p_patient uuid,p_excluded uuid,p_after uuid,p_limit integer)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 WITH candidates AS MATERIALIZED(
   SELECT member.user_id,COALESCE(profile.full_name,'Team member') AS name
   FROM public.organization_memberships AS member JOIN public.profiles AS profile ON profile.id=member.user_id
   WHERE member.organization_id=p_org AND member.user_id IS DISTINCT FROM p_excluded
     AND (p_after IS NULL OR member.user_id>p_after)
     AND public.work_ownership_member_eligible(p_org,p_patient,member.user_id,clock_timestamp())
   ORDER BY member.user_id LIMIT p_limit+1
 ), page AS(SELECT * FROM candidates ORDER BY user_id LIMIT p_limit)
 SELECT jsonb_build_object('targets',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',user_id,'name',name) ORDER BY user_id) FROM page),'[]'::jsonb),
   'next_cursor',CASE WHEN (SELECT count(*) FROM candidates)>p_limit THEN (SELECT user_id FROM page ORDER BY user_id DESC LIMIT 1) END)
$$;
REVOKE ALL ON FUNCTION public.work_ownership_target_page(uuid,uuid,uuid,uuid,integer) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.get_work_transfer_context(p_work_item_id uuid,p_after uuid DEFAULT NULL,p_limit integer DEFAULT 25)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE v_context public.work_items%ROWTYPE; v_item public.work_items%ROWTYPE; v_page jsonb; v_eligible boolean;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 25 THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid ownership page';
 END IF;
 SELECT * INTO v_context FROM public.work_items WHERE id=p_work_item_id;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Work ownership operation not authorized'; END IF;
 PERFORM public.lock_work_ownership_scope(v_context.organization_id,v_context.patient_id,NULL,NULL,false);
 SELECT * INTO v_item FROM public.work_items WHERE id=p_work_item_id;
 IF NOT FOUND OR v_item.organization_id IS DISTINCT FROM v_context.organization_id OR v_item.patient_id IS DISTINCT FROM v_context.patient_id
   OR NOT (v_item.assigned_to=(SELECT auth.uid()) OR public.is_org_manager(v_item.organization_id)) THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Work ownership operation not authorized';
 END IF;
 v_eligible:=v_item.status<>'closed' AND v_item.transfer_pending_to IS NULL;
 v_page:=CASE WHEN v_eligible THEN public.work_ownership_target_page(v_item.organization_id,v_item.patient_id,v_item.assigned_to,p_after,p_limit)
   ELSE jsonb_build_object('targets','[]'::jsonb,'next_cursor',NULL) END;
 PERFORM public.require_work_ownership_scope(v_item.organization_id,v_item.patient_id,NULL,false);
 RETURN jsonb_build_object('work_item_id',v_item.id,'patient_id',v_item.patient_id,
   'current_assignee',v_item.assigned_to,'current_revision',v_item.ownership_revision::text,
   'pending_recipient',v_item.transfer_pending_to,'eligible',v_eligible)||v_page;
END;
$$;
REVOKE ALL ON FUNCTION public.get_work_transfer_context(uuid,uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_work_transfer_context(uuid,uuid,integer) TO authenticated;

CREATE FUNCTION public.get_patient_designation_context(p_organization_id uuid,p_patient_id uuid,p_after uuid DEFAULT NULL,p_limit integer DEFAULT 25)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='5s' AS $$
DECLARE v_current jsonb; v_page jsonb;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 25 THEN
   RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid ownership page';
 END IF;
 PERFORM public.lock_work_ownership_scope(p_organization_id,p_patient_id,NULL,NULL,true);
 SELECT jsonb_build_object('id',designation.accountable_id,'name',COALESCE(profile.full_name,'Team member'))
 INTO v_current FROM public.patient_accountability AS designation
 JOIN public.profiles AS profile ON profile.id=designation.accountable_id
 WHERE designation.organization_id=p_organization_id AND designation.patient_id=p_patient_id AND designation.revoked_at IS NULL;
 v_page:=public.work_ownership_target_page(p_organization_id,p_patient_id,NULL,p_after,p_limit);
 PERFORM public.require_work_ownership_scope(p_organization_id,p_patient_id,NULL,true);
 RETURN jsonb_build_object('organization_id',p_organization_id,'patient_id',p_patient_id,'current',v_current)||v_page;
END;
$$;
REVOKE ALL ON FUNCTION public.get_patient_designation_context(uuid,uuid,uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_patient_designation_context(uuid,uuid,uuid,integer) TO authenticated;
