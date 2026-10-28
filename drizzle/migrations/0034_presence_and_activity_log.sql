-- Presence (online/offline) and a read-only activity log for managers and admins.
--  * user_presence: heartbeat of every signed-in user. A separate table (not columns on profiles) because profiles are
--    readable by every signed-in user, presence is only for managers and admins of the same country.
--  * activity_audit_logs: append-only. Written by triggers and by log_activity (login, logout, list views, exports).
--    Nobody can change or delete entries, not even admins. Managers see their countries, admins see everything.

CREATE TABLE public.user_presence (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  is_online boolean NOT NULL DEFAULT false
);
GRANT SELECT ON public.user_presence TO authenticated;
GRANT ALL ON public.user_presence TO service_role;
ALTER TABLE public.user_presence ENABLE ROW LEVEL SECURITY;

-- True when the user shares at least one country with the signed-in user.
CREATE FUNCTION app_private.shares_country(_a uuid,_b uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.user_countries x JOIN public.user_countries y ON y.country=x.country WHERE x.user_id=_a AND y.user_id=_b)
$$;
REVOKE ALL ON FUNCTION app_private.shares_country(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION app_private.shares_country(uuid,uuid) TO authenticated;

CREATE POLICY presence_read ON public.user_presence FOR SELECT TO authenticated USING (
  user_id = auth.uid()
  OR public.is_global_admin(auth.uid())
  OR (public.has_role(auth.uid(),'admin') AND app_private.shares_country(auth.uid(),user_id)));

CREATE FUNCTION public.heartbeat() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RETURN; END IF;
 INSERT INTO public.user_presence(user_id,last_seen_at,is_online) VALUES(auth.uid(),now(),true)
  ON CONFLICT (user_id) DO UPDATE SET last_seen_at=now(),is_online=true;
END $$;
CREATE FUNCTION public.set_offline() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RETURN; END IF;
 INSERT INTO public.user_presence(user_id,last_seen_at,is_online) VALUES(auth.uid(),now(),false)
  ON CONFLICT (user_id) DO UPDATE SET last_seen_at=now(),is_online=false;
END $$;
REVOKE ALL ON FUNCTION public.heartbeat(),public.set_offline() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.heartbeat(),public.set_offline() TO authenticated;

CREATE TYPE public.audit_action_type AS ENUM (
  'user_login','user_logout','batch_completed','batch_claimed','batch_released','batch_uploaded','batch_deleted',
  'user_registered','user_role_changed','user_deleted','user_deactivated','list_viewed','list_exported');

CREATE TABLE public.activity_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_name text NOT NULL,
  actor_email text NOT NULL,
  actor_role text NOT NULL,
  action public.audit_action_type NOT NULL,
  country text CHECK (country IS NULL OR country IN ('DE','AT','NL','ALL')),
  target_type text,
  target_id text,
  target_label text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX activity_audit_created_idx ON public.activity_audit_logs(created_at DESC, id);
CREATE INDEX activity_audit_country_idx ON public.activity_audit_logs(country, created_at DESC);
CREATE INDEX activity_audit_actor_idx ON public.activity_audit_logs(actor_id, created_at DESC);
GRANT SELECT ON public.activity_audit_logs TO authenticated;
GRANT ALL ON public.activity_audit_logs TO service_role;
ALTER TABLE public.activity_audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_log_read ON public.activity_audit_logs FOR SELECT TO authenticated USING (
  public.is_global_admin(auth.uid())
  OR (public.has_role(auth.uid(),'admin') AND (
        (country IN ('DE','AT','NL') AND public.has_admin_rights(auth.uid(),country))
     OR (actor_id IS NOT NULL AND app_private.shares_country(auth.uid(),actor_id)))));

-- Append only: no update and no delete. The one allowed change is the foreign key setting actor_id to NULL
-- when the account is deleted; the entry keeps name, e-mail and role.
CREATE FUNCTION app_private.audit_log_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.actor_id IS NULL AND OLD.actor_id IS NOT NULL
    AND (to_jsonb(NEW)-'actor_id')=(to_jsonb(OLD)-'actor_id') THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'audit_log_is_append_only' USING ERRCODE='23514';
END $$;
CREATE TRIGGER audit_log_guard BEFORE UPDATE OR DELETE ON public.activity_audit_logs FOR EACH ROW EXECUTE FUNCTION app_private.audit_log_guard();
CREATE TRIGGER audit_log_truncate_guard BEFORE TRUNCATE ON public.activity_audit_logs FOR EACH STATEMENT EXECUTE FUNCTION app_private.audit_log_guard();

CREATE FUNCTION app_private.audit_write(
  p_actor uuid,p_action public.audit_action_type,p_country text,p_type text,p_id text,p_label text,p_meta jsonb DEFAULT '{}'::jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n text; e text; r text;
BEGIN
 IF p_actor IS NOT NULL THEN
  SELECT p.display_name,p.email INTO n,e FROM public.profiles p WHERE p.id=p_actor;
  r:=public.user_role(p_actor);
 END IF;
 INSERT INTO public.activity_audit_logs(actor_id,actor_name,actor_email,actor_role,action,country,target_type,target_id,target_label,metadata)
  VALUES(p_actor,coalesce(n,e,CASE WHEN p_actor IS NULL THEN 'System' ELSE 'Unbekannt' END),coalesce(e,''),coalesce(r,'system'),p_action,p_country,p_type,p_id,p_label,coalesce(p_meta,'{}'::jsonb));
END $$;
REVOKE ALL ON FUNCTION app_private.audit_write(uuid,public.audit_action_type,text,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;

-- What the page may log itself: sessions, list views and exports. Everything else is written by triggers.
CREATE FUNCTION public.log_activity(
  p_action public.audit_action_type,p_country text DEFAULT NULL,p_target_type text DEFAULT NULL,
  p_target_id text DEFAULT NULL,p_target_label text DEFAULT NULL,p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=auth.uid();
BEGIN
 IF a IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='42501'; END IF;
 IF p_action NOT IN ('user_login','user_logout','list_viewed','list_exported') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 IF p_action IN ('list_viewed','list_exported') AND NOT public.has_role(a,'admin') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 IF p_country IS NOT NULL AND p_country NOT IN ('DE','AT','NL','ALL') THEN RAISE EXCEPTION 'validation_failed' USING ERRCODE='22023'; END IF;
 IF p_country IN ('DE','AT','NL') AND NOT public.can_access_country(p_country) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 IF p_country='ALL' AND NOT public.is_global_admin(a) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 IF octet_length(coalesce(p_metadata,'{}'::jsonb)::text)>4000 THEN RAISE EXCEPTION 'validation_failed' USING ERRCODE='22023'; END IF;
 PERFORM app_private.audit_write(a,p_action,p_country,left(p_target_type,40),left(p_target_id,80),left(p_target_label,200),p_metadata);
END $$;
REVOKE ALL ON FUNCTION public.log_activity(public.audit_action_type,text,text,text,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.log_activity(public.audit_action_type,text,text,text,text,jsonb) TO authenticated;

-- Server side (service role): account deletion happens outside the database session of the admin.
CREATE FUNCTION public.log_activity_for(
  p_actor uuid,p_action public.audit_action_type,p_country text,p_target_type text,p_target_id text,p_target_label text,p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT app_private.audit_write(p_actor,p_action,p_country,p_target_type,p_target_id,p_target_label,p_metadata)
$$;
REVOKE ALL ON FUNCTION public.log_activity_for(uuid,public.audit_action_type,text,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.log_activity_for(uuid,public.audit_action_type,text,text,text,text,jsonb) TO service_role;

-- ---- automatic entries ----
CREATE FUNCTION app_private.trg_audit_profile_new() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM app_private.audit_write(NEW.id,'user_registered',NULL,'user',NEW.id::text,coalesce(NEW.display_name,NEW.email));
 RETURN NEW;
END $$;
CREATE TRIGGER audit_profile_new AFTER INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION app_private.trg_audit_profile_new();

CREATE FUNCTION app_private.trg_audit_profile_active() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF OLD.active IS TRUE AND NEW.active IS NOT TRUE THEN
  PERFORM app_private.audit_write(auth.uid(),'user_deactivated',(SELECT min(country) FROM public.user_countries WHERE user_id=NEW.id),'user',NEW.id::text,coalesce(NEW.display_name,NEW.email));
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER audit_profile_active AFTER UPDATE OF active ON public.profiles FOR EACH ROW EXECUTE FUNCTION app_private.trg_audit_profile_active();

CREATE FUNCTION app_private.trg_audit_role() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 -- Roles given by the system when an account is created (no signed-in actor) are not a change.
 IF auth.uid() IS NULL THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND OLD.role IS NOT DISTINCT FROM NEW.role THEN RETURN NEW; END IF;
 PERFORM app_private.audit_write(auth.uid(),'user_role_changed',(SELECT min(country) FROM public.user_countries WHERE user_id=NEW.user_id),'user',NEW.user_id::text,
   (SELECT coalesce(display_name,email) FROM public.profiles WHERE id=NEW.user_id),
   jsonb_build_object('new_role',NEW.role::text)||CASE WHEN TG_OP='UPDATE' THEN jsonb_build_object('old_role',OLD.role::text) ELSE '{}'::jsonb END);
 RETURN NEW;
END $$;
CREATE TRIGGER audit_role AFTER INSERT OR UPDATE OF role ON public.user_roles FOR EACH ROW EXECUTE FUNCTION app_private.trg_audit_role();

CREATE FUNCTION app_private.trg_audit_batch() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  PERFORM app_private.audit_write(auth.uid(),'batch_deleted',OLD.country,'batch',OLD.id::text,OLD.name);
  RETURN OLD;
 END IF;
 IF OLD.assigned_to IS NULL AND NEW.assigned_to IS NOT NULL THEN
  PERFORM app_private.audit_write(coalesce(auth.uid(),NEW.assigned_to),'batch_claimed',NEW.country,'batch',NEW.id::text,NEW.name,jsonb_build_object('assigned_to',NEW.assigned_to));
 ELSIF OLD.assigned_to IS NOT NULL AND NEW.assigned_to IS NULL THEN
  PERFORM app_private.audit_write(auth.uid(),'batch_released',NEW.country,'batch',NEW.id::text,NEW.name,jsonb_build_object('released_from',OLD.assigned_to));
 END IF;
 IF OLD.import_state IS DISTINCT FROM NEW.import_state AND NEW.import_state='confirmed' THEN
  PERFORM app_private.audit_write(auth.uid(),'batch_uploaded',NEW.country,'batch',NEW.id::text,NEW.name);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER audit_batch_update AFTER UPDATE OF assigned_to,import_state ON public.lead_batches FOR EACH ROW EXECUTE FUNCTION app_private.trg_audit_batch();
CREATE TRIGGER audit_batch_delete AFTER DELETE ON public.lead_batches FOR EACH ROW EXECUTE FUNCTION app_private.trg_audit_batch();

-- A batch is completed when its last open lead has been worked on.
CREATE INDEX IF NOT EXISTS leads_batch_open_idx ON public.leads(batch_id) WHERE status='open' AND archived_at IS NULL;
CREATE FUNCTION app_private.trg_audit_batch_done() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.lead_batches%ROWTYPE;
BEGIN
 IF OLD.status='open' AND NEW.status<>'open'
    AND NOT EXISTS(SELECT 1 FROM public.leads x WHERE x.batch_id=NEW.batch_id AND x.status='open' AND x.archived_at IS NULL) THEN
  SELECT * INTO b FROM public.lead_batches WHERE id=NEW.batch_id AND import_state='confirmed';
  IF FOUND THEN PERFORM app_private.audit_write(auth.uid(),'batch_completed',b.country,'batch',b.id::text,b.name); END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER audit_batch_done AFTER UPDATE OF status ON public.leads FOR EACH ROW EXECUTE FUNCTION app_private.trg_audit_batch_done();
