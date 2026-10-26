-- Role model: recruit and veteran are callers, manager has admin rights in the own country (not the backend),
-- admin can do everything in every country. fulfilment stays an additional flag. The old role "caller" is retired
-- (existing callers become recruits) but its value stays in the enum and is still understood by has_role.

UPDATE public.user_roles SET role='recruit' WHERE role='caller';
CREATE UNIQUE INDEX one_primary_role ON public.user_roles(user_id) WHERE role IN ('admin','manager','veteran','recruit','caller');

-- has_role keeps its meaning for existing checks: 'admin' now means admin or manager ("staff"), 'caller' means
-- recruit or veteran. Anything that must stay with the real admin uses is_global_admin().
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid,_role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND (
   CASE _role
    WHEN 'admin' THEN role IN ('admin','manager')
    WHEN 'caller' THEN role IN ('caller','recruit','veteran')
    ELSE role=_role END))
$$;
REVOKE ALL ON FUNCTION public.has_role(uuid,public.app_role) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid,public.app_role) TO authenticated;

CREATE FUNCTION public.is_global_admin(_uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.is_master(_uid) OR EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_uid AND role='admin')
$$;
-- Admin rights for one country: the admin everywhere, a manager only in the countries granted to them.
CREATE FUNCTION public.has_admin_rights(_uid uuid,_country text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.is_global_admin(_uid) OR (
   EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_uid AND role='manager')
   AND EXISTS(SELECT 1 FROM public.user_countries WHERE user_id=_uid AND country=_country))
$$;
CREATE FUNCTION public.user_role(_uid uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE WHEN public.is_master(_uid) THEN 'admin' ELSE coalesce((SELECT CASE role WHEN 'caller' THEN 'recruit' ELSE role::text END
   FROM public.user_roles WHERE user_id=_uid AND role IN ('admin','manager','veteran','recruit','caller')),'recruit') END
$$;
REVOKE ALL ON FUNCTION public.is_global_admin(uuid),public.has_admin_rights(uuid,text),public.user_role(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.is_global_admin(uuid),public.has_admin_rights(uuid,text),public.user_role(uuid) TO authenticated;

-- Admins see every country, everyone else only the countries granted to them.
CREATE OR REPLACE FUNCTION public.can_access_country(_c text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT public.is_global_admin(auth.uid()) OR EXISTS (SELECT 1 FROM public.user_countries WHERE user_id = auth.uid() AND country = _c)
$$;
CREATE OR REPLACE FUNCTION public.my_countries() RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT CASE WHEN public.is_global_admin(auth.uid()) THEN ARRAY['DE','AT','NL']
    ELSE COALESCE((SELECT array_agg(country ORDER BY country) FROM public.user_countries WHERE user_id = auth.uid()), ARRAY[]::text[]) END
$$;

-- Every new account starts as a recruit (the very first account of an empty system becomes admin).
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email,'@',1)));
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'recruit');
  END IF;
  RETURN NEW;
END $$;

-- Who a manager may look after: callers (recruit/veteran) who share a country with the manager.
CREATE FUNCTION app_private.is_caller_role(_uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT NOT public.is_master(_uid) AND NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_uid AND role IN ('admin','manager'))
$$;
CREATE FUNCTION app_private.manages_user(_actor uuid,_target uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.is_global_admin(_actor) OR (
   EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_actor AND role='manager')
   AND app_private.is_caller_role(_target)
   AND EXISTS(SELECT 1 FROM public.user_countries a JOIN public.user_countries t ON t.country=a.country WHERE a.user_id=_actor AND t.user_id=_target))
