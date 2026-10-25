CREATE SCHEMA app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC, anon, authenticated;
CREATE TABLE app_private.requests (
 actor uuid NOT NULL, operation text NOT NULL, request_id uuid NOT NULL,
 payload jsonb NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(actor,operation,request_id)
);
CREATE FUNCTION app_private.actor() RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='42501'; END IF;
 IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'caller')) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 RETURN auth.uid();
END $$;
CREATE FUNCTION app_private.request(p_operation text,p_id uuid,p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor(); r app_private.requests%ROWTYPE;
BEGIN
 IF p_id IS NULL THEN RAISE EXCEPTION 'request_id_required' USING ERRCODE='22023'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(a::text||p_operation||p_id::text,0));
 SELECT * INTO r FROM app_private.requests WHERE actor=a AND operation=p_operation AND request_id=p_id;
 IF FOUND THEN
  IF r.payload IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='22023'; END IF;
  RETURN r.result;
 END IF;
 RETURN NULL;
END $$;
CREATE FUNCTION app_private.finish(p_operation text,p_id uuid,p_payload jsonb,p_result jsonb) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 INSERT INTO app_private.requests(actor,operation,request_id,payload,result) VALUES(auth.uid(),p_operation,p_id,p_payload,p_result) RETURNING result
$$;
CREATE TABLE public.audit_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor uuid, action text NOT NULL, target_id uuid, created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT ON public.audit_events TO authenticated;
GRANT ALL ON public.audit_events TO service_role;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_admin ON public.audit_events FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'admin'));
ALTER TABLE public.leads ADD COLUMN version integer NOT NULL DEFAULT 0, ADD COLUMN archived_at timestamptz;
ALTER TABLE public.leads ADD CONSTRAINT lead_status_valid CHECK(status IN ('open','callback','appointment','production','no_interest'));
ALTER TABLE public.leads ADD CONSTRAINT attempts_nonnegative CHECK(attempts>=0);
ALTER TABLE public.callbacks ADD COLUMN version integer NOT NULL DEFAULT 0;
ALTER TABLE public.offers ADD COLUMN version integer NOT NULL DEFAULT 0;
ALTER TABLE public.lead_batches ADD COLUMN import_state text NOT NULL DEFAULT 'confirmed' CHECK(import_state IN ('draft','confirmed'));
ALTER TABLE public.offer_products ADD CONSTRAINT product_price_valid CHECK(unit_price>=0 AND unit_price<1000000000);
ALTER TABLE public.offer_items ADD CONSTRAINT item_values_valid CHECK(quantity>0 AND quantity<1000000000 AND unit_price>=0 AND unit_price<1000000000 AND length(btrim(description))>0);
ALTER TABLE public.offers ADD CONSTRAINT offer_status_valid CHECK(status IN ('draft','sent','accepted','rejected'));
CREATE FUNCTION app_private.bump_version() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.version=OLD.version+1; RETURN NEW; END $$;
CREATE TRIGGER lead_version BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION app_private.bump_version();
CREATE TRIGGER callback_version BEFORE UPDATE ON public.callbacks FOR EACH ROW EXECUTE FUNCTION app_private.bump_version();
CREATE TRIGGER offer_version BEFORE UPDATE ON public.offers FOR EACH ROW EXECUTE FUNCTION app_private.bump_version();
CREATE TABLE public.lead_claims(lead_id uuid PRIMARY KEY REFERENCES public.leads(id) ON DELETE CASCADE, id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(), user_id uuid NOT NULL, expires_at timestamptz NOT NULL);
GRANT SELECT ON public.lead_claims TO authenticated;
GRANT ALL ON public.lead_claims TO service_role;
ALTER TABLE public.lead_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY claims_read ON public.lead_claims FOR SELECT TO authenticated USING(user_id=auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE INDEX claims_user ON public.lead_claims(user_id,expires_at);
CREATE FUNCTION public.claim_next_lead() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor(); l public.leads%ROWTYPE; c public.lead_claims%ROWTYPE; cb uuid;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('claim:'||a::text,0));
 SELECT x.* INTO c FROM public.lead_claims x JOIN public.leads y ON y.id=x.lead_id WHERE x.user_id=a AND x.expires_at>now() AND y.archived_at IS NULL LIMIT 1;
 IF FOUND THEN SELECT * INTO l FROM public.leads WHERE id=c.lead_id;
 ELSE
  SELECT x.* INTO l FROM public.leads x WHERE x.archived_at IS NULL AND
   (x.status='open' OR EXISTS(SELECT 1 FROM public.callbacks b WHERE b.lead_id=x.id AND b.user_id=a AND NOT b.done AND b.due_at<=now()))
   AND NOT EXISTS(SELECT 1 FROM public.lead_claims q WHERE q.lead_id=x.id AND q.expires_at>now())
   ORDER BY (SELECT min(b.due_at) FROM public.callbacks b WHERE b.lead_id=x.id AND b.user_id=a AND NOT b.done AND b.due_at<=now()) NULLS LAST,x.last_called_at NULLS FIRST,x.created_at,x.id
   LIMIT 1 FOR UPDATE OF x SKIP LOCKED;
  IF NOT FOUND THEN RETURN NULL; END IF;
  INSERT INTO public.lead_claims(lead_id,user_id,expires_at) VALUES(l.id,a,now()+interval '10 minutes')
   ON CONFLICT(lead_id) DO UPDATE SET id=gen_random_uuid(),user_id=a,expires_at=now()+interval '10 minutes' WHERE public.lead_claims.expires_at<=now() RETURNING * INTO c;
  IF NOT FOUND THEN RETURN NULL; END IF;
 END IF;
 SELECT id INTO cb FROM public.callbacks WHERE lead_id=l.id AND user_id=a AND NOT done AND due_at<=now() ORDER BY due_at,id LIMIT 1;
 RETURN jsonb_build_object('lead',to_jsonb(l),'claim_id',c.id,'expires_at',c.expires_at,'callback_id',cb);
