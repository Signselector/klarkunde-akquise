CREATE OR REPLACE FUNCTION public.crm_match_reference_deal(p_country text, p_deal bigint, p_emails text[] DEFAULT '{}', p_phones text[] DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l public.leads%ROWTYPE; e public.lead_emails%ROWTYPE; origin uuid;
 mails text[]; tails text[];
BEGIN
 IF p_deal IS NULL OR EXISTS(SELECT 1 FROM public.lead_crm_links WHERE country=p_country AND deal_id=p_deal) THEN
  RETURN jsonb_build_object('matched',false,'reason','known_deal');
 END IF;
 SELECT coalesce(array_agg(DISTINCT lower(btrim(x))),'{}') INTO mails FROM unnest(coalesce(p_emails,'{}')) x WHERE btrim(x)<>'';
 SELECT coalesce(array_agg(DISTINCT right(regexp_replace(x,'\D','','g'),9)),'{}') INTO tails
  FROM unnest(coalesce(p_phones,'{}')) x WHERE length(regexp_replace(x,'\D','','g'))>=7;
 IF coalesce(array_length(mails,1),0)=0 AND coalesce(array_length(tails,1),0)=0 THEN
  RETURN jsonb_build_object('matched',false,'reason','no_contact');
 END IF;
 SELECT l2.* INTO l FROM public.leads l2 JOIN public.lead_batches b ON b.id=l2.batch_id
  LEFT JOIN public.lead_crm_links k ON k.lead_id=l2.id
  WHERE b.country=p_country AND l2.status='reference_mail' AND l2.archived_at IS NULL AND k.deal_id IS NULL
    AND ((l2.email IS NOT NULL AND lower(btrim(l2.email))=ANY(mails))
      OR (l2.phone IS NOT NULL AND length(regexp_replace(l2.phone,'\D','','g'))>=7 AND right(regexp_replace(l2.phone,'\D','','g'),9)=ANY(tails))
      OR EXISTS(SELECT 1 FROM public.lead_emails m WHERE m.lead_id=l2.id AND m.kind='reference_mail' AND lower(m.to_email)=ANY(mails)))
  ORDER BY l2.last_called_at DESC NULLS LAST LIMIT 1 FOR UPDATE OF l2;
 IF NOT FOUND THEN RETURN jsonb_build_object('matched',false,'reason','no_lead'); END IF;
 SELECT * INTO e FROM public.lead_emails WHERE lead_id=l.id AND kind='reference_mail' AND status IN ('sent','simulated') ORDER BY sent_at DESC NULLS LAST LIMIT 1;
 origin:=coalesce((SELECT k.origin_caller_id FROM public.lead_crm_links k WHERE k.lead_id=l.id), e.created_by, l.last_called_by);
 INSERT INTO public.lead_crm_links(lead_id,country,origin_caller_id,origin_lead_id,deal_id,current_stage_key,is_customer,sync_state,last_synced_at)
  VALUES(l.id,p_country,origin,l.id,p_deal,'reference_mail',true,'synced',now())
  ON CONFLICT (lead_id) DO UPDATE SET deal_id=EXCLUDED.deal_id,is_customer=true,
   origin_caller_id=coalesce(public.lead_crm_links.origin_caller_id,EXCLUDED.origin_caller_id),
   sync_state='synced',last_synced_at=now(),updated_at=now();
 IF e.id IS NOT NULL THEN UPDATE public.lead_emails SET replied_at=coalesce(replied_at,now()) WHERE id=e.id; END IF;
 PERFORM app_private.log_activity(l.id,'customer_assigned',origin,'pipedrive','reference_mail',NULL,p_deal,
  'refdeal:'||p_country||':'||p_deal,jsonb_build_object('via','reference_mail'),now(),'Pipedrive');
 INSERT INTO public.audit_events(actor,action,target_id) VALUES(origin,'reference_mail_deal',l.id);
 RETURN jsonb_build_object('matched',true,'lead_id',l.id,'origin_caller_id',origin);
END $$;
REVOKE ALL ON FUNCTION public.crm_match_reference_deal(text,bigint,text[],text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_match_reference_deal(text,bigint,text[],text[]) TO service_role;