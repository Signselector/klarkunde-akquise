CREATE INDEX IF NOT EXISTS leads_open_list_idx ON public.leads (created_at DESC, id) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS leads_unreached_idx ON public.leads (last_called_at DESC) WHERE status = 'open' AND attempts > 0 AND archived_at IS NULL;
CREATE INDEX IF NOT EXISTS lead_batches_country_assigned_idx ON public.lead_batches (country, assigned_to);