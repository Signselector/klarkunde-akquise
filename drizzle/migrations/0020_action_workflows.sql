ALTER TABLE public.appointments ADD COLUMN booked_by uuid;
ALTER TABLE public.lead_actions DROP CONSTRAINT IF EXISTS lead_actions_action_check;
ALTER TABLE public.lead_actions ADD CONSTRAINT lead_actions_action_check CHECK (action IN
  ('low_q','high_q','waiting_3d','no_interest','on_hold','contact_details','callback','reference_mail','not_reached','future_interest_due'));
ALTER TABLE public.leads ADD COLUMN erased_at timestamptz;

CREATE FUNCTION app_private.appointment_owner(_caller uuid,_country text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE WHEN public.user_role(_caller)<>'recruit' THEN _caller ELSE coalesce((
   SELECT ur.user_id FROM public.user_roles ur
    JOIN public.user_countries uc ON uc.user_id=ur.user_id AND uc.country=_country
    JOIN public.profiles p ON p.id=ur.user_id
   WHERE ur.role='manager' AND p.active ORDER BY p.created_at,p.id LIMIT 1),_caller) END
$$;
REVOKE ALL ON FUNCTION app_private.appointment_owner(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION app_private.appointment_owner(uuid,text) TO authenticated;

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

 new_status:=CASE p_action WHEN 'not_reached' THEN 'open' ELSE p_action END;
 stage:=CASE WHEN p_action IN ('low_q','high_q','waiting_3d','reference_mail') THEN p_action END;
 sync:=CASE WHEN stage IS NULL THEN NULL ELSE 'queued' END;

 UPDATE public.leads SET status=new_status,attempts=attempts+1,last_called_at=now(),last_called_by=a WHERE id=l.id;
 INSERT INTO public.status_changes(lead_id,user_id,old_status,new_status) VALUES(l.id,a,l.status,
  CASE WHEN p_action='not_reached' THEN 'not_reached' ELSE new_status END);
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
 IF stage IS NOT NULL OR p_action='on_hold' THEN
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
END $$;
REVOKE ALL ON FUNCTION public.record_lead_action(uuid,uuid,integer,text,text,timestamptz,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_lead_action(uuid,uuid,integer,text,text,timestamptz,text,jsonb) TO authenticated;

CREATE FUNCTION public.activate_future_projects() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r record; ids jsonb:='[]'::jsonb; aid uuid; cur_month date:=date_trunc('month',(now() AT TIME ZONE 'Europe/Vienna'))::date;
BEGIN
 FOR r IN
  SELECT l.id lead_id,la.user_id,la.id src
  FROM public.leads l
  JOIN LATERAL (SELECT x.* FROM public.lead_actions x WHERE x.lead_id=l.id AND x.action='on_hold' ORDER BY x.created_at DESC LIMIT 1) la ON true
  WHERE l.status='on_hold' AND l.archived_at IS NULL
    AND la.details->>'month' ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND ((la.details->>'month')||'-01')::date<=cur_month
    AND NOT EXISTS(SELECT 1 FROM public.lead_actions d WHERE d.lead_id=l.id AND d.action='future_interest_due' AND d.created_at>la.created_at)
  ORDER BY la.created_at LIMIT 500
 LOOP
  INSERT INTO public.lead_actions(lead_id,user_id,action,stage_key,crm_sync_state,details)
   VALUES(r.lead_id,r.user_id,'future_interest_due','on_hold','queued',jsonb_build_object('source_action',r.src)) RETURNING id INTO aid;
  ids:=ids||to_jsonb(aid);
 END LOOP;
 RETURN ids;
END $$;
REVOKE ALL ON FUNCTION public.activate_future_projects() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.activate_future_projects() TO service_role;

CREATE FUNCTION public.get_no_interest_leads(p_country text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor();
BEGIN
 IF NOT public.has_admin_rights(a,p_country) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object(
   'lead_id',l.id,'company',l.company,'contact_name',l.contact_name,'phone',l.phone,'email',l.email,'city',l.city,'extra',l.extra,
   'batch',b.name,'caller',(SELECT display_name FROM public.profiles WHERE id=l.last_called_by),
   'declined_at',(SELECT max(x.created_at) FROM public.lead_actions x WHERE x.lead_id=l.id AND x.action='no_interest'),
   'note',(SELECT x.note FROM public.lead_actions x WHERE x.lead_id=l.id AND x.action='no_interest' ORDER BY x.created_at DESC LIMIT 1))
   ORDER BY l.last_called_at DESC NULLS LAST)
  FROM public.leads l JOIN public.lead_batches b ON b.id=l.batch_id
  WHERE b.country=p_country AND l.status='no_interest' AND l.archived_at IS NULL),'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.get_no_interest_leads(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_no_interest_leads(text) TO authenticated;