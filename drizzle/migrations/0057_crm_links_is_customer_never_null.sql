CREATE OR REPLACE FUNCTION app_private.crm_link_is_customer_default() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  NEW.is_customer := coalesce(NEW.is_customer, false);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS crm_link_is_customer_default ON public.lead_crm_links;
CREATE TRIGGER crm_link_is_customer_default BEFORE INSERT OR UPDATE ON public.lead_crm_links
  FOR EACH ROW EXECUTE FUNCTION app_private.crm_link_is_customer_default();