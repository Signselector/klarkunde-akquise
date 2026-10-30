CREATE OR REPLACE FUNCTION public.crm_save_links(
  p_lead uuid, p_country text, p_org bigint, p_person bigint, p_deal bigint,
  p_origin uuid, p_stage_key text, p_actor uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE k public.lead_crm_links%ROWTYPE; created boolean:=false; flip boolean:=false;
BEGIN
 INSERT INTO public.lead_crm_links(lead_id,country,origin_caller_id,origin_lead_id,organization_id,person_id)
  VALUES(p_lead,p_country,p_origin,p_lead,p_org,p_person)
  ON CONFLICT (lead_id) DO UPDATE SET
   organization_id=coalesce(public.lead_crm_links.organization_id,EXCLUDED.organization_id),
   person_id=coalesce(public.lead_crm_links.person_id,EXCLUDED.person_id),
   origin_caller_id=coalesce(public.lead_crm_links.origin_caller_id,EXCLUDED.origin_caller_id),
   updated_at=now();
 SELECT * INTO k FROM public.lead_crm_links WHERE lead_id=p_lead FOR UPDATE;
 IF p_deal IS NOT NULL AND (k.deal_id IS NULL OR (k.deal_id=p_deal AND k.current_stage_key IS NULL)) THEN
  flip:=p_stage_key=ANY(app_private.customer_stage_keys());
  UPDATE public.lead_crm_links SET deal_id=p_deal,current_stage_key=p_stage_key,is_customer=is_customer OR flip,
   sync_state='synced',last_synced_at=now(),updated_at=now() WHERE lead_id=p_lead;
  created:=true;
  PERFORM app_private.log_activity(p_lead,'deal_created',p_actor,'cold_caller',NULL,p_stage_key,p_deal,'deal:'||p_country||':'||p_deal);
  IF flip THEN PERFORM app_private.log_activity(p_lead,'customer_assigned',p_actor,'cold_caller',NULL,p_stage_key,p_deal,'customer:'||p_country||':'||p_deal); END IF;
 END IF;
 RETURN jsonb_build_object('deal_created',created,'origin_caller_id',k.origin_caller_id);
END $$;

-- Backfill deals created while the bug was active
UPDATE public.lead_crm_links k SET
  current_stage_key=a.stage_key,
  is_customer=k.is_customer OR a.stage_key=ANY(app_private.customer_stage_keys()),
  origin_caller_id=coalesce(k.origin_caller_id,a.user_id),
  sync_state='synced', last_synced_at=coalesce(k.last_synced_at,now()), updated_at=now()
FROM (SELECT DISTINCT ON (lead_id) lead_id, stage_key, user_id FROM public.lead_actions
      WHERE crm_sync_state='synced' AND stage_key IS NOT NULL ORDER BY lead_id, created_at DESC) a
WHERE a.lead_id=k.lead_id AND k.deal_id IS NOT NULL AND k.current_stage_key IS NULL;
