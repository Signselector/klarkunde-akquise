CREATE FUNCTION public.move_lead(p_lead_id uuid,p_expected_version integer,p_batch_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor();
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.lead_batches WHERE id=p_batch_id AND import_state='confirmed') THEN RAISE EXCEPTION 'batch_not_found' USING ERRCODE='P0002'; END IF;
 UPDATE public.leads SET batch_id=p_batch_id WHERE id=p_lead_id AND version=p_expected_version AND archived_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'stale_lead' USING ERRCODE='40001'; END IF;
 INSERT INTO public.audit_events(actor,action,target_id) VALUES(a,'move_lead',p_lead_id);
END $$;
CREATE FUNCTION public.delete_appointment(p_appointment_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor();
BEGIN
 DELETE FROM public.appointments WHERE id=p_appointment_id AND (user_id=a OR public.has_role(a,'admin'));
 IF NOT FOUND THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 INSERT INTO public.audit_events(actor,action,target_id) VALUES(a,'delete_appointment',p_appointment_id);
END $$;
CREATE FUNCTION public.archive_open_leads() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor(); ids uuid[]; n integer:=0; count_updated integer;
BEGIN
 IF NOT public.has_role(a,'admin') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 -- Bounded chunks within one transaction; the final loop sees the prior updates.
 LOOP
  SELECT array_agg(id) INTO ids FROM (SELECT id FROM public.leads WHERE status='open' AND archived_at IS NULL ORDER BY id LIMIT 500 FOR UPDATE) x;
  EXIT WHEN ids IS NULL;
  count_updated:=public.archive_leads(ids); n:=n+count_updated;
 END LOOP;
 RETURN n;
END $$;
ALTER TABLE public.lead_notes ADD CONSTRAINT note_body_valid CHECK(length(btrim(body)) BETWEEN 1 AND 10000);
-- Table grants from old schemas sometimes include a permissive default anon grant.
REVOKE ALL ON public.leads,public.lead_batches,public.lead_notes,public.status_changes,public.callbacks,public.appointments,public.offers,public.offer_items,public.offer_customers,public.offer_products,public.profiles,public.user_roles,public.app_settings FROM anon;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid,public.app_role) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid,public.app_role) TO authenticated;
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('move_lead','delete_appointment','archive_open_leads') LOOP
  EXECUTE 'REVOKE ALL ON FUNCTION '||f.signature||' FROM PUBLIC,anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION '||f.signature||' TO authenticated';
 END LOOP;
END $$;
ALTER TABLE public.user_roles ADD CONSTRAINT one_role_per_user UNIQUE(user_id);
CREATE FUNCTION app_private.audit_roles() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO public.audit_events(actor,action,target_id) VALUES(auth.uid(),'role_'||lower(TG_OP),coalesce(NEW.user_id,OLD.user_id));
 RETURN coalesce(NEW,OLD);
END $$;
CREATE TRIGGER audit_roles AFTER INSERT OR UPDATE OR DELETE ON public.user_roles FOR EACH ROW EXECUTE FUNCTION app_private.audit_roles();
DROP POLICY "sc read" ON public.status_changes;
CREATE POLICY history_read ON public.status_changes FOR SELECT TO authenticated USING(user_id=auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE FUNCTION public.update_lead_contact(p_lead_id uuid,p_expected_version integer,p_contact jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor(); l public.leads%ROWTYPE; r jsonb;
BEGIN
 IF p_contact IS NULL OR jsonb_typeof(p_contact)<>'object' OR octet_length(p_contact::text)>20000 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_contact) k WHERE k NOT IN ('company','contact_name','phone','email','city')) THEN RAISE EXCEPTION 'invalid_contact' USING ERRCODE='22023'; END IF;
 IF nullif(btrim(p_contact->>'email'),'') IS NOT NULL AND p_contact->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RAISE EXCEPTION 'invalid_email' USING ERRCODE='22023'; END IF;
 SELECT * INTO l FROM public.leads WHERE id=p_lead_id AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'lead_not_found' USING ERRCODE='P0002'; END IF;
 IF l.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'stale_lead' USING ERRCODE='40001'; END IF;
 IF EXISTS(SELECT 1 FROM public.lead_claims WHERE lead_id=l.id AND expires_at>now() AND user_id<>a) THEN RAISE EXCEPTION 'lead_claimed' USING ERRCODE='40001'; END IF;
 UPDATE public.leads SET
 company=CASE WHEN p_contact ? 'company' THEN nullif(btrim(p_contact->>'company'),'') ELSE company END,
 contact_name=CASE WHEN p_contact ? 'contact_name' THEN nullif(btrim(p_contact->>'contact_name'),'') ELSE contact_name END,
 email=CASE WHEN p_contact ? 'email' THEN nullif(lower(btrim(p_contact->>'email')),'') ELSE email END,
 phone=CASE WHEN p_contact ? 'phone' THEN nullif(btrim(p_contact->>'phone'),'') ELSE phone END,
 city=CASE WHEN p_contact ? 'city' THEN nullif(btrim(p_contact->>'city'),'') ELSE city END
 WHERE id=l.id RETURNING to_jsonb(leads.*) INTO r;
 INSERT INTO public.audit_events(actor,action,target_id) VALUES(a,'update_contact',l.id);
 RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.update_lead_contact(uuid,integer,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_lead_contact(uuid,integer,jsonb) TO authenticated;
-- Remove implicit temp-schema resolution from the original role helper.
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid,_role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role=_role)
$$;
REVOKE CREATE ON SCHEMA public FROM PUBLIC,anon,authenticated;
