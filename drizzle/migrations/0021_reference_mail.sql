-- Referenzmail: the mail goes out, the lead is completed, and NO deal is created.
--  The original caller is remembered permanently (lead_crm_links.origin_caller_id).
--  A reply to the mail sends the lead back to that caller (callback due immediately).
--  No reply within 3 months: the lead shows up in an admin list (with the caller id) and can be downloaded.

ALTER TABLE public.lead_emails ADD COLUMN replied_at timestamptz;
CREATE INDEX lead_emails_reply_idx ON public.lead_emails(lower(to_email)) WHERE kind='reference_mail' AND replied_at IS NULL;

CREATE OR REPLACE FUNCTION public.record_lead_action(
  p_request_id uuid, p_lead_id uuid, p_expected_version integer, p_action text,
  p_note text DEFAULT NULL, p_scheduled_at timestamptz DEFAULT NULL,
  p_logo_path text DEFAULT NULL, p_details jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 a uuid:=app_private.actor();
 note text:=nullif(btrim(p_note),'');
 payload jsonb;
 r jsonb;
 l public.leads%ROWTYPE;
 bt public.lead_batches%ROWTYPE;
 new_status text;
 stage text;
 aid uuid;
 cb uuid;
 appt uuid;
 appt_owner uuid;
 sync text;
 eid uuid;
 photo text;
 dnc boolean:=false;
 mth text;
 cur_month date:=date_trunc('month',(now() AT TIME ZONE 'Europe/Vienna'))::date;
 erased boolean:=false;
 stored jsonb:=p_details;
BEGIN
 IF p_action IS NULL OR p_action NOT IN ('low_q','high_q','waiting_3d','no_interest','on_hold','callback','reference_mail','not_reached') THEN
  RAISE EXCEPTION 'validation_failed' USING ERRCODE='22023';
 END IF;
 payload:=jsonb_build_array(p_lead_id,p_expected_version,p_action,note,p_scheduled_at,p_logo_path,p_details);
 r:=app_private.request('lead_action',p_request_id,payload); IF r IS NOT NULL THEN RETURN r; END IF;
 IF length(coalesce(note,''))>10000 THEN RAISE EXCEPTION 'note_too_long' USING ERRCODE='22023'; END IF;
 IF p_details IS NOT NULL AND (jsonb_typeof(p_details)<>'object' OR octet_length(p_details::text)>20000
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_details) k WHERE k NOT IN ('email_id','template','photo_path','month','do_not_call'))) THEN
  RAISE EXCEPTION 'validation_failed' USING ERRCODE='22023';
 END IF;

 SELECT * INTO l FROM public.leads WHERE id=p_lead_id AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'lead_not_found' USING ERRCODE='P0002'; END IF;
 IF l.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'stale_lead' USING ERRCODE='40001'; END IF;
 SELECT * INTO bt FROM public.lead_batches WHERE id=l.batch_id;
 IF NOT public.can_access_country(bt.country) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 IF NOT (public.has_admin_rights(a,bt.country) OR bt.assigned_to IS NOT DISTINCT FROM a OR l.last_called_by IS NOT DISTINCT FROM a) THEN
  RAISE EXCEPTION 'not_your_lead' USING ERRCODE='42501';
 END IF;
 IF EXISTS(SELECT 1 FROM public.lead_claims WHERE lead_id=l.id AND expires_at>now() AND user_id<>a) THEN
  RAISE EXCEPTION 'lead_claimed' USING ERRCODE='40001';
 END IF;

 -- Required inputs per action.
 IF p_action IN ('low_q','high_q') THEN
  IF note IS NULL THEN RAISE EXCEPTION 'note_required' USING ERRCODE='22023'; END IF;
  IF p_logo_path IS NULL OR p_logo_path NOT LIKE a::text||'/'||l.id::text||'/%' OR length(p_logo_path)>500 THEN
   RAISE EXCEPTION 'logo_required' USING ERRCODE='22023';
  END IF;
  IF p_scheduled_at IS NULL OR NOT pg_catalog.isfinite(p_scheduled_at) OR p_scheduled_at<=now() THEN
   RAISE EXCEPTION 'appointment_required' USING ERRCODE='22023';
  END IF;
 END IF;
 IF p_action='high_q' THEN
  photo:=p_details->>'photo_path';
  IF photo IS NULL OR photo NOT LIKE a::text||'/'||l.id::text||'/%' OR length(photo)>500 THEN
   RAISE EXCEPTION 'photo_required' USING ERRCODE='22023';
  END IF;
 END IF;
 IF p_action='waiting_3d' THEN
  IF note IS NULL THEN RAISE EXCEPTION 'note_required' USING ERRCODE='22023'; END IF;
  IF p_scheduled_at IS NOT NULL AND (NOT pg_catalog.isfinite(p_scheduled_at) OR p_scheduled_at<=now()) THEN
   RAISE EXCEPTION 'invalid_schedule' USING ERRCODE='22023';
  END IF;
 END IF;
 IF p_action='callback' AND (p_scheduled_at IS NULL OR NOT pg_catalog.isfinite(p_scheduled_at) OR p_scheduled_at<=now()) THEN
  RAISE EXCEPTION 'invalid_schedule' USING ERRCODE='22023';
 END IF;
 IF p_action='on_hold' THEN
  IF note IS NULL THEN RAISE EXCEPTION 'note_required' USING ERRCODE='22023'; END IF;
  mth:=p_details->>'month';
  IF mth IS NULL OR mth !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' OR (mth||'-01')::date<cur_month OR (mth||'-01')::date>cur_month+interval '10 years' THEN
   RAISE EXCEPTION 'invalid_month' USING ERRCODE='22023';
  END IF;
 END IF;
 IF p_action='no_interest' THEN
  dnc:=coalesce((p_details->>'do_not_call')::boolean,false);
  stored:=CASE WHEN dnc THEN NULL ELSE p_details END;
 END IF;
 -- Mails must have been sent (or simulated in test mode) before the lead may move on.
 IF p_action='reference_mail' THEN
  IF p_details IS NULL THEN RAISE EXCEPTION 'validation_failed' USING ERRCODE='22023'; END IF;
  BEGIN eid:=nullif(p_details->>'email_id','')::uuid; EXCEPTION WHEN others THEN eid:=NULL; END;
  IF eid IS NULL OR NOT EXISTS(SELECT 1 FROM public.lead_emails e WHERE e.id=eid AND e.lead_id=l.id AND e.created_by=a AND e.kind='reference_mail' AND e.status IN ('sent','simulated')) THEN
   RAISE EXCEPTION 'email_not_sent' USING ERRCODE='22023';
  END IF;
 END IF;

 new_status:=CASE p_action WHEN 'not_reached' THEN 'open' ELSE p_action END;
 -- On hold and the reference mail have no CRM stage: no deal is created for them.
 stage:=CASE WHEN p_action IN ('low_q','high_q','waiting_3d') THEN p_action END;
 sync:=CASE WHEN stage IS NULL THEN NULL ELSE 'queued' END;

 UPDATE public.leads SET status=new_status,attempts=attempts+1,last_called_at=now(),last_called_by=a WHERE id=l.id;
 INSERT INTO public.status_changes(lead_id,user_id,old_status,new_status) VALUES(l.id,a,l.status,
  CASE WHEN p_action='not_reached' THEN 'not_reached' ELSE new_status END);
 -- A recorded outcome replaces earlier open callbacks of this lead.
 UPDATE public.callbacks SET done=true WHERE lead_id=l.id AND NOT done;

 IF p_action IN ('callback','waiting_3d') AND p_scheduled_at IS NOT NULL THEN
  INSERT INTO public.callbacks(lead_id,user_id,due_at,country) VALUES(l.id,a,p_scheduled_at,bt.country) RETURNING id INTO cb;
 END IF;
 IF p_action IN ('low_q','high_q') THEN
  appt_owner:=app_private.appointment_owner(a,bt.country);
  INSERT INTO public.appointments(user_id,lead_id,starts_at,notes,title,kind,country,booked_by)
   VALUES(appt_owner,l.id,p_scheduled_at,note,
    CASE WHEN p_action='low_q' THEN 'Logo Render: ' ELSE 'Realismus Render: ' END||coalesce(l.company,'Lead'),'presentation',bt.country,a)
   RETURNING id INTO appt;
 END IF;
 IF note IS NOT NULL THEN INSERT INTO public.lead_notes(lead_id,user_id,body) VALUES(l.id,a,note); END IF;
 DELETE FROM public.lead_claims WHERE lead_id=l.id AND user_id=a;

 INSERT INTO public.lead_actions(lead_id,user_id,action,note,stage_key,crm_sync_state,logo_path,scheduled_at,details)
  VALUES(l.id,a,p_action,note,stage,sync,CASE WHEN p_action IN ('low_q','high_q') THEN p_logo_path END,p_scheduled_at,stored)
  RETURNING id INTO aid;
 IF stage IS NOT NULL OR p_action IN ('on_hold','reference_mail') THEN
  -- The first caller with a CRM-relevant action becomes the permanent original caller of this lead.
  INSERT INTO public.lead_crm_links(lead_id,country,origin_caller_id,origin_lead_id) VALUES(l.id,bt.country,a,l.id)
   ON CONFLICT (lead_id) DO UPDATE SET origin_caller_id=coalesce(public.lead_crm_links.origin_caller_id,a),updated_at=now();
 END IF;
 INSERT INTO public.audit_events(actor,action,target_id) VALUES(a,'lead_action:'||p_action,l.id);

 IF p_action='no_interest' AND dnc THEN
  -- "Do not call again": the personal data is erased. The empty shell stays so statistics keep their counts.
  UPDATE public.leads SET company=NULL,contact_name=NULL,phone=NULL,email=NULL,city=NULL,extra='{}'::jsonb,archived_at=now(),erased_at=now() WHERE id=l.id;
  DELETE FROM public.lead_notes WHERE lead_id=l.id;
  DELETE FROM public.lead_emails WHERE lead_id=l.id;
  DELETE FROM public.callbacks WHERE lead_id=l.id;
  UPDATE public.lead_actions SET note=NULL,details=NULL,logo_path=NULL WHERE lead_id=l.id;
  INSERT INTO public.audit_events(actor,action,target_id) VALUES(a,'lead_erased',l.id);
  erased:=true;
 END IF;

 RETURN app_private.finish('lead_action',p_request_id,payload,jsonb_build_object(
  'lead_id',l.id,'action_id',aid,'action',p_action,'status',new_status,'version',l.version+1,'attempts',l.attempts+1,
  'callback_id',cb,'appointment_id',appt,'appointment_owner',appt_owner,'stage_key',stage,'crm_sync_state',sync,'erased',erased));
END $$;
REVOKE ALL ON FUNCTION public.record_lead_action(uuid,uuid,integer,text,text,timestamptz,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_lead_action(uuid,uuid,integer,text,text,timestamptz,text,jsonb) TO authenticated;

-- A reply arrived: the lead goes back to the original caller, who gets it as a callback that is due now.
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
 -- A caller has at most one callback per minute: several replies at once take earlier free minutes, so all are due now.
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
REVOKE ALL ON FUNCTION app_private.apply_reference_reply(uuid) FROM PUBLIC,anon,authenticated;

-- Called by the inbound-mail endpoint with the sender and the message ids the reply refers to.
-- Matches on the id of the sent mail first, then on the recipient address of an unanswered reference mail.
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

-- Admin area: reference mails without a reply for 3 months. Each row carries the id of the original caller,
-- so the lead can be given back to the same caller.
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
