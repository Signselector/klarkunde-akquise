-- Appointment slots: 30 minutes each, at most 2 at the same time per country (tool + Pipedrive together).
-- Callbacks are private to the caller and must not collide with the caller's own callbacks, appointments or Pipedrive entries.
-- Enforced by triggers on INSERT so every way of booking is covered. Changes that come from Pipedrive are never blocked.

-- Anonymous mirror of the meetings in the company Pipedrive calendar: only start and end, no names, no owner.
CREATE TABLE public.pipedrive_busy (
  country text NOT NULL CHECK (country IN ('DE','AT','NL')),
  activity_id bigint NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  PRIMARY KEY (country, activity_id)
);
CREATE INDEX pipedrive_busy_time_idx ON public.pipedrive_busy(country, starts_at);
GRANT ALL ON public.pipedrive_busy TO service_role;
ALTER TABLE public.pipedrive_busy ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.cal_replace_busy(p_country text, p_from timestamptz, p_to timestamptz, p_rows jsonb) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n integer;
BEGIN
 DELETE FROM public.pipedrive_busy WHERE country=p_country AND starts_at>=p_from AND starts_at<p_to;
 INSERT INTO public.pipedrive_busy(country,activity_id,starts_at,ends_at)
  SELECT p_country,(x->>'id')::bigint,(x->>'starts_at')::timestamptz,(x->>'ends_at')::timestamptz FROM jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) x
  WHERE (x->>'ends_at')::timestamptz>(x->>'starts_at')::timestamptz
  ON CONFLICT (country,activity_id) DO UPDATE SET starts_at=EXCLUDED.starts_at,ends_at=EXCLUDED.ends_at;
 GET DIAGNOSTICS n=ROW_COUNT; RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.cal_replace_busy(text,timestamptz,timestamptz,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cal_replace_busy(text,timestamptz,timestamptz,jsonb) TO service_role;

-- Number of appointments (tool and Pipedrive) that overlap the window. Meetings created by the tool exist in both places and count once.
CREATE FUNCTION app_private.appointment_load(_country text,_start timestamptz,_end timestamptz) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT ((SELECT count(*) FROM public.appointments a WHERE a.country=_country AND a.starts_at<_end AND a.starts_at+interval '30 minutes'>_start)
   +(SELECT count(*) FROM public.pipedrive_busy b WHERE b.country=_country AND b.starts_at<_end AND b.ends_at>_start
       AND NOT EXISTS(SELECT 1 FROM public.appointments x WHERE x.country=b.country AND x.pd_activity_id=b.activity_id)))::integer
$$;
-- What already occupies the caller's own calendar in the window.
CREATE FUNCTION app_private.own_load(_user uuid,_country text,_start timestamptz,_end timestamptz,_except_lead uuid) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT ((SELECT count(*) FROM public.callbacks c WHERE c.user_id=_user AND NOT c.done AND c.lead_id IS DISTINCT FROM _except_lead
          AND c.due_at<_end AND c.due_at+interval '30 minutes'>_start)
   +(SELECT count(*) FROM public.appointments a WHERE a.user_id=_user AND a.starts_at<_end AND a.starts_at+interval '30 minutes'>_start)
   +(SELECT count(*) FROM public.pipedrive_activities p WHERE p.user_id=_user AND NOT p.done AND p.country=_country
          AND p.due_at<_end AND p.due_at+make_interval(mins=>greatest(p.duration_min,1))>_start))::integer
$$;
REVOKE ALL ON FUNCTION app_private.appointment_load(text,timestamptz,timestamptz),app_private.own_load(uuid,text,timestamptz,timestamptz,uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION app_private.trg_appointment_slot() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c text:=coalesce(NEW.country,(SELECT b.country FROM public.leads l JOIN public.lead_batches b ON b.id=l.batch_id WHERE l.id=NEW.lead_id));
BEGIN
 IF NEW.starts_at IS NULL OR c IS NULL OR coalesce(current_setting('app.skip_slot_check',true),'')='1' THEN RETURN NEW; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('appt:'||c,0));
 IF app_private.appointment_load(c,NEW.starts_at,NEW.starts_at+interval '30 minutes')>=2 THEN
  RAISE EXCEPTION 'slot_full' USING ERRCODE='23505';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER appointment_slot BEFORE INSERT ON public.appointments FOR EACH ROW EXECUTE FUNCTION app_private.trg_appointment_slot();

CREATE FUNCTION app_private.trg_callback_slot() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c text:=coalesce(NEW.country,(SELECT b.country FROM public.leads l JOIN public.lead_batches b ON b.id=l.batch_id WHERE l.id=NEW.lead_id),'');
BEGIN
 IF NEW.done OR NEW.user_id IS NULL OR coalesce(current_setting('app.skip_slot_check',true),'')='1' THEN RETURN NEW; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('callback:'||NEW.user_id::text,0));
 IF app_private.own_load(NEW.user_id,c,NEW.due_at,NEW.due_at+interval '30 minutes',NEW.lead_id)>0 THEN
  RAISE EXCEPTION 'slot_conflict' USING ERRCODE='23505';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER callback_slot_overlap BEFORE INSERT ON public.callbacks FOR EACH ROW EXECUTE FUNCTION app_private.trg_callback_slot();

-- Replies to a reference mail must always reach the original caller, so they skip the slot check.
CREATE OR REPLACE FUNCTION app_private.apply_reference_reply(_email uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
 PERFORM set_config('app.skip_slot_check','1',true);
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

-- Free/busy for the booking calendar: counts only, never who or what. Slots without anything are left out.
CREATE FUNCTION public.get_slot_availability(p_country text,p_from timestamptz,p_to timestamptz,p_kind text,p_lead uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor(); r jsonb;
BEGIN
 IF NOT public.can_access_country(p_country) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 IF p_kind NOT IN ('appointment','callback') OR p_from IS NULL OR p_to IS NULL OR p_to<=p_from OR p_to-p_from>interval '16 days' THEN
  RAISE EXCEPTION 'validation_failed' USING ERRCODE='22023';
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('slot',s,'used',u,'capacity',cap) ORDER BY s),'[]'::jsonb) INTO r FROM (
  SELECT g.s,
   CASE WHEN p_kind='appointment' THEN app_private.appointment_load(p_country,g.s,g.s+interval '30 minutes')
        ELSE least(1,app_private.own_load(a,p_country,g.s,g.s+interval '30 minutes',p_lead)) END u,
   CASE WHEN p_kind='appointment' THEN 2 ELSE 1 END cap
  FROM generate_series(to_timestamp(ceil(extract(epoch FROM p_from)/1800)*1800),p_to,interval '30 minutes') g(s)) x
 WHERE u>0;
 RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.get_slot_availability(text,timestamptz,timestamptz,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_slot_availability(text,timestamptz,timestamptz,text,uuid) TO authenticated;

-- Termine shows everything the user owns or booked through the tool (a recruit's appointment belongs to the manager).
DROP POLICY IF EXISTS "ap read" ON public.appointments;
CREATE POLICY "ap read" ON public.appointments FOR SELECT TO authenticated USING (user_id = auth.uid() OR booked_by = auth.uid());
