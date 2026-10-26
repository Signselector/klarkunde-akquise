ALTER TABLE public.lead_emails ADD COLUMN replied_at timestamptz;
CREATE INDEX lead_emails_reply_idx ON public.lead_emails(lower(to_email)) WHERE kind='reference_mail' AND replied_at IS NULL;

-- Reference mail creates no deal, but still records the original caller.
DO $$
DECLARE def text; fixed text;
BEGIN
  def:=pg_get_functiondef('public.record_lead_action(uuid,uuid,integer,text,text,timestamptz,text,jsonb)'::regprocedure);
  fixed:=replace(def,'IN (''low_q'',''high_q'',''waiting_3d'',''reference_mail'') THEN p_action END','IN (''low_q'',''high_q'',''waiting_3d'') THEN p_action END');
  fixed:=replace(fixed,'OR p_action=''on_hold'' THEN','OR p_action IN (''on_hold'',''reference_mail'') THEN');
  IF fixed=def THEN RAISE EXCEPTION 'record_lead_action not patched'; END IF;
  EXECUTE fixed;
END $$;

CREATE FUNCTION app_private.apply_reference_reply(_email uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.lead_emails%ROWTYPE; l public.leads%ROWTYPE; bt public.lead_batches%ROWTYPE; origin uuid; due timestamptz:=date_trunc('minute',now()); n integer:=0;
BEGIN
 SELECT * INTO e FROM public.lead_emails WHERE id=_email FOR UPDATE;
 IF NOT FOUND OR e.replied_at IS NOT NULL THEN RETURN jsonb_build_object('matched',false); END IF;
 SELECT * INTO l FROM public.leads WHERE id=e.lead_id AND archived_at IS NULL AND status='reference_mail' FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('matched',false); END IF;
 SELECT * INTO bt FROM public.lead_batches WHERE id=l.batch_id;
 origin:=coalesce((SELECT k.origin_caller_id FROM public.lead_crm_links k WHERE k.lead_id=l.id), e.created_by);
 UPDATE public.lead_emails SET replied_at=now() WHERE id=e.id;
 UPDATE public.leads SET status='callback',last_called_by=origin WHERE id=l.id;
 INSERT INTO public.status_changes(lead_id,user_id,old_status,new_status) VALUES(l.id,origin,l.status,'callback');
 UPDATE public.callbacks SET done=true WHERE lead_id=l.id AND NOT done;
 WHILE n<240 AND EXISTS(SELECT 1 FROM public.callbacks c WHERE c.user_id=origin AND NOT c.done
   AND floor(extract(epoch FROM c.due_at)/60)=floor(extract(epoch FROM due)/60)) LOOP
  due:=due-interval '1 minute'; n:=n+1;
 END LOOP;
 INSERT INTO public.callbacks(lead_id,user_id,due_at,country) VALUES(l.id,origin,due,bt.country);
 PERFORM app_private.log_activity(l.id,'reference_reply',origin,'cold_caller',NULL,NULL,NULL,'reply:'||e.id,
  jsonb_build_object('email_id',e.id),now());
 INSERT INTO public.audit_events(actor,action,target_id) VALUES(origin,'reference_mail_reply',l.id);
 RETURN jsonb_build_object('matched',true,'lead_id',l.id,'assigned_to',origin);
END $$;
REVOKE ALL ON FUNCTION app_private.apply_reference_reply(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION app_private.apply_reference_reply(uuid) TO service_role;

CREATE FUNCTION public.register_reference_reply(p_from text, p_refs text[] DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE eid uuid; sender text:=lower(btrim(coalesce(p_from,'')));
BEGIN
 IF sender='' AND coalesce(array_length(p_refs,1),0)=0 THEN RETURN jsonb_build_object('matched',false); END IF;
 SELECT e.id INTO eid FROM public.lead_emails e JOIN public.leads l ON l.id=e.lead_id
  WHERE e.kind='reference_mail' AND e.status IN ('sent','simulated') AND e.replied_at IS NULL
    AND l.status='reference_mail' AND l.archived_at IS NULL
    AND ((e.provider_message_id IS NOT NULL AND e.provider_message_id=ANY(p_refs)) OR lower(e.to_email)=sender)
  ORDER BY (e.provider_message_id IS NOT NULL AND e.provider_message_id=ANY(p_refs)) DESC, e.sent_at DESC NULLS LAST LIMIT 1;
 IF eid IS NULL THEN RETURN jsonb_build_object('matched',false); END IF;
 RETURN app_private.apply_reference_reply(eid);
END $$;
REVOKE ALL ON FUNCTION public.register_reference_reply(text,text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.register_reference_reply(text,text[]) TO service_role;

CREATE FUNCTION public.get_unanswered_reference_leads(p_country text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor();
BEGIN
 IF NOT public.has_admin_rights(a,p_country) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 RETURN coalesce((SELECT jsonb_agg(x ORDER BY (x->>'sent_at') DESC) FROM (
  SELECT jsonb_build_object(
   'lead_id',l.id,'company',l.company,'contact_name',l.contact_name,'phone',l.phone,'email',l.email,'city',l.city,'extra',l.extra,
   'batch',b.name,
   'caller_id',oc.id,'caller',oc.display_name,
   'mail_to',m.to_email,'subject',m.subject,'sent_at',m.sent_at) x
  FROM public.leads l
  JOIN public.lead_batches b ON b.id=l.batch_id
  JOIN LATERAL (SELECT e.* FROM public.lead_emails e WHERE e.lead_id=l.id AND e.kind='reference_mail' AND e.status IN ('sent','simulated')
                ORDER BY e.sent_at DESC NULLS LAST LIMIT 1) m ON true
  LEFT JOIN public.lead_crm_links k ON k.lead_id=l.id
  LEFT JOIN public.profiles oc ON oc.id=coalesce(k.origin_caller_id,m.created_by)
  WHERE b.country=p_country AND l.status='reference_mail' AND l.archived_at IS NULL AND m.replied_at IS NULL
    AND m.sent_at<=now()-interval '3 months') s),'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.get_unanswered_reference_leads(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_unanswered_reference_leads(text) TO authenticated;