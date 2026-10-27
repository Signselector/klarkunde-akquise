CREATE OR REPLACE FUNCTION app_private.own_load(_user uuid,_country text,_start timestamptz,_end timestamptz,_except_lead uuid) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE WHEN
      EXISTS(SELECT 1 FROM public.callbacks c WHERE c.user_id=_user AND NOT c.done AND c.lead_id IS DISTINCT FROM _except_lead
              AND c.due_at<_end AND c.due_at+interval '15 minutes'>_start)
   OR EXISTS(SELECT 1 FROM public.appointments a WHERE a.user_id=_user AND a.starts_at<_end AND a.starts_at+interval '30 minutes'>_start)
   OR EXISTS(SELECT 1 FROM public.pipedrive_activities p WHERE p.user_id=_user AND NOT p.done AND p.country=_country
              AND p.due_at<_end AND p.due_at+make_interval(mins=>greatest(p.duration_min,15))>_start)
  THEN 1 ELSE 0 END
$$;

CREATE OR REPLACE FUNCTION app_private.trg_callback_slot() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c text:=coalesce(NEW.country,(SELECT b.country FROM public.leads l JOIN public.lead_batches b ON b.id=l.batch_id WHERE l.id=NEW.lead_id),'');
BEGIN
 IF NEW.done OR NEW.user_id IS NULL OR coalesce(current_setting('app.skip_slot_check',true),'')='1' THEN RETURN NEW; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('callback:'||NEW.user_id::text,0));
 IF app_private.own_load(NEW.user_id,c,NEW.due_at,NEW.due_at+interval '15 minutes',NEW.lead_id)>0 THEN
  RAISE EXCEPTION 'slot_conflict' USING ERRCODE='23505';
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.get_slot_availability(p_country text,p_from timestamptz,p_to timestamptz,p_kind text,p_lead uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor(); r jsonb; step integer;
BEGIN
 IF NOT public.can_access_country(p_country) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 IF p_kind NOT IN ('appointment','callback') OR p_from IS NULL OR p_to IS NULL OR p_to<=p_from OR p_to-p_from>interval '16 days' THEN
  RAISE EXCEPTION 'validation_failed' USING ERRCODE='22023';
 END IF;
 step:=CASE WHEN p_kind='callback' THEN 900 ELSE 1800 END;
 SELECT coalesce(jsonb_agg(jsonb_build_object('slot',s,'used',u,'capacity',cap) ORDER BY s),'[]'::jsonb) INTO r FROM (
  SELECT g.s,
   CASE WHEN p_kind='appointment' THEN app_private.appointment_load(p_country,g.s,g.s+interval '30 minutes')
        ELSE app_private.own_load(a,p_country,g.s,g.s+interval '15 minutes',p_lead) END u,
   CASE WHEN p_kind='appointment' THEN 2 ELSE 1 END cap
  FROM generate_series(to_timestamp(ceil(extract(epoch FROM p_from)/step)*step),p_to,make_interval(secs=>step)) g(s)) x
 WHERE u>0;
 RETURN r;
END $$;