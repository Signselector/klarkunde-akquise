CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE INDEX IF NOT EXISTS leads_company_trgm ON public.leads USING gin (company extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS leads_contact_trgm ON public.leads USING gin (contact_name extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS leads_phone_trgm ON public.leads USING gin (phone extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS leads_city_trgm ON public.leads USING gin (city extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS leads_status_created_idx ON public.leads (status, created_at DESC, id) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS profiles_lower_email_idx ON public.profiles (lower(email));