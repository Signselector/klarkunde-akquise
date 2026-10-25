-- Conversation outcomes ("Gesprächsergebnis") that can be recorded for one specific lead.
-- CRM stages are only *queued* here (stage_key + crm_sync_state='queued'); nothing is sent to the CRM by this migration.
ALTER TABLE public.leads DROP CONSTRAINT lead_status_valid;
ALTER TABLE public.leads ADD CONSTRAINT lead_status_valid
  CHECK (status IN ('open','callback','appointment','production','no_interest','in_progress','on_hold','waiting_3d'));

CREATE TABLE public.lead_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('low_q','high_q','waiting_3d','no_interest','on_hold','contact_details','callback','reference_mail','not_reached')),
  note text,
  stage_key text,
  crm_sync_state text CHECK (crm_sync_state IN ('queued','synced','error','review')),
  logo_path text,
  scheduled_at timestamptz,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lead_actions_lead_idx ON public.lead_actions(lead_id, created_at DESC);
GRANT SELECT ON public.lead_actions TO authenticated;
GRANT ALL ON public.lead_actions TO service_role;
ALTER TABLE public.lead_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY lead_actions_read ON public.lead_actions FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

CREATE FUNCTION public.record_lead_action(
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
 counts_as_call boolean:=true;
 aid uuid;
 cb uuid;
 ex jsonb;
 key text;
 val text;
 sync text;
BEGIN
 IF p_action IS NULL OR p_action NOT IN ('low_q','high_q','waiting_3d','no_interest','on_hold','contact_details','callback','reference_mail','not_reached') THEN
  RAISE EXCEPTION 'validation_failed' USING ERRCODE='22023';
 END IF;
 payload:=jsonb_build_array(p_lead_id,p_expected_version,p_action,note,p_scheduled_at,p_logo_path,p_details);
 r:=app_private.request('lead_action',p_request_id,payload); IF r IS NOT NULL THEN RETURN r; END IF;
 IF length(coalesce(note,''))>10000 THEN RAISE EXCEPTION 'note_too_long' USING ERRCODE='22023'; END IF;

 SELECT * INTO l FROM public.leads WHERE id=p_lead_id AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'lead_not_found' USING ERRCODE='P0002'; END IF;
 IF l.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'stale_lead' USING ERRCODE='40001'; END IF;
 SELECT * INTO bt FROM public.lead_batches WHERE id=l.batch_id;
 IF NOT public.can_access_country(bt.country) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 -- Own batch, own earlier work, or an admin. Anyone else may not touch the lead.
 IF NOT (public.has_role(a,'admin') OR bt.assigned_to IS NOT DISTINCT FROM a OR l.last_called_by IS NOT DISTINCT FROM a) THEN
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
 ELSIF p_action IN ('waiting_3d','on_hold') THEN
  IF note IS NULL THEN RAISE EXCEPTION 'note_required' USING ERRCODE='22023'; END IF;
 END IF;
 IF p_action='callback' AND (p_scheduled_at IS NULL OR NOT pg_catalog.isfinite(p_scheduled_at) OR p_scheduled_at<=now()) THEN
  RAISE EXCEPTION 'invalid_schedule' USING ERRCODE='22023';
 END IF;
 IF p_action='on_hold' AND p_scheduled_at IS NOT NULL AND (NOT pg_catalog.isfinite(p_scheduled_at) OR p_scheduled_at<=now()) THEN
  RAISE EXCEPTION 'invalid_schedule' USING ERRCODE='22023';
 END IF;
 IF p_action='contact_details' THEN
  IF p_details IS NULL OR jsonb_typeof(p_details)<>'object' OR octet_length(p_details::text)>20000
     OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_details) k WHERE k NOT IN ('company','contact_name','phone','email','website','city','address')) THEN
   RAISE EXCEPTION 'validation_failed' USING ERRCODE='22023';
  END IF;
  IF nullif(btrim(p_details->>'email'),'') IS NOT NULL AND btrim(p_details->>'email') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
   RAISE EXCEPTION 'invalid_email' USING ERRCODE='22023';
  END IF;
 END IF;
 IF p_action='reference_mail' AND (p_details IS NULL OR jsonb_typeof(p_details)<>'object' OR octet_length(p_details::text)>50000) THEN
  RAISE EXCEPTION 'validation_failed' USING ERRCODE='22023';
 END IF;

 -- Status and CRM stage key. Only actions with a stage key are queued for the CRM.
 new_status:=CASE p_action
  WHEN 'low_q' THEN 'in_progress' WHEN 'high_q' THEN 'in_progress'
  WHEN 'waiting_3d' THEN 'waiting_3d' WHEN 'on_hold' THEN 'on_hold'
  WHEN 'no_interest' THEN 'no_interest' WHEN 'callback' THEN 'callback'
  WHEN 'not_reached' THEN 'open' ELSE NULL END;
 stage:=CASE p_action WHEN 'low_q' THEN 'low_q' WHEN 'high_q' THEN 'high_q' WHEN 'waiting_3d' THEN 'waiting_3d'
  WHEN 'on_hold' THEN 'on_hold' WHEN 'no_interest' THEN 'no_interest' ELSE NULL END;
 sync:=CASE WHEN stage IS NULL THEN NULL ELSE 'queued' END;
 counts_as_call:=p_action NOT IN ('contact_details','reference_mail');

 IF p_action='contact_details' THEN
  ex:=coalesce(l.extra,'{}'::jsonb);
  IF p_details ? 'website' THEN
   SELECT coalesce((SELECT k FROM jsonb_object_keys(ex) k WHERE lower(btrim(k)) IN ('website','webseite','web','url') LIMIT 1),'Website') INTO key;
   val:=nullif(btrim(p_details->>'website'),'');
   ex:=CASE WHEN val IS NULL THEN ex-key ELSE jsonb_set(ex,ARRAY[key],to_jsonb(val)) END;
  END IF;
  IF p_details ? 'address' THEN
   SELECT coalesce((SELECT k FROM jsonb_object_keys(ex) k WHERE lower(btrim(k)) IN ('adresse','address','anschrift') LIMIT 1),'Adresse') INTO key;
   val:=nullif(btrim(p_details->>'address'),'');
   ex:=CASE WHEN val IS NULL THEN ex-key ELSE jsonb_set(ex,ARRAY[key],to_jsonb(val)) END;
  END IF;
  UPDATE public.leads SET
   company=CASE WHEN p_details ? 'company' THEN nullif(btrim(p_details->>'company'),'') ELSE company END,
   contact_name=CASE WHEN p_details ? 'contact_name' THEN nullif(btrim(p_details->>'contact_name'),'') ELSE contact_name END,
   email=CASE WHEN p_details ? 'email' THEN nullif(lower(btrim(p_details->>'email')),'') ELSE email END,
   phone=CASE WHEN p_details ? 'phone' THEN nullif(btrim(p_details->>'phone'),'') ELSE phone END,
   city=CASE WHEN p_details ? 'city' THEN nullif(btrim(p_details->>'city'),'') ELSE city END,
   extra=ex
  WHERE id=l.id;
 ELSIF new_status IS NOT NULL THEN
  UPDATE public.leads SET status=new_status,attempts=attempts+1,last_called_at=now(),last_called_by=a WHERE id=l.id;
  INSERT INTO public.status_changes(lead_id,user_id,old_status,new_status) VALUES(l.id,a,l.status,
   CASE WHEN p_action='not_reached' THEN 'not_reached' ELSE new_status END);
  -- A recorded outcome replaces earlier open callbacks of this lead.
  UPDATE public.callbacks SET done=true WHERE lead_id=l.id AND NOT done;
 END IF;

 IF p_action IN ('callback','on_hold') AND p_scheduled_at IS NOT NULL THEN
  INSERT INTO public.callbacks(lead_id,user_id,due_at,country) VALUES(l.id,a,p_scheduled_at,bt.country) RETURNING id INTO cb;
 END IF;
 IF note IS NOT NULL THEN INSERT INTO public.lead_notes(lead_id,user_id,body) VALUES(l.id,a,note); END IF;
 DELETE FROM public.lead_claims WHERE lead_id=l.id AND user_id=a;

 INSERT INTO public.lead_actions(lead_id,user_id,action,note,stage_key,crm_sync_state,logo_path,scheduled_at,details)
  VALUES(l.id,a,p_action,note,stage,sync,CASE WHEN p_action IN ('low_q','high_q') THEN p_logo_path END,p_scheduled_at,p_details)
  RETURNING id INTO aid;
 INSERT INTO public.audit_events(actor,action,target_id) VALUES(a,'lead_action:'||p_action,l.id);

 RETURN app_private.finish('lead_action',p_request_id,payload,jsonb_build_object(
  'lead_id',l.id,'action_id',aid,'action',p_action,
  'status',coalesce(new_status,l.status),
  'version',l.version+CASE WHEN p_action='reference_mail' THEN 0 ELSE 1 END,
  'attempts',l.attempts+CASE WHEN counts_as_call THEN 1 ELSE 0 END,
  'callback_id',cb,'stage_key',stage,'crm_sync_state',sync));
END $$;
REVOKE ALL ON FUNCTION public.record_lead_action(uuid,uuid,integer,text,text,timestamptz,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_lead_action(uuid,uuid,integer,text,text,timestamptz,text,jsonb) TO authenticated;

-- Private bucket for company logos, one folder per user. Skipped where no storage schema exists (tests).
DO $$ BEGIN
 IF to_regclass('storage.buckets') IS NOT NULL AND to_regclass('storage.objects') IS NOT NULL THEN
  INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
   VALUES('lead-logos','lead-logos',false,5242880,ARRAY['image/png','image/jpeg','image/webp','image/svg+xml','application/pdf'])
   ON CONFLICT (id) DO NOTHING;
  EXECUTE $p$CREATE POLICY lead_logos_insert ON storage.objects FOR INSERT TO authenticated
   WITH CHECK (bucket_id='lead-logos' AND (storage.foldername(name))[1]=auth.uid()::text)$p$;
  EXECUTE $p$CREATE POLICY lead_logos_read ON storage.objects FOR SELECT TO authenticated
   USING (bucket_id='lead-logos' AND ((storage.foldername(name))[1]=auth.uid()::text OR public.has_role(auth.uid(),'admin')))$p$;
 END IF;
END $$;
