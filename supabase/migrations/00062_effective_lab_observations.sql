-- Shared read projection, before any amendment API is enabled. No write privileges.
CREATE FUNCTION public.get_effective_lab_observations(p_patient_ids uuid[],p_after text DEFAULT NULL,p_snapshot text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' SET timezone='UTC' AS $$
DECLARE actor uuid:=(SELECT auth.uid()); patients uuid[]; rows jsonb; signature text; page jsonb; invalid boolean;
 provider boolean:=public.provider_aal2(); patient uuid;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION USING ERRCODE='25001',MESSAGE='Laboratory projection requires READ COMMITTED';
 END IF;
 IF actor IS NULL OR COALESCE((SELECT auth.jwt()->>'role'),'')<>'authenticated' THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Laboratory projection not authorized';
 END IF;
 IF p_patient_ids IS NULL OR cardinality(p_patient_ids) NOT BETWEEN 1 AND 500 OR array_ndims(p_patient_ids)<>1
  OR array_position(p_patient_ids,NULL) IS NOT NULL THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid laboratory projection scope';
 END IF;
 SELECT array_agg(DISTINCT id ORDER BY id) INTO patients FROM unnest(p_patient_ids) id;
 IF cardinality(patients)<>cardinality(p_patient_ids) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid laboratory projection scope';
 END IF;
 FOREACH patient IN ARRAY patients LOOP
  IF NOT EXISTS(SELECT 1 FROM public.patients WHERE id=patient) OR NOT(
   (provider AND public.provider_has_patient(patient)) OR
   (public.get_user_role()='patient' AND public.has_registration_consent() AND patient=actor)) THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Laboratory projection not authorized';
  END IF;
 END LOOP;
 -- Do not hide an inconsistent root merely because its source would be excluded.
 IF EXISTS(SELECT 1 FROM public.lab_observation_roots r JOIN public.lab_results l ON l.id=r.original_lab_result_id
  WHERE (l.patient_id=ANY(patients) OR r.patient_id=ANY(patients)) AND
   (r.patient_id<>l.patient_id OR EXISTS(SELECT 1 FROM public.lab_observation_versions v
     WHERE v.lab_result_id=l.id AND v.status<>'original'))) THEN
  RAISE EXCEPTION USING ERRCODE='22000',MESSAGE='Laboratory source history is inconsistent';
 END IF;
 IF num_nulls(p_after,p_snapshot)=1 OR (p_snapshot IS NOT NULL AND p_snapshot !~ '^[0-9a-f]{64}$')
  OR (p_after IS NOT NULL AND p_after !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(potassium|creatinine|egfr|bun|bnp|nt_probnp|hba1c|glucose|sodium|hemoglobin|ferritin|tsat|ldl)$') THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid laboratory projection cursor';
 END IF;
 WITH originals AS (
  SELECT l.* FROM public.lab_results l WHERE l.patient_id=ANY(patients)
   AND NOT EXISTS(SELECT 1 FROM public.lab_observation_versions v WHERE v.lab_result_id=l.id AND v.status<>'original')
 ), observations AS (
  SELECT o.id AS original_id,o.patient_id,a.key AS analyte,o.id::text||':'||a.key AS key,
   r.id AS root_id,r.patient_id AS root_patient,h.id AS version_id,h.revision,h.status AS head_status,
   h.lab_result_id AS head_lab,h.predecessor_id,e.id AS value_lab,e.patient_id AS value_patient,
   e.collected_at,e.notes,e.lab_facility,to_jsonb(e)->>a.key AS source_value,a.value='null'::jsonb AS original_missing,
   CASE WHEN provider THEN ev.status ELSE NULL END AS evaluation_status
  FROM originals o CROSS JOIN LATERAL jsonb_each(to_jsonb(o)) a
  LEFT JOIN public.lab_observation_roots r ON r.original_lab_result_id=o.id AND r.analyte=a.key
  LEFT JOIN LATERAL (SELECT v.* FROM public.lab_observation_versions v WHERE v.root_id=r.id ORDER BY v.revision DESC LIMIT 1) h ON true
  LEFT JOIN LATERAL (SELECT v.lab_result_id FROM public.lab_observation_versions v WHERE v.root_id=r.id AND v.lab_result_id IS NOT NULL
   ORDER BY v.revision DESC LIMIT 1) prior_value ON true
  LEFT JOIN public.lab_results e ON e.id=CASE WHEN r.id IS NULL THEN o.id
   WHEN h.status='cancelled' THEN prior_value.lab_result_id ELSE h.lab_result_id END
  LEFT JOIN public.lab_alert_evaluations ev ON ev.lab_result_id=e.id
  WHERE a.key IN('potassium','creatinine','egfr','bun','bnp','nt_probnp','hba1c','glucose','sodium','hemoglobin','ferritin','tsat','ldl')
   AND (a.value<>'null'::jsonb OR r.id IS NOT NULL)
 ), rendered AS (
  SELECT key,
   (original_missing OR value_lab IS NULL OR value_patient IS DISTINCT FROM patient_id OR source_value IS NULL OR
    (root_id IS NOT NULL AND (version_id IS NULL OR root_patient IS DISTINCT FROM patient_id OR
     NOT COALESCE((head_status='original' AND revision=1 AND head_lab=original_id AND predecessor_id IS NULL)
       OR(head_status='corrected' AND revision>1 AND head_lab IS NOT NULL AND predecessor_id IS NOT NULL)
       OR(head_status='cancelled' AND revision>1 AND head_lab IS NULL AND predecessor_id IS NOT NULL),false)))) AS broken,
   jsonb_build_object('id',key,'patient_id',patient_id,'original_lab_result_id',original_id,'analyte',analyte,
    'root_id',root_id,'version_id',version_id,'revision',revision::text,'status',COALESCE(head_status,'original'),
    'effective_lab_result_id',CASE WHEN head_status='cancelled' THEN NULL ELSE value_lab END,
    'value',CASE WHEN head_status='cancelled' THEN NULL ELSE source_value END,'collected_at',collected_at,
    'notes',notes,'lab_facility',lab_facility,'evaluation_status',CASE WHEN head_status='cancelled' THEN NULL ELSE evaluation_status END) AS item
  FROM observations
 ) SELECT COALESCE(jsonb_agg(item ORDER BY key COLLATE "C"),'[]'::jsonb),COALESCE(bool_or(broken),false) INTO rows,invalid FROM rendered;
 IF invalid THEN RAISE EXCEPTION USING ERRCODE='22000',MESSAGE='Laboratory source history is inconsistent'; END IF;
 signature:=encode(sha256(convert_to(jsonb_build_object('actor_id',actor,'patient_ids',patients,'items',rows)::text,'UTF8')),'hex');
 IF p_snapshot IS NOT NULL AND signature<>p_snapshot THEN
  RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Laboratory projection changed; restart the complete read';
 END IF;
 WITH candidates AS(SELECT item FROM jsonb_array_elements(rows) item WHERE p_after IS NULL OR (item->>'id') COLLATE "C">p_after COLLATE "C"
  ORDER BY (item->>'id') COLLATE "C" LIMIT 251), visible AS(SELECT item FROM candidates ORDER BY (item->>'id') COLLATE "C" LIMIT 250)
 SELECT jsonb_build_object('actor_id',actor,'patient_ids',patients,'snapshot',signature,
  'items',COALESCE((SELECT jsonb_agg(item ORDER BY (item->>'id') COLLATE "C") FROM visible),'[]'::jsonb),
  'next_cursor',CASE WHEN(SELECT count(*) FROM candidates)>250 THEN(SELECT item->>'id' FROM visible ORDER BY (item->>'id') COLLATE "C" DESC LIMIT 1) ELSE NULL END)
 INTO page;
 RETURN page;
END $$;
REVOKE ALL ON FUNCTION public.get_effective_lab_observations(uuid[],text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_effective_lab_observations(uuid[],text,text) TO authenticated;
