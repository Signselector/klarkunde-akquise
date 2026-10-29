CREATE OR REPLACE FUNCTION app_private.trg_appointment_slot()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE c text:=coalesce(NEW.country,(SELECT b.country FROM public.leads l JOIN public.lead_batches b ON b.id=l.batch_id WHERE l.id=NEW.lead_id));
BEGIN
 IF NEW.starts_at IS NULL OR c IS NULL OR coalesce(current_setting('app.skip_slot_check',true),'')='1' THEN RETURN NEW; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('appt:'||c,0));
 IF app_private.appointment_load(c,NEW.starts_at,NEW.starts_at+interval '30 minutes')>=(CASE WHEN c='DE' THEN 1 ELSE 2 END) THEN
  RAISE EXCEPTION 'slot_full' USING ERRCODE='23505';
 END IF;
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.get_slot_availability(p_country text, p_from timestamp with time zone, p_to timestamp with time zone, p_kind text, p_lead uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
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
   CASE WHEN p_kind='appointment' THEN (CASE WHEN p_country='DE' THEN 1 ELSE 2 END) ELSE 1 END cap
  FROM generate_series(to_timestamp(ceil(extract(epoch FROM p_from)/step)*step),p_to,make_interval(secs=>step)) g(s)) x
 WHERE u>0;
 RETURN r;
END $function$;

CREATE OR REPLACE FUNCTION app_private.appointment_owner(_caller uuid, _country text, _self boolean)
 RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
 SELECT CASE WHEN public.user_role(_caller) IN ('admin','manager') THEN _caller
   ELSE coalesce((
   SELECT ur.user_id FROM public.user_roles ur
    JOIN public.user_countries uc ON uc.user_id=ur.user_id AND uc.country=_country
    JOIN public.profiles p ON p.id=ur.user_id
   WHERE ur.role='manager' AND p.active ORDER BY p.created_at,p.id LIMIT 1),_caller) END
$function$;

CREATE OR REPLACE FUNCTION public.assign_appointment(p_appointment_id uuid, p_user_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE a uuid := auth.uid(); c text;
BEGIN
  SELECT country INTO c FROM public.appointments WHERE id=p_appointment_id;
  IF c IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF a IS NULL OR NOT public.has_admin_rights(a,c) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=p_user_id AND p.active)
     OR (public.user_role(p_user_id)<>'admin' AND NOT EXISTS(SELECT 1 FROM public.user_countries WHERE user_id=p_user_id AND country=c)) THEN
    RAISE EXCEPTION 'invalid_assignee' USING ERRCODE='22023';
  END IF;
  IF p_user_id <> a AND public.user_role(p_user_id) <> 'veteran' THEN
    RAISE EXCEPTION 'only_veterans_assignable' USING ERRCODE='22023';
  END IF;
  UPDATE public.appointments SET user_id=p_user_id WHERE id=p_appointment_id;
END $function$;

