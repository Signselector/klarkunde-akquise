CREATE OR REPLACE FUNCTION public.is_master(_uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = _uid AND lower(email) = 'office@signselector.com')
$$;

CREATE TABLE public.user_countries (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  country text NOT NULL CHECK (country IN ('DE','AT','NL')),
  PRIMARY KEY (user_id, country)
);
GRANT SELECT, INSERT, DELETE ON public.user_countries TO authenticated;
GRANT ALL ON public.user_countries TO service_role;
ALTER TABLE public.user_countries ENABLE ROW LEVEL SECURITY;
CREATE POLICY uc_read ON public.user_countries FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY uc_master_insert ON public.user_countries FOR INSERT TO authenticated WITH CHECK (public.is_master(auth.uid()));
CREATE POLICY uc_master_delete ON public.user_countries FOR DELETE TO authenticated USING (public.is_master(auth.uid()));
INSERT INTO public.user_countries (user_id, country) SELECT id, 'DE' FROM public.profiles ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.can_access_country(_c text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_master(auth.uid()) OR EXISTS (SELECT 1 FROM public.user_countries WHERE user_id = auth.uid() AND country = _c)
$$;

CREATE OR REPLACE FUNCTION public.my_countries() RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN public.is_master(auth.uid()) THEN ARRAY['DE','AT','NL']
    ELSE COALESCE((SELECT array_agg(country ORDER BY country) FROM public.user_countries WHERE user_id = auth.uid()), ARRAY[]::text[]) END
$$;

ALTER TABLE public.callbacks ADD COLUMN country text NOT NULL DEFAULT 'DE';
ALTER TABLE public.appointments ADD COLUMN country text NOT NULL DEFAULT 'DE';
ALTER TABLE public.offers ADD COLUMN country text NOT NULL DEFAULT 'DE';
ALTER TABLE public.offer_customers ADD COLUMN country text NOT NULL DEFAULT 'DE';

UPDATE public.callbacks c SET country = b.country FROM public.leads l JOIN public.lead_batches b ON b.id = l.batch_id WHERE l.id = c.lead_id;
UPDATE public.appointments a SET country = b.country FROM public.leads l JOIN public.lead_batches b ON b.id = l.batch_id WHERE l.id = a.lead_id;

CREATE OR REPLACE FUNCTION public.set_country_from_lead() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.lead_id IS NOT NULL THEN
    SELECT b.country INTO NEW.country FROM public.leads l JOIN public.lead_batches b ON b.id = l.batch_id WHERE l.id = NEW.lead_id;
    NEW.country := COALESCE(NEW.country, 'DE');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER callbacks_country BEFORE INSERT ON public.callbacks FOR EACH ROW EXECUTE FUNCTION public.set_country_from_lead();
CREATE TRIGGER appointments_country BEFORE INSERT ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.set_country_from_lead();

CREATE OR REPLACE FUNCTION public.set_offer_country() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.customer_id IS NOT NULL THEN
    SELECT country INTO NEW.country FROM public.offer_customers WHERE id = NEW.customer_id;
    NEW.country := COALESCE(NEW.country, 'DE');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER offers_country BEFORE INSERT OR UPDATE OF customer_id ON public.offers FOR EACH ROW EXECUTE FUNCTION public.set_offer_country();

DROP POLICY "batches read" ON public.lead_batches;
CREATE POLICY "batches read" ON public.lead_batches FOR SELECT TO authenticated USING (public.can_access_country(country));
DROP POLICY "leads read" ON public.leads;
CREATE POLICY "leads read" ON public.leads FOR SELECT TO authenticated USING (
  batch_id IS NULL OR EXISTS (SELECT 1 FROM public.lead_batches b WHERE b.id = leads.batch_id AND public.can_access_country(b.country)));
DROP POLICY "cb read" ON public.callbacks;
CREATE POLICY "cb read" ON public.callbacks FOR SELECT TO authenticated USING (public.can_access_country(country));
DROP POLICY "ap read" ON public.appointments;
CREATE POLICY "ap read" ON public.appointments FOR SELECT TO authenticated USING (public.can_access_country(country));
DROP POLICY customers_read ON public.offer_customers;
CREATE POLICY customers_read ON public.offer_customers FOR SELECT TO authenticated USING (public.can_access_country(country));
DROP POLICY offers_read ON public.offers;
CREATE POLICY offers_read ON public.offers FOR SELECT TO authenticated USING (
  ((created_by = auth.uid()) OR public.has_role(auth.uid(),'admin')) AND public.can_access_country(country));

CREATE TABLE public.backups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL DEFAULT 'auto',
  rows_total integer NOT NULL DEFAULT 0,
  size_bytes integer NOT NULL DEFAULT 0,
  data jsonb NOT NULL
);
GRANT SELECT ON public.backups TO authenticated;
GRANT ALL ON public.backups TO service_role;
ALTER TABLE public.backups ENABLE ROW LEVEL SECURITY;
CREATE POLICY backups_master_read ON public.backups FOR SELECT TO authenticated USING (public.is_master(auth.uid()));

CREATE OR REPLACE FUNCTION public.create_backup(p_kind text DEFAULT 'manual') RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d jsonb := '{}'::jsonb; t text; n int := 0; c int; new_id uuid;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_master(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  FOREACH t IN ARRAY ARRAY['profiles','user_roles','user_countries','lead_batches','leads','lead_notes','status_changes',
    'callbacks','appointments','offer_customers','offer_products','offers','offer_items','app_settings','integration_config',
    'integration_jobs','quality_resolutions','audit_events'] LOOP
    EXECUTE format('SELECT COALESCE(jsonb_agg(to_jsonb(x)), ''[]''::jsonb), count(*) FROM public.%I x', t) INTO STRICT d, c USING NULL
      ;
    n := n + c;
    PERFORM 1;
    d := d; -- placeholder
  END LOOP;
  RETURN NULL;
END $$;
