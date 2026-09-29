-- Authorized read context for explicit source-command preparation/recovery.
-- No mutation recipe, public table grant, or clinical disposition is added.
CREATE FUNCTION public.get_lab_source_context(p_organization_id uuid,p_patient_id uuid,
 p_after text DEFAULT NULL,p_snapshot text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET timezone='UTC' SET lock_timeout='5s' AS $$
DECLARE actor uuid:=(SELECT auth.uid()); observations jsonb; rows jsonb; broken boolean;
 can_mutate boolean; signature text; result jsonb;
BEGIN
 PERFORM public.lock_care_workflow_scope(p_organization_id,p_patient_id,false);
 IF num_nulls(p_after,p_snapshot)=1 OR(p_snapshot IS NOT NULL AND p_snapshot !~ '^[0-9a-f]{64}$')
  OR(p_after IS NOT NULL AND p_after !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(potassium|creatinine|egfr|bun|bnp|nt_probnp|hba1c|glucose|sodium|hemoglobin|ferritin|tsat|ldl)$') THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid laboratory source cursor';
 END IF;
 observations:=public.effective_lab_observation_rows(ARRAY[p_patient_id],true);
 SELECT COALESCE(jsonb_agg(jsonb_build_object('observation',item,'source_authority_organization_id',r.organization_id)
  ORDER BY (item->>'id') COLLATE "C"),'[]'::jsonb),
  COALESCE(bool_or((item->>'root_id' IS NOT NULL AND(r.id IS NULL OR r.patient_id<>p_patient_id
   OR r.original_lab_result_id::text IS DISTINCT FROM item->>'original_lab_result_id'
   OR r.analyte IS DISTINCT FROM item->>'analyte')) OR item->>'patient_id' IS DISTINCT FROM p_patient_id::text),false)
 INTO rows,broken FROM jsonb_array_elements(observations) item
 LEFT JOIN public.lab_observation_roots r ON r.id=(item->>'root_id')::uuid;
 IF broken THEN RAISE EXCEPTION USING ERRCODE='22000',MESSAGE='Laboratory source authority is inconsistent'; END IF;
 SELECT EXISTS(SELECT 1 FROM public.member_authorizations g JOIN public.organization_memberships m ON m.id=g.membership_id
  WHERE m.organization_id=p_organization_id AND m.user_id=actor AND m.status='active'
   AND g.capability='clinical_disposition' AND g.revoked_at IS NULL AND(g.expires_at IS NULL OR g.expires_at>clock_timestamp())) INTO can_mutate;
 signature:=encode(sha256(convert_to(jsonb_build_object('actor_id',actor,'organization_id',p_organization_id,
  'patient_id',p_patient_id,'can_mutate',can_mutate,'items',rows)::text,'UTF8')),'hex');
 IF p_snapshot IS NOT NULL AND signature<>p_snapshot THEN
  RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Source context changed; reload the complete view';
 END IF;
 WITH candidates AS(SELECT item FROM jsonb_array_elements(rows) item
  WHERE p_after IS NULL OR(item#>>'{observation,id}') COLLATE "C">p_after COLLATE "C"
  ORDER BY(item#>>'{observation,id}') COLLATE "C" LIMIT 251),
 visible AS(SELECT item FROM candidates ORDER BY(item#>>'{observation,id}') COLLATE "C" LIMIT 250)
 SELECT jsonb_build_object('actor_id',actor,'organization_id',p_organization_id,'patient_id',p_patient_id,
  'can_mutate',can_mutate,'snapshot',signature,
  'items',COALESCE((SELECT jsonb_agg(item ORDER BY(item#>>'{observation,id}') COLLATE "C") FROM visible),'[]'::jsonb),
  'next_cursor',CASE WHEN(SELECT count(*) FROM candidates)>250 THEN
   (SELECT item#>>'{observation,id}' FROM visible ORDER BY(item#>>'{observation,id}') COLLATE "C" DESC LIMIT 1) ELSE NULL END) INTO result;
 PERFORM public.require_care_workflow_scope(p_organization_id,p_patient_id,false);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.get_lab_source_context(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_lab_source_context(uuid,uuid,text,text) TO authenticated;
