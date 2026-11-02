CREATE INDEX IF NOT EXISTS appointments_country_starts_idx ON public.appointments (country, starts_at);
CREATE INDEX IF NOT EXISTS appointments_user_starts_idx ON public.appointments (user_id, starts_at);
CREATE INDEX IF NOT EXISTS callbacks_user_open_idx ON public.callbacks (user_id, country, due_at) WHERE NOT done;
CREATE INDEX IF NOT EXISTS lead_notes_lead_idx ON public.lead_notes (lead_id, created_at DESC);