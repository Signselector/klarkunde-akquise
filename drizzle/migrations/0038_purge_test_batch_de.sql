CREATE OR REPLACE FUNCTION public.get_batch_crm_objects(p_batch_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE b public.lead_batches%ROWTYPE;
BEGIN
 IF NOT public.is_global_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO b FROM public.lead_batches WHERE id=p_batch_id;
 IF b.id IS NULL OR b.country NOT IN ('AT','DE') THEN RAISE EXCEPTION 'only_at_de_batches' USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object(
  'country', b.country,
  'deals', coalesce((SELECT jsonb_agg(DISTINCT k.deal_id) FROM public.lead_crm_links k JOIN public.leads l ON l.id=k.lead_id WHERE l.batch_id=p_batch_id AND k.deal_id IS NOT NULL AND k.deal_id > 0),'[]'),
  'persons', coalesce((SELECT jsonb_agg(DISTINCT k.person_id) FROM public.lead_crm_links k JOIN public.leads l ON l.id=k.lead_id WHERE l.batch_id=p_batch_id AND k.person_id IS NOT NULL AND k.person_id > 0),'[]'),
  'orgs', coalesce((SELECT jsonb_agg(DISTINCT k.organization_id) FROM public.lead_crm_links k JOIN public.leads l ON l.id=k.lead_id WHERE l.batch_id=p_batch_id AND k.organization_id IS NOT NULL AND k.organization_id > 0),'[]'),
  'activities', coalesce((SELECT jsonb_agg(DISTINCT x) FROM (
     SELECT a.pd_activity_id x FROM public.appointments a JOIN public.leads l ON l.id=a.lead_id WHERE l.batch_id=p_batch_id AND a.pd_activity_id IS NOT NULL
     UNION SELECT c.pd_activity_id FROM public.callbacks c JOIN public.leads l ON l.id=c.lead_id WHERE l.batch_id=p_batch_id AND c.pd_activity_id IS NOT NULL) s),'[]'));
END $function$;

CREATE OR REPLACE FUNCTION public.purge_test_batch(p_batch_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE b public.lead_batches%ROWTYPE; ids uuid[]; n int;
BEGIN
 IF NOT public.is_global_admin(auth.uid()) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO b FROM public.lead_batches WHERE id=p_batch_id FOR UPDATE;
 IF b.id IS NULL OR b.country NOT IN ('AT','DE') THEN RAISE EXCEPTION 'only_at_de_batches' USING ERRCODE='22023'; END IF;
 SELECT coalesce(array_agg(id),'{}') INTO ids FROM public.leads WHERE batch_id=p_batch_id;
 n := cardinality(ids);
 PERFORM set_config('app.purge','on',true);
 DELETE FROM public.pd_calendar_queue WHERE activity_id IN (SELECT pd_activity_id FROM public.appointments WHERE lead_id = ANY(ids) AND pd_activity_id IS NOT NULL);
 DELETE FROM public.integration_jobs WHERE lead_id = ANY(ids);
 DELETE FROM public.status_changes WHERE lead_id = ANY(ids);
 DELETE FROM public.lead_activity WHERE lead_id = ANY(ids);
 DELETE FROM public.lead_actions WHERE lead_id = ANY(ids);
 DELETE FROM public.lead_emails WHERE lead_id = ANY(ids);
 DELETE FROM public.lead_notes WHERE lead_id = ANY(ids);
 DELETE FROM public.lead_claims WHERE lead_id = ANY(ids);
 DELETE FROM public.lead_crm_links WHERE lead_id = ANY(ids);
 DELETE FROM public.quality_resolutions WHERE lead_id = ANY(ids);
 DELETE FROM public.callbacks WHERE lead_id = ANY(ids);
 DELETE FROM public.appointments WHERE lead_id = ANY(ids);
 DELETE FROM public.pd_calendar_queue WHERE country=b.country AND created_at > now() - interval '1 second' AND action='delete';
 DELETE FROM public.points_ledger WHERE source_id = ANY(ids);
 DELETE FROM public.coins_ledger WHERE source_id = ANY(ids);
 DELETE FROM public.leads WHERE id = ANY(ids);
 DELETE FROM public.import_rows WHERE batch_id=p_batch_id;
 DELETE FROM public.lead_batches WHERE id=p_batch_id;
 PERFORM set_config('app.purge','off',true);
 INSERT INTO public.audit_events(actor,action,target_id) VALUES(auth.uid(),'purge_test_batch',p_batch_id);
 RETURN jsonb_build_object('leads',n);
END $function$;