END $$;
CREATE FUNCTION public.renew_lead_claim(p_claim_id uuid,p_release boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor(); c public.lead_claims%ROWTYPE;
BEGIN
 UPDATE public.lead_claims SET expires_at=CASE WHEN p_release THEN now() ELSE now()+interval '10 minutes' END
 WHERE id=p_claim_id AND user_id=a AND expires_at>now() RETURNING * INTO c;
 IF NOT FOUND THEN RAISE EXCEPTION 'claim_expired' USING ERRCODE='40001'; END IF;
 RETURN jsonb_build_object('claim_id',c.id,'expires_at',c.expires_at);
END $$;
ALTER FUNCTION public.record_call_outcome(uuid,uuid,integer,text,text,timestamptz,uuid) SET SCHEMA app_private;
REVOKE ALL ON FUNCTION app_private.record_call_outcome(uuid,uuid,integer,text,text,timestamptz,uuid) FROM authenticated;
CREATE FUNCTION public.record_call_outcome(p_request_id uuid,p_lead_id uuid,p_expected_attempts integer,p_outcome text,p_note text DEFAULT NULL,p_scheduled_at timestamptz DEFAULT NULL,p_callback_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor(); r jsonb; replay boolean;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(a::text||p_request_id::text,0));
 SELECT EXISTS(SELECT 1 FROM public.call_requests WHERE user_id=a AND request_id=p_request_id) INTO replay;
 IF NOT replay THEN
  PERFORM 1 FROM public.leads WHERE id=p_lead_id AND archived_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'lead_not_found' USING ERRCODE='P0002'; END IF;
  PERFORM 1 FROM public.lead_claims WHERE lead_id=p_lead_id AND user_id=a AND expires_at>now() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'claim_expired' USING ERRCODE='40001'; END IF;
 END IF;
 r:=app_private.record_call_outcome(p_request_id,p_lead_id,p_expected_attempts,p_outcome,p_note,p_scheduled_at,p_callback_id);
 IF NOT replay THEN DELETE FROM public.lead_claims WHERE lead_id=p_lead_id AND user_id=a; END IF;
 RETURN r;
END $$;
CREATE FUNCTION public.reopen_lead(p_request_id uuid,p_lead_id uuid,p_expected_version integer,p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor(); payload jsonb:=jsonb_build_array(p_lead_id,p_expected_version,p_reason); r jsonb; l public.leads%ROWTYPE;
BEGIN
 r:=app_private.request('reopen',p_request_id,payload); IF r IS NOT NULL THEN RETURN r; END IF;
 IF nullif(btrim(p_reason),'') IS NULL OR length(p_reason)>10000 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
 SELECT * INTO l FROM public.leads WHERE id=p_lead_id AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'lead_not_found' USING ERRCODE='P0002'; END IF;
 IF l.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'stale_lead' USING ERRCODE='40001'; END IF;
 IF EXISTS(SELECT 1 FROM public.lead_claims WHERE lead_id=l.id AND expires_at>now() AND user_id<>a) THEN RAISE EXCEPTION 'lead_claimed' USING ERRCODE='40001'; END IF;
 UPDATE public.leads SET status='open' WHERE id=l.id;
 INSERT INTO public.status_changes(lead_id,user_id,old_status,new_status) VALUES(l.id,a,l.status,'open');
 INSERT INTO public.lead_notes(lead_id,user_id,body) VALUES(l.id,a,p_reason);
 UPDATE public.callbacks SET done=true WHERE lead_id=l.id AND NOT done;
 DELETE FROM public.lead_claims WHERE lead_id=l.id;
 RETURN app_private.finish('reopen',p_request_id,payload,jsonb_build_object('lead_id',l.id,'version',l.version+1));
END $$;
CREATE FUNCTION public.complete_callback(p_request_id uuid,p_callback_id uuid,p_expected_version integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor(); payload jsonb:=jsonb_build_array(p_callback_id,p_expected_version); r jsonb;
BEGIN
 r:=app_private.request('complete_callback',p_request_id,payload); IF r IS NOT NULL THEN RETURN r; END IF;
 UPDATE public.callbacks SET done=true WHERE id=p_callback_id AND version=p_expected_version AND (user_id=a OR public.has_role(a,'admin')) RETURNING to_jsonb(callbacks.*) INTO r;
 IF NOT FOUND THEN RAISE EXCEPTION 'callback_conflict' USING ERRCODE='40001'; END IF;
 RETURN app_private.finish('complete_callback',p_request_id,payload,r);
END $$;
CREATE FUNCTION public.create_appointment(p_request_id uuid,p_starts_at timestamptz,p_notes text DEFAULT NULL,p_lead_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor(); payload jsonb:=jsonb_build_array(p_starts_at,p_notes,p_lead_id); r jsonb;
BEGIN
 r:=app_private.request('appointment',p_request_id,payload); IF r IS NOT NULL THEN RETURN r; END IF;
 IF p_starts_at IS NULL OR NOT isfinite(p_starts_at) OR p_starts_at<=now() OR length(p_notes)>10000 THEN RAISE EXCEPTION 'invalid_schedule' USING ERRCODE='22023'; END IF;
 IF p_lead_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.leads WHERE id=p_lead_id AND archived_at IS NULL) THEN RAISE EXCEPTION 'lead_not_found' USING ERRCODE='P0002'; END IF;
 INSERT INTO public.appointments(user_id,lead_id,starts_at,notes) VALUES(a,p_lead_id,p_starts_at,p_notes) RETURNING to_jsonb(appointments.*) INTO r;
 RETURN app_private.finish('appointment',p_request_id,payload,r);
END $$;
CREATE FUNCTION public.archive_leads(p_ids uuid[]) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor(); n integer;
BEGIN
 IF NOT public.has_role(a,'admin') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 IF cardinality(p_ids)>500 THEN RAISE EXCEPTION 'limit_exceeded' USING ERRCODE='22023'; END IF;
 UPDATE public.leads SET archived_at=now() WHERE id=ANY(p_ids) AND archived_at IS NULL; GET DIAGNOSTICS n=ROW_COUNT;
 UPDATE public.callbacks SET done=true WHERE lead_id=ANY(p_ids) AND NOT done;
 DELETE FROM public.lead_claims WHERE lead_id=ANY(p_ids);
 INSERT INTO public.audit_events(actor,action,target_id) SELECT a,'archive_lead',id FROM public.leads WHERE id=ANY(p_ids);
 RETURN n;
END $$;
CREATE FUNCTION app_private.phone(p text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT nullif(regexp_replace(coalesce(p,''),'[^0-9]','','g'),'') $$;
CREATE INDEX leads_phone_normalized ON public.leads(app_private.phone(phone));
CREATE INDEX leads_email_normalized ON public.leads(lower(btrim(email)));
CREATE TABLE public.import_rows(batch_id uuid REFERENCES public.lead_batches(id) ON DELETE CASCADE,row_no integer NOT NULL,data jsonb NOT NULL,errors text[] NOT NULL,PRIMARY KEY(batch_id,row_no));
GRANT SELECT ON public.import_rows TO authenticated;
GRANT ALL ON public.import_rows TO service_role;
ALTER TABLE public.import_rows ENABLE ROW LEVEL SECURITY;
CREATE POLICY import_read ON public.import_rows FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.lead_batches b WHERE b.id=batch_id AND (b.created_by=auth.uid() OR public.has_role(auth.uid(),'admin'))));
CREATE FUNCTION public.preview_import(p_request_id uuid,p_name text,p_rows jsonb,p_batch_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor(); payload jsonb:=jsonb_build_array(p_name,p_rows,p_batch_id); r jsonb; b uuid:=p_batch_id; row jsonb; errors text[]; pos integer; total integer;
BEGIN
 r:=app_private.request('preview_import',p_request_id,payload); IF r IS NOT NULL THEN RETURN r; END IF;
 IF p_rows IS NULL OR jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 500 OR octet_length(p_rows::text)>2000000 OR nullif(btrim(p_name),'') IS NULL OR length(p_name)>200 THEN RAISE EXCEPTION 'invalid_import' USING ERRCODE='22023'; END IF;
 IF b IS NULL THEN INSERT INTO public.lead_batches(name,created_by,import_state) VALUES(btrim(p_name),a,'draft') RETURNING id INTO b;
 ELSE PERFORM 1 FROM public.lead_batches WHERE id=b AND created_by=a AND import_state='draft' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'import_not_ready' USING ERRCODE='42501'; END IF;
 END IF;
 SELECT coalesce(max(row_no),0) INTO pos FROM public.import_rows WHERE batch_id=b;
 IF pos+jsonb_array_length(p_rows)>5000 THEN RAISE EXCEPTION 'limit_exceeded' USING ERRCODE='22023'; END IF;
 FOR row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  pos:=pos+1; errors:='{}';
  IF jsonb_typeof(row)<>'object' OR length(row::text)>20000 THEN RAISE EXCEPTION 'invalid_row' USING ERRCODE='22023'; END IF;
  IF nullif(btrim(row->>'company'),'') IS NULL AND nullif(btrim(row->>'contact_name'),'') IS NULL THEN errors:=array_append(errors,'missing_name'); END IF;
  IF nullif(btrim(row->>'phone'),'') IS NULL AND nullif(btrim(row->>'email'),'') IS NULL THEN errors:=array_append(errors,'missing_contact'); END IF;
  IF nullif(btrim(row->>'email'),'') IS NOT NULL AND btrim(row->>'email') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN errors:=array_append(errors,'invalid_email'); END IF;
  IF nullif(btrim(row->>'phone'),'') IS NOT NULL AND length(coalesce(app_private.phone(row->>'phone'),'')) NOT BETWEEN 5 AND 18 THEN errors:=array_append(errors,'invalid_phone'); END IF;
  INSERT INTO public.import_rows VALUES(b,pos,row,errors);
 END LOOP;
 SELECT count(*) INTO total FROM public.import_rows WHERE batch_id=b AND cardinality(import_rows.errors)>0;
 RETURN app_private.finish('preview_import',p_request_id,payload,jsonb_build_object('batch_id',b,'rows',pos,'invalid',total));
END $$;
CREATE FUNCTION public.import_duplicates(p_batch_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor(); r jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.lead_batches WHERE id=p_batch_id AND (created_by=a OR public.has_role(a,'admin'))) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(x.row_no),'[]') INTO r FROM public.import_rows x WHERE batch_id=p_batch_id AND
 (EXISTS(SELECT 1 FROM public.leads l WHERE (app_private.phone(l.phone)=app_private.phone(x.data->>'phone')) OR (nullif(lower(btrim(l.email)),'')=nullif(lower(btrim(x.data->>'email')),'')))
 OR EXISTS(SELECT 1 FROM public.import_rows y WHERE y.batch_id=x.batch_id AND y.row_no<x.row_no AND
 ((app_private.phone(y.data->>'phone')=app_private.phone(x.data->>'phone')) OR (nullif(lower(btrim(y.data->>'email')),'')=nullif(lower(btrim(x.data->>'email')),'')))));
 RETURN r;
END $$;
CREATE FUNCTION public.confirm_import(p_request_id uuid,p_batch_id uuid,p_skip_rows integer[] DEFAULT '{}',p_allow_duplicates boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor(); payload jsonb:=jsonb_build_array(p_batch_id,p_skip_rows,p_allow_duplicates); r jsonb; n integer;
BEGIN
 r:=app_private.request('confirm_import',p_request_id,payload); IF r IS NOT NULL THEN RETURN r; END IF;
 IF p_skip_rows IS NULL OR p_allow_duplicates IS NULL THEN RAISE EXCEPTION 'invalid_import' USING ERRCODE='22023'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(71923102);
 PERFORM 1 FROM public.lead_batches WHERE id=p_batch_id AND import_state='draft' AND (created_by=a OR public.has_role(a,'admin')) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'import_not_ready' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(p_skip_rows) s WHERE s IS NULL OR NOT EXISTS(SELECT 1 FROM public.import_rows WHERE batch_id=p_batch_id AND row_no=s)) THEN RAISE EXCEPTION 'invalid_skip_rows' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM public.import_rows WHERE batch_id=p_batch_id AND NOT(row_no=ANY(p_skip_rows)) AND cardinality(errors)>0) THEN RAISE EXCEPTION 'invalid_rows' USING ERRCODE='22023'; END IF;
 IF NOT p_allow_duplicates AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(public.import_duplicates(p_batch_id)) d WHERE NOT(d::integer=ANY(p_skip_rows))) THEN RAISE EXCEPTION 'duplicate_decision_required' USING ERRCODE='22023'; END IF;
 INSERT INTO public.leads(batch_id,company,contact_name,phone,email,city,extra)
 SELECT p_batch_id,nullif(btrim(data->>'company'),''),nullif(btrim(data->>'contact_name'),''),nullif(btrim(data->>'phone'),''),nullif(lower(btrim(data->>'email')),''),nullif(btrim(data->>'city'),''),coalesce(data->'extra','{}'::jsonb)
 FROM public.import_rows WHERE batch_id=p_batch_id AND NOT(row_no=ANY(p_skip_rows)); GET DIAGNOSTICS n=ROW_COUNT;
 UPDATE public.lead_batches SET import_state='confirmed' WHERE id=p_batch_id;
 RETURN app_private.finish('confirm_import',p_request_id,payload,jsonb_build_object('batch_id',p_batch_id,'inserted',n,'skipped',cardinality(p_skip_rows)));
