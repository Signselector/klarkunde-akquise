-- 1. Callers correct the customer data in the Kundenakte: company, contact, phone, e-mail, city, website, address.
--    Website and address live in leads.extra (imported columns); an existing key is reused, otherwise 'website' / 'adresse'.
--    Only the owner of the batch, the last caller or an admin of the country may change a lead.
CREATE OR REPLACE FUNCTION public.update_lead_contact(p_lead_id uuid,p_expected_version integer,p_contact jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor(); l public.leads%ROWTYPE; bt public.lead_batches%ROWTYPE; r jsonb; ex jsonb; k text; v text;
BEGIN
 IF p_contact IS NULL OR jsonb_typeof(p_contact)<>'object' OR octet_length(p_contact::text)>20000
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_contact) x WHERE x NOT IN ('company','contact_name','phone','email','city','website','address')) THEN
  RAISE EXCEPTION 'invalid_contact' USING ERRCODE='22023';
 END IF;
 IF nullif(btrim(p_contact->>'email'),'') IS NOT NULL AND p_contact->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RAISE EXCEPTION 'invalid_email' USING ERRCODE='22023'; END IF;
 IF length(coalesce(p_contact->>'website',''))>300 OR length(coalesce(p_contact->>'address',''))>300 THEN RAISE EXCEPTION 'invalid_contact' USING ERRCODE='22023'; END IF;
 SELECT * INTO l FROM public.leads WHERE id=p_lead_id AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'lead_not_found' USING ERRCODE='P0002'; END IF;
 SELECT * INTO bt FROM public.lead_batches WHERE id=l.batch_id;
 IF NOT public.can_access_country(bt.country) OR NOT (public.has_admin_rights(a,bt.country) OR bt.assigned_to IS NOT DISTINCT FROM a OR l.last_called_by IS NOT DISTINCT FROM a) THEN
  RAISE EXCEPTION 'not_your_lead' USING ERRCODE='42501';
 END IF;
 IF l.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'stale_lead' USING ERRCODE='40001'; END IF;
 IF EXISTS(SELECT 1 FROM public.lead_claims WHERE lead_id=l.id AND expires_at>now() AND user_id<>a) THEN RAISE EXCEPTION 'lead_claimed' USING ERRCODE='40001'; END IF;
 ex:=coalesce(l.extra,'{}'::jsonb);
 IF p_contact ? 'website' THEN
  SELECT key INTO k FROM jsonb_object_keys(ex) key WHERE lower(btrim(key)) IN ('website','webseite','web','url') LIMIT 1;
  v:=nullif(btrim(p_contact->>'website'),'');
  ex:=(ex-coalesce(k,'website'))||CASE WHEN v IS NULL THEN '{}'::jsonb ELSE jsonb_build_object(coalesce(k,'website'),v) END;
 END IF;
 IF p_contact ? 'address' THEN
  k:=NULL;
  SELECT key INTO k FROM jsonb_object_keys(ex) key WHERE lower(btrim(key)) IN ('adresse','address','anschrift') LIMIT 1;
  v:=nullif(btrim(p_contact->>'address'),'');
  ex:=(ex-coalesce(k,'adresse'))||CASE WHEN v IS NULL THEN '{}'::jsonb ELSE jsonb_build_object(coalesce(k,'adresse'),v) END;
 END IF;
 UPDATE public.leads SET
  company=CASE WHEN p_contact ? 'company' THEN nullif(btrim(p_contact->>'company'),'') ELSE company END,
  contact_name=CASE WHEN p_contact ? 'contact_name' THEN nullif(btrim(p_contact->>'contact_name'),'') ELSE contact_name END,
  email=CASE WHEN p_contact ? 'email' THEN nullif(lower(btrim(p_contact->>'email')),'') ELSE email END,
  phone=CASE WHEN p_contact ? 'phone' THEN nullif(btrim(p_contact->>'phone'),'') ELSE phone END,
  city=CASE WHEN p_contact ? 'city' THEN nullif(btrim(p_contact->>'city'),'') ELSE city END,
  extra=ex
 WHERE id=l.id RETURNING to_jsonb(leads.*) INTO r;
 INSERT INTO public.audit_events(actor,action,target_id) VALUES(a,'update_contact',l.id);
 RETURN r;
END $$;

-- 2. Appointments (everything except callbacks) can be booked at the earliest for the day after tomorrow (Vienna time).
CREATE OR REPLACE FUNCTION app_private.trg_appointment_lead_time() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.starts_at IS NULL OR coalesce(current_setting('app.skip_slot_check',true),'')='1' THEN RETURN NEW; END IF;
 IF NEW.starts_at < (date_trunc('day',now() AT TIME ZONE 'Europe/Vienna')+interval '2 days') AT TIME ZONE 'Europe/Vienna' THEN
  RAISE EXCEPTION 'appointment_too_soon' USING ERRCODE='22023';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS appointment_lead_time ON public.appointments;
CREATE TRIGGER appointment_lead_time BEFORE INSERT ON public.appointments FOR EACH ROW EXECUTE FUNCTION app_private.trg_appointment_lead_time();
