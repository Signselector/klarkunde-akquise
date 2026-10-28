-- "Ansicht als Mitarbeiter": a manager/admin sees the app as one employee does (read only).
-- The browser sends the header x-view-as: <user id>. Only a valid request is honoured: the viewer must be staff, the
-- target another user (managers: a Caller / Senior Caller of one of their own countries; admins: anyone).
CREATE FUNCTION app_private.view_as_uid() RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE h text; t uuid; v uuid:=auth.uid();
BEGIN
 BEGIN h:=nullif(current_setting('request.headers',true),'')::json->>'x-view-as'; EXCEPTION WHEN others THEN RETURN NULL; END;
 IF v IS NULL OR h IS NULL OR h !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN NULL; END IF;
 t:=h::uuid;
 IF t=v OR NOT public.has_role(v,'admin') THEN RETURN NULL; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=t) THEN RETURN NULL; END IF;
 IF public.is_global_admin(v) THEN RETURN t; END IF;
 IF public.user_role(t) IN ('recruit','veteran') AND app_private.shares_country(v,t) THEN RETURN t; END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION app_private.view_as_uid() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION app_private.view_as_uid() TO authenticated;

-- The person whose data the personal functions return: the viewed employee, otherwise the caller.
CREATE FUNCTION app_private.eff_actor() RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor();
BEGIN RETURN coalesce(app_private.view_as_uid(),a); END $$;
REVOKE ALL ON FUNCTION app_private.eff_actor() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.view_as_target() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT app_private.view_as_uid() $$;
REVOKE ALL ON FUNCTION public.view_as_target() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.view_as_target() TO authenticated;

-- Personal read functions answer for the viewed employee.
DO $$ DECLARE r record; d text;
BEGIN
 FOR r IN SELECT p.oid FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
   AND p.proname IN ('get_caller_day','get_caller_month','get_monthly_quality','get_weekly_ranking','get_my_customers') LOOP
  d:=pg_get_functiondef(r.oid);
  d:=replace(d,'app_private.actor()','app_private.eff_actor()');
  EXECUTE d;
 END LOOP;
END $$;

-- Callbacks are private; the viewing manager may read the viewed employee's.
DROP POLICY "cb read" ON public.callbacks;
CREATE POLICY "cb read" ON public.callbacks FOR SELECT TO authenticated
 USING (user_id=auth.uid() OR user_id=app_private.view_as_uid());

-- Audit: starting a view is logged.
ALTER TYPE public.audit_action_type ADD VALUE IF NOT EXISTS 'view_as_started';
DO $$ DECLARE d text;
BEGIN
 d:=pg_get_functiondef('public.log_activity(public.audit_action_type,text,text,text,text,jsonb)'::regprocedure);
 d:=replace(d,$a$('user_login','user_logout','list_viewed','list_exported')$a$,$a$('user_login','user_logout','list_viewed','list_exported','view_as_started')$a$);
 d:=replace(d,$a$IN ('list_viewed','list_exported') AND$a$,$a$IN ('list_viewed','list_exported','view_as_started') AND$a$);
 EXECUTE d;
END $$;
