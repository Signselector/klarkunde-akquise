CREATE OR REPLACE FUNCTION public.record_lead_action(p_request_id uuid, p_lead_id uuid, p_expected_version integer, p_action text, p_note text DEFAULT NULL::text, p_scheduled_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_logo_path text DEFAULT NULL::text, p_details jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 IF p_details IS NOT NULL AND (jsonb_typeof(p_details)<>'object' OR octet_length(p_details::text)>200000
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_details) k WHERE k NOT IN ('email_id','template','photo_path','month','do_not_call','self_assign','extra_logo_paths','extra_photo_paths','dimensions'))) THEN
  RAISE EXCEPTION 'validation_failed' USING ERRCODE='22023';
 END IF;
 IF p_details IS NOT NULL AND EXISTS(
   SELECT 1 FROM unnest(ARRAY['extra_logo_paths','extra_photo_paths']) k
   WHERE p_details ? k AND (jsonb_typeof(p_details->k)<>'array' OR EXISTS(
     SELECT 1 FROM jsonb_array_elements(p_details->k) e
     WHERE jsonb_typeof(e)<>'string' OR length(e#>>'{}')>500
       OR (e#>>'{}') NOT LIKE app_private.actor()::text||'/'||p_lead_id::text||'/%')))
 THEN RAISE EXCEPTION 'validation_failed' USING ERRCODE='22023'; END IF;

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
 IF p_action='reference_mail' THEN
  IF p_details IS NULL THEN RAISE EXCEPTION 'validation_failed' USING ERRCODE='22023'; END IF;
  BEGIN eid:=nullif(p_details->>'email_id','')::uuid; EXCEPTION WHEN others THEN eid:=NULL; END;
  IF eid IS NULL OR NOT EXISTS(SELECT 1 FROM public.lead_emails e WHERE e.id=eid AND e.lead_id=l.id AND e.created_by=a AND e.kind='reference_mail' AND e.status IN ('sent','simulated')) THEN
   RAISE EXCEPTION 'email_not_sent' USING ERRCODE='22023';
  END IF;
 END IF;

 new_status:=CASE WHEN p_action='not_reached' THEN 'open' WHEN p_action='reference_mail' AND p_scheduled_at IS NOT NULL THEN 'callback' ELSE p_action END;
 stage:=CASE WHEN p_action IN ('low_q','high_q','waiting_3d') THEN p_action END;
 sync:=CASE WHEN stage IS NULL THEN NULL ELSE 'queued' END;

 UPDATE public.leads SET status=new_status,attempts=attempts+1,last_called_at=now(),last_called_by=a WHERE id=l.id;
 INSERT INTO public.status_changes(lead_id,user_id,old_status,new_status) VALUES(l.id,a,l.status,
  CASE WHEN p_action='not_reached' THEN 'not_reached' ELSE new_status END);
 UPDATE public.callbacks SET done=true WHERE lead_id=l.id AND NOT done;

 IF p_action='reference_mail' AND p_scheduled_at IS NOT NULL AND (NOT pg_catalog.isfinite(p_scheduled_at) OR p_scheduled_at<=now()) THEN
  RAISE EXCEPTION 'invalid_schedule' USING ERRCODE='22023';
 END IF;
 IF p_action IN ('callback','waiting_3d','reference_mail') AND p_scheduled_at IS NOT NULL THEN
  INSERT INTO public.callbacks(lead_id,user_id,due_at,country) VALUES(l.id,a,p_scheduled_at,bt.country) RETURNING id INTO cb;
 END IF;
 IF p_action IN ('low_q','high_q') THEN
  appt_owner:=app_private.appointment_owner(a,bt.country,coalesce((p_details->>'self_assign')::boolean,false));
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
  INSERT INTO public.lead_crm_links(lead_id,country,origin_caller_id,origin_lead_id) VALUES(l.id,bt.country,a,l.id)
   ON CONFLICT (lead_id) DO UPDATE SET origin_caller_id=coalesce(public.lead_crm_links.origin_caller_id,a),updated_at=now();
 END IF;
 INSERT INTO public.audit_events(actor,action,target_id) VALUES(a,'lead_action:'||p_action,l.id);

 IF p_action='no_interest' AND dnc THEN
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
END $function$;

CREATE OR REPLACE FUNCTION public.crm_match_reference_deal(p_country text, p_deal bigint, p_emails text[] DEFAULT '{}'::text[], p_phones text[] DEFAULT '{}'::text[])
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
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
 -- Reference-mail leads, also those the caller coupled with a callback (status 'callback').
 SELECT l2.* INTO l FROM public.leads l2 JOIN public.lead_batches b ON b.id=l2.batch_id
  LEFT JOIN public.lead_crm_links k ON k.lead_id=l2.id
  WHERE b.country=p_country AND l2.archived_at IS NULL AND k.deal_id IS NULL
    AND (l2.status='reference_mail' OR (l2.status='callback' AND EXISTS(SELECT 1 FROM public.lead_emails r
         WHERE r.lead_id=l2.id AND r.kind='reference_mail' AND r.status IN ('sent','simulated'))))
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
END $function$;

-- One click in "Referenzmail ohne Antwort": leads go back to their original caller (active)
-- or into one unassigned collection batch per country and month (deactivated caller).
CREATE OR REPLACE FUNCTION public.requeue_reference_leads(p_lead_ids uuid[])
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE a uuid:=app_private.actor(); r record; target uuid; nm text;
 mon text:=to_char(now() AT TIME ZONE 'Europe/Vienna','MM/YYYY');
 n_caller int:=0; n_batch int:=0;
BEGIN
 IF a IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 IF coalesce(array_length(p_lead_ids,1),0)=0 OR array_length(p_lead_ids,1)>5000 THEN
  RAISE EXCEPTION 'validation_failed' USING ERRCODE='22023';
 END IF;
 FOR r IN
  SELECT l.id, l.status, l.batch_id, b.country, b.assigned_to,
         coalesce(k.origin_caller_id, m.created_by, l.last_called_by) origin
  FROM public.leads l
  JOIN public.lead_batches b ON b.id=l.batch_id
  JOIN LATERAL (SELECT e.* FROM public.lead_emails e WHERE e.lead_id=l.id AND e.kind='reference_mail' AND e.status IN ('sent','simulated')
                ORDER BY e.sent_at DESC NULLS LAST LIMIT 1) m ON true
  LEFT JOIN public.lead_crm_links k ON k.lead_id=l.id
  WHERE l.id=ANY(p_lead_ids) AND l.status='reference_mail' AND l.archived_at IS NULL
    AND m.replied_at IS NULL AND k.deal_id IS NULL AND m.sent_at<=now()-interval '3 months'
  FOR UPDATE OF l
 LOOP
  IF NOT public.has_admin_rights(a,r.country) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF r.origin IS NOT NULL AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=r.origin AND p.active) THEN
   IF r.assigned_to IS NOT DISTINCT FROM r.origin THEN
    target:=r.batch_id;
   ELSE
    SELECT coalesce(p.display_name,p.email,'Caller') INTO nm FROM public.profiles p WHERE p.id=r.origin;
    nm:='Referenzmail Neuverteilung '||mon||' – '||nm;
    target:=NULL;
    SELECT id INTO target FROM public.lead_batches WHERE country=r.country AND name=nm AND assigned_to=r.origin LIMIT 1;
    IF target IS NULL THEN
     INSERT INTO public.lead_batches(name,created_by,import_state,country,assigned_to,assigned_at)
      VALUES(nm,a,'confirmed',r.country,r.origin,now()) RETURNING id INTO target;
    END IF;
   END IF;
   n_caller:=n_caller+1;
  ELSE
   nm:='Referenzmail Neuverteilung '||mon;
   target:=NULL;
   SELECT id INTO target FROM public.lead_batches WHERE country=r.country AND name=nm AND assigned_to IS NULL LIMIT 1;
   IF target IS NULL THEN
    INSERT INTO public.lead_batches(name,created_by,import_state,country)
     VALUES(nm,a,'confirmed',r.country) RETURNING id INTO target;
   END IF;
   n_batch:=n_batch+1;
  END IF;
  UPDATE public.leads SET status='open', batch_id=target WHERE id=r.id;
  INSERT INTO public.status_changes(lead_id,user_id,old_status,new_status) VALUES(r.id,a,r.status,'open');
  INSERT INTO public.lead_notes(lead_id,user_id,body) VALUES(r.id,a,'Referenzmail seit 3 Monaten ohne Antwort – neu eingespielt.');
  DELETE FROM public.lead_claims WHERE lead_id=r.id;
  INSERT INTO public.audit_events(actor,action,target_id) VALUES(a,'reference_requeue',r.id);
 END LOOP;
 RETURN jsonb_build_object('to_callers',n_caller,'to_new_batch',n_batch);
END $function$;
REVOKE ALL ON FUNCTION public.requeue_reference_leads(uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.requeue_reference_leads(uuid[]) TO authenticated;

-- Existing reference-mail leads that already have an open callback are led as callback.
WITH s AS (
 UPDATE public.leads l SET status='callback'
 WHERE l.status='reference_mail' AND l.archived_at IS NULL
   AND EXISTS(SELECT 1 FROM public.callbacks c WHERE c.lead_id=l.id AND NOT c.done)
 RETURNING l.id, l.last_called_by)
INSERT INTO public.status_changes(lead_id,user_id,old_status,new_status)
 SELECT id,last_called_by,'reference_mail','callback' FROM s;
