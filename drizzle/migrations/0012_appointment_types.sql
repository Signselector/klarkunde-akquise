ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'presentation';
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE public.appointments ADD CONSTRAINT appointments_kind_valid CHECK (kind IN ('discovery','presentation','closing','onsite','followup','internal','other'));

CREATE OR REPLACE FUNCTION public.save_calendar_appointment(p_starts_at timestamptz, p_kind text, p_title text, p_notes text, p_country text, p_lead_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid := auth.uid(); new_id uuid;
BEGIN
  IF a IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT public.can_access_country(p_country) THEN RAISE EXCEPTION 'country_forbidden'; END IF;
  IF p_starts_at IS NULL THEN RAISE EXCEPTION 'missing_date'; END IF;
  INSERT INTO public.appointments(user_id, lead_id, starts_at, notes, title, kind, country)
  VALUES (a, p_lead_id, p_starts_at, nullif(btrim(p_notes),''), nullif(btrim(p_title),''), coalesce(p_kind,'other'), p_country)
  RETURNING id INTO new_id;
  RETURN new_id;
END $$;
REVOKE ALL ON FUNCTION public.save_calendar_appointment(timestamptz,text,text,text,text,uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.save_calendar_appointment(timestamptz,text,text,text,text,uuid) TO authenticated;