$$;
REVOKE ALL ON FUNCTION app_private.is_caller_role(uuid),app_private.manages_user(uuid,uuid) FROM PUBLIC,anon,authenticated;
-- Row policies run as the caller, so they go through a public function instead of the private helpers.
CREATE FUNCTION public.can_grant_country(_target uuid,_country text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.is_global_admin(auth.uid()) OR (public.has_admin_rights(auth.uid(),_country) AND app_private.is_caller_role(_target))
$$;
REVOKE ALL ON FUNCTION public.can_grant_country(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_grant_country(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_user_role(p_user_id uuid, p_role public.app_role) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=auth.uid(); r public.app_role:=p_role;
BEGIN
  IF a IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF r='caller' THEN r:='recruit'; END IF;
  IF r NOT IN ('recruit','veteran','manager','admin') THEN RAISE EXCEPTION 'invalid_role'; END IF;
  IF public.is_master(p_user_id) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF public.is_global_admin(a) THEN
    IF r<>'admin' AND EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=p_user_id AND role='admin')
       AND NOT EXISTS(SELECT 1 FROM public.user_roles WHERE role='admin' AND user_id<>p_user_id) THEN
      RAISE EXCEPTION 'last_admin';
    END IF;
  ELSIF public.has_role(a,'admin') THEN
    -- manager: only recruit <-> veteran, only for callers of the own country
    IF r NOT IN ('recruit','veteran') OR NOT app_private.manages_user(a,p_user_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  ELSE
    RAISE EXCEPTION 'forbidden';
  END IF;
  DELETE FROM public.user_roles WHERE user_id=p_user_id AND role IN ('admin','manager','veteran','recruit','caller');
  INSERT INTO public.user_roles(user_id,role) VALUES(p_user_id,r);
END $$;

CREATE OR REPLACE FUNCTION public.set_user_active(p_user_id uuid, p_active boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT app_private.manages_user(auth.uid(),p_user_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_user_id = auth.uid() OR public.is_master(p_user_id) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  UPDATE public.profiles SET active = p_active WHERE id = p_user_id;
END $$;
CREATE OR REPLACE FUNCTION public.set_user_fulfilment(p_user_id uuid, p_on boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT app_private.manages_user(auth.uid(),p_user_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_on THEN INSERT INTO public.user_roles(user_id,role) VALUES(p_user_id,'fulfilment') ON CONFLICT DO NOTHING;
  ELSE DELETE FROM public.user_roles WHERE user_id=p_user_id AND role='fulfilment'; END IF;
END $$;

-- Country access: admins for everyone, managers only for callers and only for their own countries.
DROP POLICY IF EXISTS uc_master_insert ON public.user_countries;
DROP POLICY IF EXISTS uc_master_delete ON public.user_countries;
CREATE POLICY uc_insert ON public.user_countries FOR INSERT TO authenticated WITH CHECK (public.can_grant_country(user_id,country));
CREATE POLICY uc_delete ON public.user_countries FOR DELETE TO authenticated USING (public.can_grant_country(user_id,country));

-- Backend stays with the real admin: integrations, retries, archiving, configuration and the audit trail.
DROP POLICY IF EXISTS config_admin ON public.integration_config;
CREATE POLICY config_admin ON public.integration_config FOR UPDATE TO authenticated
  USING (public.is_global_admin(auth.uid())) WITH CHECK (public.is_global_admin(auth.uid()));
DROP POLICY IF EXISTS audit_admin ON public.audit_events;
CREATE POLICY audit_admin ON public.audit_events FOR SELECT TO authenticated USING (public.is_global_admin(auth.uid()));
DROP POLICY IF EXISTS psm_admin_ins ON public.pipedrive_stage_mapping;
DROP POLICY IF EXISTS psm_admin_upd ON public.pipedrive_stage_mapping;
CREATE POLICY psm_admin_ins ON public.pipedrive_stage_mapping FOR INSERT TO authenticated WITH CHECK (public.is_global_admin(auth.uid()));
CREATE POLICY psm_admin_upd ON public.pipedrive_stage_mapping FOR UPDATE TO authenticated USING (public.is_global_admin(auth.uid())) WITH CHECK (public.is_global_admin(auth.uid()));
DROP POLICY IF EXISTS psv_read ON public.pipedrive_stage_validation;
CREATE POLICY psv_read ON public.pipedrive_stage_validation FOR SELECT TO authenticated USING (public.is_global_admin(auth.uid()));

-- Rewrites the admin check of existing functions without copying their bodies.
DO $$
DECLARE f record; def text; fixed text;
BEGIN
  FOR f IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
           WHERE n.nspname='public' AND p.proname IN ('retry_integration','resolve_integration_review','archive_leads','archive_open_leads') LOOP
    def:=pg_get_functiondef(f.oid);
    fixed:=regexp_replace(def,'public\.has_role\(a,\s*''admin''(::[a-z_.]+)?\)','public.is_global_admin(a)','g');
    IF fixed=def THEN RAISE EXCEPTION 'admin check not found in %',f.proname; END IF;
    EXECUTE fixed;
  END LOOP;
  -- Lead handling by an admin is limited to the countries a manager has.
  FOR f IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
           WHERE n.nspname='public' AND p.proname='record_lead_action' LOOP
    def:=pg_get_functiondef(f.oid);
    fixed:=regexp_replace(def,'public\.has_role\(a,\s*''admin''(::[a-z_.]+)?\)','public.has_admin_rights(a,bt.country)','g');
    IF fixed=def THEN RAISE EXCEPTION 'admin check not found in %',f.proname; END IF;
    EXECUTE fixed;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.release_batch(p_batch_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor(); b public.lead_batches%ROWTYPE;
BEGIN
 SELECT * INTO b FROM public.lead_batches WHERE id=p_batch_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'batch_not_found' USING ERRCODE='P0002'; END IF;
 IF NOT (public.has_admin_rights(a,b.country) OR b.assigned_to IS NOT DISTINCT FROM a) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 IF b.assigned_to IS NOT NULL THEN
  UPDATE public.lead_batches SET assigned_to=NULL,assigned_at=NULL WHERE id=b.id RETURNING * INTO b;
  INSERT INTO public.audit_events(actor,action,target_id) VALUES(a,'release_batch',b.id);
 END IF;
 RETURN jsonb_build_object('id',b.id,'assigned_to',b.assigned_to,'assigned_at',b.assigned_at);
END $$;
CREATE OR REPLACE FUNCTION public.reassign_batch(p_batch_id uuid, p_user_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor(); b public.lead_batches%ROWTYPE;
BEGIN
 SELECT * INTO b FROM public.lead_batches WHERE id=p_batch_id AND import_state='confirmed' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'batch_not_found' USING ERRCODE='P0002'; END IF;
 IF NOT public.has_admin_rights(a,b.country) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 IF NOT (public.has_role(p_user_id,'caller') OR public.has_role(p_user_id,'admin'))
    OR NOT (public.is_global_admin(p_user_id) OR EXISTS(SELECT 1 FROM public.user_countries WHERE user_id=p_user_id AND country=b.country)) THEN
  RAISE EXCEPTION 'invalid_assignee' USING ERRCODE='22023';
 END IF;
 UPDATE public.lead_batches SET assigned_to=p_user_id,assigned_at=now() WHERE id=b.id RETURNING * INTO b;
 INSERT INTO public.audit_events(actor,action,target_id) VALUES(a,'reassign_batch',b.id);
 RETURN jsonb_build_object('id',b.id,'assigned_to',b.assigned_to,'assigned_at',b.assigned_at);
END $$;

-- Appointments: recruits cannot book, veterans book for themselves, managers and admins book as the manager.
CREATE OR REPLACE FUNCTION public.save_calendar_appointment(p_starts_at timestamptz, p_kind text, p_title text, p_notes text, p_country text, p_lead_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid := auth.uid(); new_id uuid;
BEGIN
  IF a IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT public.can_access_country(p_country) THEN RAISE EXCEPTION 'country_forbidden'; END IF;
  IF public.user_role(a)='recruit' THEN RAISE EXCEPTION 'appointment_forbidden' USING ERRCODE='42501'; END IF;
  IF p_starts_at IS NULL THEN RAISE EXCEPTION 'missing_date'; END IF;
  INSERT INTO public.appointments(user_id, lead_id, starts_at, notes, title, kind, country)
  VALUES (a, p_lead_id, p_starts_at, nullif(btrim(p_notes),''), nullif(btrim(p_title),''), coalesce(p_kind,'other'), p_country)
  RETURNING id INTO new_id;
  RETURN new_id;
END $$;
DO $$
DECLARE f record; def text; fixed text;
BEGIN
  FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='create_appointment' LOOP
    def:=pg_get_functiondef(f.oid);
    fixed:=replace(def,'a uuid:=app_private.actor(); payload','a uuid:=app_private.actor(); payload');
    fixed:=regexp_replace(def,'BEGIN\s+r:=app_private.request','BEGIN'||E'\n'||' IF public.user_role(a)=''recruit'' THEN RAISE EXCEPTION ''appointment_forbidden'' USING ERRCODE=''42501''; END IF;'||E'\n'||' r:=app_private.request');
    IF fixed=def THEN RAISE EXCEPTION 'create_appointment not patched'; END IF;
    EXECUTE fixed;
  END LOOP;
END $$;

-- Calls this month (Vienna time), for the monthly goal on the dashboard.
CREATE FUNCTION public.get_caller_month(p_month date DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor(); m date:=date_trunc('month',coalesce(p_month,(now() AT TIME ZONE 'Europe/Vienna')::date))::date; n integer;
BEGIN
 SELECT count(*) INTO n FROM public.status_changes
  WHERE user_id=a AND new_status=ANY(app_private.call_outcomes())
    AND created_at>=m::timestamp AT TIME ZONE 'Europe/Vienna' AND created_at<(m+interval '1 month')::timestamp AT TIME ZONE 'Europe/Vienna';
 RETURN jsonb_build_object('month',m,'attempts',n,'timezone','Europe/Vienna');
END $$;
REVOKE ALL ON FUNCTION public.get_caller_month(date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_caller_month(date) TO authenticated;