END $$;
CREATE SEQUENCE public.offer_number_seq;
GRANT USAGE ON SEQUENCE public.offer_number_seq TO service_role;
CREATE FUNCTION public.save_offer(p_request_id uuid,p_customer_id uuid,p_items jsonb,p_note text DEFAULT NULL,p_offer_id uuid DEFAULT NULL,p_expected_version integer DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor(); payload jsonb:=jsonb_build_array(p_customer_id,p_items,p_note,p_offer_id,p_expected_version); r jsonb; o public.offers%ROWTYPE; i jsonb; amount numeric;
BEGIN
 r:=app_private.request('save_offer',p_request_id,payload); IF r IS NOT NULL THEN RETURN r; END IF;
 IF p_items IS NULL OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 100 OR length(p_note)>10000 THEN RAISE EXCEPTION 'invalid_items' USING ERRCODE='22023'; END IF;
 IF p_customer_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.offer_customers WHERE id=p_customer_id) THEN RAISE EXCEPTION 'customer_not_found' USING ERRCODE='P0002'; END IF;
 IF p_offer_id IS NULL THEN
  INSERT INTO public.offers(offer_number,customer_id,note,created_by) VALUES('A-'||to_char(now() AT TIME ZONE 'Europe/Vienna','YYYY')||'-'||lpad(nextval('public.offer_number_seq')::text,8,'0'),p_customer_id,p_note,a) RETURNING * INTO o;
 ELSE
  SELECT * INTO o FROM public.offers WHERE id=p_offer_id AND (created_by=a OR public.has_role(a,'admin')) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'offer_not_found' USING ERRCODE='P0002'; END IF;
  IF o.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'stale_offer' USING ERRCODE='40001'; END IF;
  IF o.status<>'draft' THEN RAISE EXCEPTION 'offer_locked' USING ERRCODE='22023'; END IF;
  UPDATE public.offers SET customer_id=p_customer_id,note=p_note WHERE id=o.id RETURNING * INTO o;
  DELETE FROM public.offer_items WHERE offer_id=o.id;
 END IF;
 FOR i IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  IF jsonb_typeof(i)<>'object' OR nullif(btrim(i->>'description'),'') IS NULL OR length(i->>'description')>2000 OR
    coalesce(i->>'quantity','') !~ '^[0-9]+(\.[0-9]{1,2})?$' OR coalesce(i->>'unit_price','') !~ '^[0-9]+(\.[0-9]{1,2})?$' THEN RAISE EXCEPTION 'invalid_item' USING ERRCODE='22023'; END IF;
  INSERT INTO public.offer_items(offer_id,product_id,description,quantity,unit_price) VALUES(o.id,(i->>'product_id')::uuid,btrim(i->>'description'),(i->>'quantity')::numeric,(i->>'unit_price')::numeric);
 END LOOP;
 SELECT sum(round(quantity*unit_price,2)) INTO amount FROM public.offer_items WHERE offer_id=o.id;
 RETURN app_private.finish('save_offer',p_request_id,payload,jsonb_build_object('offer_id',o.id,'offer_number',o.offer_number,'total',amount,'version',o.version));
