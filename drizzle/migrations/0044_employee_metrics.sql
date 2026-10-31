-- Statistics per employee for managers and admins, with the very same numbers as the caller dashboard.
-- One central function (app_private.user_period_metrics) counts the dashboard figures; get_caller_day and the new
-- get_employee_stats both use it, so they cannot drift apart. The other dashboard functions get an optional p_user that
-- only managers and admins of the employee's country may use.

CREATE FUNCTION app_private.metrics_subject(_user uuid) RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor();
BEGIN
 IF _user IS NULL OR _user=a THEN RETURN app_private.eff_actor(); END IF;
 IF public.is_global_admin(a) OR (public.has_role(a,'admin') AND app_private.shares_country(a,_user)) THEN RETURN _user; END IF;
 RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
END $$;
REVOKE ALL ON FUNCTION app_private.metrics_subject(uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION app_private.user_period_metrics(_user uuid,_from timestamptz,_to timestamptz) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object(
  'attempts',count(*),
  'reached',count(DISTINCT lead_id) FILTER (WHERE new_status<>'not_reached'),
  'no_interest',count(*) FILTER (WHERE new_status='no_interest'),
  'not_reached',count(*) FILTER (WHERE new_status='not_reached'),
  'low_q',count(DISTINCT lead_id) FILTER (WHERE new_status='low_q'),
  'high_q',count(DISTINCT lead_id) FILTER (WHERE new_status='high_q'),
  'waiting_3d',count(DISTINCT lead_id) FILTER (WHERE new_status='waiting_3d'),
  'callback',count(DISTINCT lead_id) FILTER (WHERE new_status='callback'),
  'on_hold',count(DISTINCT lead_id) FILTER (WHERE new_status='on_hold'),
  'reference_mail',count(DISTINCT lead_id) FILTER (WHERE new_status='reference_mail'),
  'total_leads',count(DISTINCT lead_id))
 FROM public.status_changes WHERE user_id=_user AND created_at>=_from AND created_at<_to AND new_status=ANY(app_private.call_outcomes())
$$;
REVOKE ALL ON FUNCTION app_private.user_period_metrics(uuid,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated;

DROP FUNCTION public.get_caller_day(date);
CREATE FUNCTION public.get_caller_day(p_day date DEFAULT NULL, p_user uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.metrics_subject(p_user); d date:=coalesce(p_day,(now() AT TIME ZONE 'Europe/Vienna')::date);
BEGIN
 RETURN jsonb_build_object('day',d,'timezone','Europe/Vienna')
  || app_private.user_period_metrics(a,d::timestamp AT TIME ZONE 'Europe/Vienna',(d+1)::timestamp AT TIME ZONE 'Europe/Vienna');
END $$;
REVOKE ALL ON FUNCTION public.get_caller_day(date,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_caller_day(date,uuid) TO authenticated;

DO $$ DECLARE d text; o text;
BEGIN
 d:=pg_get_functiondef('public.get_caller_month(date)'::regprocedure); o:=d;
 d:=replace(d,'(p_month date DEFAULT NULL::date)','(p_month date DEFAULT NULL::date, p_user uuid DEFAULT NULL::uuid)');
 d:=replace(d,'a uuid:=app_private.eff_actor()','a uuid:=app_private.metrics_subject(p_user)');
 IF d=o THEN RAISE EXCEPTION 'get_caller_month patch failed'; END IF;
 DROP FUNCTION public.get_caller_month(date); EXECUTE d;
 REVOKE ALL ON FUNCTION public.get_caller_month(date,uuid) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.get_caller_month(date,uuid) TO authenticated;

 d:=pg_get_functiondef('public.get_monthly_quality(date)'::regprocedure); o:=d;
 d:=replace(d,'(p_month date DEFAULT NULL::date)','(p_month date DEFAULT NULL::date, p_user uuid DEFAULT NULL::uuid)');
 d:=replace(d,'a uuid:=app_private.eff_actor()','a uuid:=app_private.metrics_subject(p_user)');
 IF d=o THEN RAISE EXCEPTION 'get_monthly_quality patch failed'; END IF;
 DROP FUNCTION public.get_monthly_quality(date); EXECUTE d;
 REVOKE ALL ON FUNCTION public.get_monthly_quality(date,uuid) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.get_monthly_quality(date,uuid) TO authenticated;

 d:=pg_get_functiondef('public.get_team_metrics()'::regprocedure); o:=d;
 d:=replace(d,'public.get_team_metrics()','public.get_team_metrics(p_user uuid DEFAULT NULL::uuid)');
 d:=replace(d,'a uuid:=app_private.actor()','a uuid:=app_private.metrics_subject(p_user)');
 IF d=o THEN RAISE EXCEPTION 'get_team_metrics patch failed'; END IF;
 DROP FUNCTION public.get_team_metrics(); EXECUTE d;
 REVOKE ALL ON FUNCTION public.get_team_metrics(uuid) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.get_team_metrics(uuid) TO authenticated;
END $$;

-- The same dashboard figures for one employee and any period (managers and admins of the employee's country).
CREATE FUNCTION public.get_employee_stats(p_country text,p_user uuid,p_from timestamptz,p_to timestamptz) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor();
BEGIN
 IF NOT public.can_access_country(p_country) OR NOT public.has_admin_rights(a,p_country) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 IF p_user IS NULL OR NOT EXISTS(SELECT 1 FROM public.user_countries WHERE user_id=p_user AND country=p_country) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 IF p_from IS NULL OR p_to IS NULL OR p_to<=p_from OR p_to-p_from>interval '400 days' THEN RAISE EXCEPTION 'validation_failed' USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object('user_id',p_user,'metrics',app_private.user_period_metrics(p_user,p_from,p_to));
END $$;
REVOKE ALL ON FUNCTION public.get_employee_stats(text,uuid,timestamptz,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_employee_stats(text,uuid,timestamptz,timestamptz) TO authenticated;