CREATE OR REPLACE FUNCTION public.get_country_period_stats(p_country text, p_from timestamp with time zone, p_to timestamp with time zone, p_user_id uuid DEFAULT NULL::uuid, p_bucket text DEFAULT 'day'::text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  a uuid := app_private.actor();
  r jsonb;
  deal_keys text[] := ARRAY['low_q','high_q','waiting_3d','on_hold'];
  outcome_keys text[] := ARRAY['low_q','high_q','waiting_3d','on_hold','reference_mail','callback','not_reached','no_interest'];
BEGIN
  IF NOT public.can_access_country(p_country) OR NOT public.has_admin_rights(a, p_country) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from OR p_to - p_from > interval '400 days' OR p_bucket NOT IN ('day','hour') THEN
    RAISE EXCEPTION 'validation_failed' USING ERRCODE='22023';
  END IF;

  WITH ev AS (
    SELECT sc.user_id, sc.new_status, sc.created_at
    FROM public.status_changes sc
    JOIN public.leads l ON l.id = sc.lead_id
    JOIN public.lead_batches b ON b.id = l.batch_id
    WHERE b.country = p_country
      AND sc.created_at >= p_from AND sc.created_at < p_to
      AND sc.new_status = ANY (app_private.call_outcomes())
  ),
  ap AS (
    SELECT coalesce(x.booked_by, x.user_id) AS user_id
    FROM public.appointments x
    WHERE x.country = p_country AND x.created_at >= p_from AND x.created_at < p_to
  ),
  fev AS (SELECT * FROM ev WHERE p_user_id IS NULL OR user_id = p_user_id),
  fap AS (SELECT * FROM ap WHERE p_user_id IS NULL OR user_id = p_user_id),
  tot AS (
    SELECT count(*)::int calls,
           count(*) FILTER (WHERE new_status <> 'not_reached')::int reached,
           count(*) FILTER (WHERE new_status = ANY (deal_keys))::int deals
    FROM fev
  ),
  buckets AS (
    SELECT to_char(g::date, 'YYYY-MM-DD') AS k FROM generate_series(
      (p_from AT TIME ZONE 'Europe/Vienna')::date, ((p_to - interval '1 microsecond') AT TIME ZONE 'Europe/Vienna')::date, interval '1 day') g
    WHERE p_bucket = 'day'
    UNION ALL
    SELECT lpad(h::text, 2, '0') FROM generate_series(0, 23) h WHERE p_bucket = 'hour'
  ),
  per AS (
    SELECT CASE WHEN p_bucket = 'day' THEN to_char(created_at AT TIME ZONE 'Europe/Vienna', 'YYYY-MM-DD')
                ELSE to_char(created_at AT TIME ZONE 'Europe/Vienna', 'HH24') END AS k,
           count(*)::int calls, count(*) FILTER (WHERE new_status <> 'not_reached')::int reached
    FROM fev GROUP BY 1
  ),
  members AS (
    SELECT p.id, coalesce(nullif(trim(p.display_name), ''), p.email, 'Unbekannt') AS name, public.user_role(p.id) AS role
    FROM public.profiles p
    WHERE p.active AND (p_user_id IS NULL)
      AND EXISTS (SELECT 1 FROM public.user_countries uc WHERE uc.user_id = p.id AND uc.country = p_country)
  )
  SELECT jsonb_build_object(
    'country', p_country,
    'user_id', p_user_id,
    'totals', (SELECT jsonb_build_object(
        'calls', t.calls, 'reached', t.reached,
        'reach_rate', CASE WHEN t.calls = 0 THEN NULL ELSE round(t.reached * 100.0 / t.calls, 1) END,
        'appointments', (SELECT count(*)::int FROM fap),
        'appointment_rate', CASE WHEN t.calls = 0 THEN NULL ELSE round((SELECT count(*) FROM fap) * 100.0 / t.calls, 1) END,
        'deals', t.deals) FROM tot t),
    'by_outcome', (SELECT jsonb_object_agg(k, (SELECT count(*)::int FROM fev WHERE new_status = k)) FROM unnest(outcome_keys) k),
    'timeline', coalesce((SELECT jsonb_agg(jsonb_build_object('bucket', bk.k, 'calls', coalesce(pr.calls, 0), 'reached', coalesce(pr.reached, 0)) ORDER BY bk.k)
                          FROM buckets bk LEFT JOIN per pr ON pr.k = bk.k), '[]'::jsonb),
    'team', CASE WHEN p_user_id IS NOT NULL THEN NULL ELSE coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'user_id', m.id, 'name', m.name, 'role', m.role,
          'calls', (SELECT count(*)::int FROM ev WHERE ev.user_id = m.id),
          'reached', (SELECT count(*)::int FROM ev WHERE ev.user_id = m.id AND ev.new_status <> 'not_reached'),
          'appointments', (SELECT count(*)::int FROM ap WHERE ap.user_id = m.id),
          'deals', (SELECT count(*)::int FROM ev WHERE ev.user_id = m.id AND ev.new_status = ANY (deal_keys)),
          'low_q', (SELECT count(*)::int FROM ev WHERE ev.user_id = m.id AND ev.new_status = 'low_q'),
          'high_q', (SELECT count(*)::int FROM ev WHERE ev.user_id = m.id AND ev.new_status = 'high_q'),
          'on_hold', (SELECT count(*)::int FROM ev WHERE ev.user_id = m.id AND ev.new_status = 'on_hold'),
          'reference_mail', (SELECT count(*)::int FROM ev WHERE ev.user_id = m.id AND ev.new_status = 'reference_mail'),
          'not_reached', (SELECT count(*)::int FROM ev WHERE ev.user_id = m.id AND ev.new_status = 'not_reached'),
          'no_interest', (SELECT count(*)::int FROM ev WHERE ev.user_id = m.id AND ev.new_status = 'no_interest')
        ) ORDER BY m.name) FROM members m), '[]'::jsonb) END
  ) INTO r;
  RETURN r;
END $function$;