END $$;
CREATE FUNCTION public.set_offer_status(p_offer_id uuid,p_expected_version integer,p_status text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor(); r jsonb; o public.offers%ROWTYPE;
BEGIN
 SELECT * INTO o FROM public.offers WHERE id=p_offer_id AND (created_by=a OR public.has_role(a,'admin')) FOR UPDATE;
 IF NOT FOUND OR o.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'stale_offer' USING ERRCODE='40001'; END IF;
 IF NOT ((o.status='draft' AND p_status='sent') OR (o.status='sent' AND p_status IN ('accepted','rejected')) OR (o.status='rejected' AND p_status='draft')) THEN RAISE EXCEPTION 'invalid_transition' USING ERRCODE='22023'; END IF;
 IF p_status IS NULL OR p_status NOT IN ('draft','sent','accepted','rejected') THEN RAISE EXCEPTION 'invalid_status' USING ERRCODE='22023'; END IF;
 UPDATE public.offers SET status=p_status WHERE id=p_offer_id AND version=p_expected_version AND (created_by=a OR public.has_role(a,'admin')) RETURNING to_jsonb(offers.*) INTO r;
 IF NOT FOUND THEN RAISE EXCEPTION 'stale_offer' USING ERRCODE='40001'; END IF;
 RETURN r;
END $$;
REVOKE INSERT,UPDATE,DELETE ON public.leads,public.lead_batches,public.status_changes,public.callbacks,public.appointments,public.offers,public.offer_items FROM authenticated;
DROP POLICY "of all" ON public.offers;
CREATE POLICY offers_read ON public.offers FOR SELECT TO authenticated USING(created_by=auth.uid() OR public.has_role(auth.uid(),'admin'));
DROP POLICY "oi all" ON public.offer_items;
CREATE POLICY items_read ON public.offer_items FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.offers WHERE id=offer_id));
DROP POLICY "oc all" ON public.offer_customers;
CREATE POLICY customers_read ON public.offer_customers FOR SELECT TO authenticated USING(true);
CREATE POLICY customers_insert ON public.offer_customers FOR INSERT TO authenticated WITH CHECK(created_by=auth.uid());
CREATE POLICY customers_update ON public.offer_customers FOR UPDATE TO authenticated USING(created_by=auth.uid() OR public.has_role(auth.uid(),'admin')) WITH CHECK(created_by=auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY customers_delete ON public.offer_customers FOR DELETE TO authenticated USING(public.has_role(auth.uid(),'admin'));
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('claim_next_lead','renew_lead_claim','record_call_outcome','reopen_lead','complete_callback','create_appointment','archive_leads','preview_import','import_duplicates','confirm_import','save_offer','set_offer_status') LOOP
  EXECUTE 'REVOKE ALL ON FUNCTION '||f.signature||' FROM PUBLIC, anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION '||f.signature||' TO authenticated';
 END LOOP;
END $$;

-- Integrations. test_mode (default ON) means sync jobs are only recorded as simulated, never sent.
CREATE TABLE public.integration_config (
 id boolean PRIMARY KEY DEFAULT true CHECK(id), enabled boolean NOT NULL DEFAULT false,
 test_mode boolean NOT NULL DEFAULT true,
 pipeline_id bigint, appointment_stage_id bigint, production_stage_id bigint, owner_id bigint,
 CHECK(NOT enabled OR (pipeline_id IS NOT NULL AND appointment_stage_id IS NOT NULL AND production_stage_id IS NOT NULL AND pipeline_id>0 AND appointment_stage_id>0 AND production_stage_id>0))
);
INSERT INTO public.integration_config(id) VALUES(true);
GRANT SELECT,UPDATE ON public.integration_config TO authenticated;
GRANT ALL ON public.integration_config TO service_role;
ALTER TABLE public.integration_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY config_read ON public.integration_config FOR SELECT TO authenticated USING(true);
CREATE POLICY config_admin ON public.integration_config FOR UPDATE TO authenticated USING(public.has_role(auth.uid(),'admin')) WITH CHECK(public.has_role(auth.uid(),'admin'));
CREATE TABLE public.integration_jobs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lead_id uuid NOT NULL REFERENCES public.leads(id),
 event_id uuid NOT NULL UNIQUE REFERENCES public.status_changes(id), outcome text NOT NULL CHECK(outcome IN ('appointment','production')),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','succeeded','failed','needs_review','simulated')),
 attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
 lease_token uuid, lease_until timestamptz, error_code text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_due ON public.integration_jobs(status,next_attempt_at);
CREATE TABLE app_private.integration_links(lead_id uuid PRIMARY KEY REFERENCES public.leads(id), organization_id bigint, person_id bigint, deal_id bigint, updated_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT ON public.integration_jobs TO authenticated;
GRANT ALL ON public.integration_jobs TO service_role;
ALTER TABLE public.integration_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY jobs_read ON public.integration_jobs FOR SELECT TO authenticated USING(true);
CREATE FUNCTION app_private.enqueue_sync() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE tm boolean;
BEGIN
 IF NEW.new_status IN ('appointment','production') THEN
  SELECT test_mode INTO tm FROM public.integration_config WHERE id;
  INSERT INTO public.integration_jobs(lead_id,event_id,outcome,status) VALUES(NEW.lead_id,NEW.id,NEW.new_status,CASE WHEN coalesce(tm,true) THEN 'simulated' ELSE 'pending' END);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER queue_sync AFTER INSERT ON public.status_changes FOR EACH ROW EXECUTE FUNCTION app_private.enqueue_sync();
CREATE FUNCTION public.claim_integration_jobs(p_limit integer DEFAULT 5) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb:='[]'; j public.integration_jobs%ROWTYPE; cfg public.integration_config%ROWTYPE; l public.leads%ROWTYPE;
BEGIN
 SELECT * INTO cfg FROM public.integration_config WHERE id;
 IF NOT cfg.enabled OR cfg.test_mode THEN RETURN result; END IF;
 UPDATE public.integration_jobs SET status='needs_review',error_code='lease_expired',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE status='running' AND lease_until<now();
 FOR j IN SELECT x.* FROM public.integration_jobs x WHERE x.status='pending' AND x.next_attempt_at<=now() AND x.attempts<8
  AND NOT EXISTS(SELECT 1 FROM public.integration_jobs prev WHERE prev.lead_id=x.lead_id AND prev.status NOT IN ('succeeded','simulated') AND (prev.created_at,prev.id)<(x.created_at,x.id))
  ORDER BY x.created_at,x.id LIMIT greatest(1,least(coalesce(p_limit,5),10)) FOR UPDATE SKIP LOCKED LOOP
  PERFORM 1 FROM public.leads WHERE id=j.lead_id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.integration_jobs WHERE lead_id=j.lead_id AND status='running') THEN CONTINUE; END IF;
  UPDATE public.integration_jobs SET status='running',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',updated_at=now() WHERE id=j.id RETURNING * INTO j;
  SELECT * INTO l FROM public.leads WHERE id=j.lead_id;
  result:=result||jsonb_build_array(jsonb_build_object('job',to_jsonb(j),'lead',to_jsonb(l),'config',to_jsonb(cfg),'links',coalesce((SELECT to_jsonb(k) FROM app_private.integration_links k WHERE lead_id=j.lead_id),'{}')));
 END LOOP;
 RETURN result;
END $$;
CREATE FUNCTION public.checkpoint_integration(p_job_id uuid,p_lease_token uuid,p_kind text,p_external_id bigint) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.integration_jobs%ROWTYPE;
BEGIN
 SELECT * INTO j FROM public.integration_jobs WHERE id=p_job_id AND status='running' AND lease_token=p_lease_token AND lease_until>now() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'lease_expired' USING ERRCODE='40001'; END IF;
 IF p_external_id IS NULL OR p_external_id<=0 OR p_kind IS NULL OR p_kind NOT IN ('organization','person','deal') THEN RAISE EXCEPTION 'invalid_checkpoint' USING ERRCODE='22023'; END IF;
 INSERT INTO app_private.integration_links(lead_id) VALUES(j.lead_id) ON CONFLICT DO NOTHING;
 IF p_kind='organization' THEN UPDATE app_private.integration_links SET organization_id=p_external_id,updated_at=now() WHERE lead_id=j.lead_id;
 ELSIF p_kind='person' THEN UPDATE app_private.integration_links SET person_id=p_external_id,updated_at=now() WHERE lead_id=j.lead_id;
 ELSE UPDATE app_private.integration_links SET deal_id=p_external_id,updated_at=now() WHERE lead_id=j.lead_id; END IF;
END $$;
CREATE FUNCTION public.finish_integration_job(p_job_id uuid,p_lease_token uuid,p_status text,p_error_code text DEFAULT NULL,p_retry_after integer DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.integration_jobs%ROWTYPE; delay integer;
BEGIN
 SELECT * INTO j FROM public.integration_jobs WHERE id=p_job_id AND status='running' AND lease_token=p_lease_token AND lease_until>now() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'lease_expired' USING ERRCODE='40001'; END IF;
 IF p_status IS NULL OR p_status NOT IN ('succeeded','pending','failed','needs_review') THEN RAISE EXCEPTION 'invalid_status' USING ERRCODE='22023'; END IF;
 IF p_error_code IS NOT NULL AND p_error_code NOT IN ('rate_limited','unauthorized','invalid_payload','provider_error','ambiguous_response','checkpoint_failed','missing_contact','archived_lead','configuration_error','network_error') THEN RAISE EXCEPTION 'invalid_error_code' USING ERRCODE='22023'; END IF;
 delay:=greatest(least(coalesce(p_retry_after,0),86400),least(3600,(30*power(2,j.attempts-1))::integer));
 UPDATE public.integration_jobs SET status=CASE WHEN p_status='pending' AND attempts>=8 THEN 'failed' ELSE p_status END,
 error_code=p_error_code,next_attempt_at=now()+make_interval(secs=>delay),lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=j.id;
END $$;
CREATE FUNCTION public.retry_integration(p_job_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor(); r jsonb;
BEGIN
 IF NOT public.has_role(a,'admin') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 UPDATE public.integration_jobs SET status='pending',attempts=0,error_code=NULL,next_attempt_at=now(),updated_at=now() WHERE id=p_job_id AND status='failed' RETURNING to_jsonb(integration_jobs.*) INTO r;
 IF NOT FOUND THEN RAISE EXCEPTION 'not_retryable' USING ERRCODE='22023'; END IF;
 INSERT INTO public.audit_events(actor,action,target_id) VALUES(a,'retry_integration',p_job_id);
 RETURN r;
END $$;
CREATE FUNCTION public.resolve_integration_review(p_job_id uuid,p_organization_id bigint,p_person_id bigint,p_deal_id bigint,p_confirmed_absent boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor(); j public.integration_jobs%ROWTYPE;
BEGIN
 IF NOT public.has_role(a,'admin') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO j FROM public.integration_jobs WHERE id=p_job_id AND status='needs_review' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'not_reviewable' USING ERRCODE='22023'; END IF;
 IF NOT coalesce(p_confirmed_absent,false) AND p_deal_id IS NULL AND p_person_id IS NULL AND p_organization_id IS NULL THEN RAISE EXCEPTION 'review_required' USING ERRCODE='22023'; END IF;
 IF coalesce(p_organization_id,1)<=0 OR coalesce(p_person_id,1)<=0 OR coalesce(p_deal_id,1)<=0 THEN RAISE EXCEPTION 'invalid_external_id' USING ERRCODE='22023'; END IF;
 INSERT INTO app_private.integration_links(lead_id,organization_id,person_id,deal_id) VALUES(j.lead_id,p_organization_id,p_person_id,p_deal_id)
 ON CONFLICT(lead_id) DO UPDATE SET organization_id=coalesce(EXCLUDED.organization_id,integration_links.organization_id),person_id=coalesce(EXCLUDED.person_id,integration_links.person_id),deal_id=coalesce(EXCLUDED.deal_id,integration_links.deal_id),updated_at=now();
 UPDATE public.integration_jobs SET status='pending',attempts=0,next_attempt_at=now(),error_code=NULL WHERE id=j.id;
 INSERT INTO public.audit_events(actor,action,target_id) VALUES(a,'resolve_integration',j.id);
END $$;
CREATE FUNCTION public.backend_maintenance() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE claims integer; jobs integer;
BEGIN
 DELETE FROM public.lead_claims WHERE expires_at<=now(); GET DIAGNOSTICS claims=ROW_COUNT;
 UPDATE public.integration_jobs SET status='needs_review',error_code='lease_expired',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE status='running' AND lease_until<now(); GET DIAGNOSTICS jobs=ROW_COUNT;
 RETURN jsonb_build_object('expired_claims',claims,'expired_jobs',jobs);
END $$;
CREATE TABLE public.quality_resolutions(lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE,kind text NOT NULL,reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),resolved_by uuid NOT NULL, resolved_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(lead_id,kind));
GRANT SELECT ON public.quality_resolutions TO authenticated;
GRANT ALL ON public.quality_resolutions TO service_role;
ALTER TABLE public.quality_resolutions ENABLE ROW LEVEL SECURITY;
CREATE POLICY quality_read ON public.quality_resolutions FOR SELECT TO authenticated USING(true);
CREATE FUNCTION public.get_quality_issues(p_limit integer DEFAULT 100,p_offset integer DEFAULT 0) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor(); r jsonb;
BEGIN
 WITH issues AS (
 SELECT l.id AS lead_id,'missing_phone' AS kind FROM public.leads l WHERE archived_at IS NULL AND app_private.phone(phone) IS NULL
 UNION ALL SELECT id,'invalid_email' FROM public.leads WHERE archived_at IS NULL AND nullif(btrim(email),'') IS NOT NULL AND email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
 UNION ALL SELECT l.id,'possible_duplicate' FROM public.leads l WHERE archived_at IS NULL AND EXISTS(SELECT 1 FROM public.leads x WHERE x.id<>l.id AND x.archived_at IS NULL AND (app_private.phone(x.phone)=app_private.phone(l.phone) OR nullif(lower(btrim(x.email)),'')=nullif(lower(btrim(l.email)),'')))
 UNION ALL SELECT DISTINCT c.lead_id,'overdue_callback' FROM public.callbacks c JOIN public.leads l ON l.id=c.lead_id WHERE NOT c.done AND c.due_at<now() AND l.archived_at IS NULL AND (c.user_id=a OR public.has_role(a,'admin'))
 UNION ALL SELECT id,'missing_sync_contact' FROM public.leads WHERE archived_at IS NULL AND status IN ('appointment','production') AND nullif(btrim(contact_name),'') IS NULL
 ) SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]') INTO r FROM (SELECT i.*,coalesce(l.company,l.contact_name,'Ohne Name') AS company,r.reason AS acknowledged_reason FROM issues i JOIN public.leads l ON l.id=i.lead_id LEFT JOIN public.quality_resolutions r USING(lead_id,kind) ORDER BY lead_id,kind LIMIT greatest(1,least(coalesce(p_limit,100),500)) OFFSET greatest(coalesce(p_offset,0),0)) q;
 RETURN r;
END $$;
CREATE FUNCTION public.acknowledge_quality(p_lead_id uuid,p_kind text,p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor();
BEGIN
 IF p_kind IS NULL OR p_kind NOT IN ('missing_phone','invalid_email','possible_duplicate','overdue_callback','missing_sync_contact') THEN RAISE EXCEPTION 'invalid_kind' USING ERRCODE='22023'; END IF;
 INSERT INTO public.quality_resolutions(lead_id,kind,reason,resolved_by) VALUES(p_lead_id,p_kind,p_reason,a)
 ON CONFLICT(lead_id,kind) DO UPDATE SET reason=EXCLUDED.reason,resolved_by=a,resolved_at=now();
END $$;
CREATE FUNCTION public.get_dashboard(p_from date,p_to date,p_scope text DEFAULT 'mine') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor(); r jsonb; start_at timestamptz; end_at timestamptz;
BEGIN
 IF p_from IS NULL OR p_to IS NULL OR p_to<p_from OR p_to-p_from>366 OR p_scope IS NULL OR p_scope NOT IN ('mine','team') THEN RAISE EXCEPTION 'invalid_range' USING ERRCODE='22023'; END IF;
 IF p_scope='team' AND NOT public.has_role(a,'admin') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 start_at:=p_from::timestamp AT TIME ZONE 'Europe/Vienna'; end_at:=(p_to+1)::timestamp AT TIME ZONE 'Europe/Vienna';
 WITH days AS (SELECT p_from+n AS day FROM generate_series(0,p_to-p_from) n), events AS (
 SELECT (created_at AT TIME ZONE 'Europe/Vienna')::date AS day,new_status FROM public.status_changes WHERE created_at>=start_at AND created_at<end_at AND (p_scope='team' OR user_id=a) AND new_status IN ('not_reached','no_interest','callback','appointment','production')
 ), daily AS (SELECT d.day,count(e.new_status)::int attempts,count(*) FILTER(WHERE e.new_status<>'not_reached')::int reached,count(*) FILTER(WHERE e.new_status='appointment')::int appointments,count(*) FILTER(WHERE e.new_status='production')::int production,count(*) FILTER(WHERE e.new_status='not_reached')::int not_reached,count(*) FILTER(WHERE e.new_status='no_interest')::int no_interest,count(*) FILTER(WHERE e.new_status='callback')::int callback FROM days d LEFT JOIN events e USING(day) GROUP BY d.day ORDER BY d.day)
 SELECT jsonb_build_object('timezone','Europe/Vienna','daily',jsonb_agg(to_jsonb(daily)),'attempts',sum(attempts),'reached',sum(reached),'appointments',sum(appointments),'production',sum(production),'not_reached',sum(not_reached),'no_interest',sum(no_interest),'callback',sum(callback),'appointment_rate',CASE WHEN sum(attempts)=0 THEN 0 ELSE round(sum(appointments)::numeric/sum(attempts),4) END) INTO r FROM daily;
 RETURN r;
END $$;
CREATE FUNCTION public.get_batch_progress() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor(); r jsonb;
BEGIN
 SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') INTO r FROM (SELECT b.id,b.name,b.import_state,b.created_at,count(l.id)::int total,count(l.id) FILTER(WHERE l.status<>'open' OR l.archived_at IS NOT NULL)::int completed FROM public.lead_batches b LEFT JOIN public.leads l ON l.batch_id=b.id GROUP BY b.id ORDER BY b.created_at DESC,b.id LIMIT 500) x; RETURN r;
END $$;
CREATE FUNCTION public.get_capabilities() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor(); admin boolean:=public.has_role(a,'admin');
BEGIN RETURN jsonb_build_object('user_id',a,'role',CASE WHEN admin THEN 'admin' ELSE 'caller' END,'can_manage_accounts',admin,'can_archive_leads',admin,'can_manage_products',admin,'can_retry_integrations',admin,'can_view_team_stats',admin,'can_import',true,'can_call',true); END $$;
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure signature,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('claim_integration_jobs','checkpoint_integration','finish_integration_job','backend_maintenance','retry_integration','resolve_integration_review','get_quality_issues','acknowledge_quality','get_dashboard','get_batch_progress','get_capabilities') LOOP
  EXECUTE 'REVOKE ALL ON FUNCTION '||f.signature||' FROM PUBLIC, anon, authenticated';
  IF f.proname IN ('claim_integration_jobs','checkpoint_integration','finish_integration_job','backend_maintenance') THEN EXECUTE 'GRANT EXECUTE ON FUNCTION '||f.signature||' TO service_role';
  ELSE EXECUTE 'GRANT EXECUTE ON FUNCTION '||f.signature||' TO authenticated'; END IF;
 END LOOP;
END $$;

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
 LOOP
  SELECT array_agg(id) INTO ids FROM (SELECT id FROM public.leads WHERE status='open' AND archived_at IS NULL ORDER BY id LIMIT 500 FOR UPDATE) x;
  EXIT WHEN ids IS NULL;
  count_updated:=public.archive_leads(ids); n:=n+count_updated;
 END LOOP;
 RETURN n;
END $$;
ALTER TABLE public.lead_notes ADD CONSTRAINT note_body_valid CHECK(length(btrim(body)) BETWEEN 1 AND 10000);
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
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid,_role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role=_role)
$$;
REVOKE CREATE ON SCHEMA public FROM PUBLIC,anon,authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.user_roles FROM authenticated;