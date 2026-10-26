-- Owner: managers/admins keep their own; veterans only when they assign it to themselves; otherwise the country's manager.
CREATE OR REPLACE FUNCTION app_private.appointment_owner(_caller uuid, _country text, _self boolean)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT CASE WHEN public.user_role(_caller) IN ('admin','manager') THEN _caller
   WHEN public.user_role(_caller)='veteran' AND _self THEN _caller
   ELSE coalesce((
   SELECT ur.user_id FROM public.user_roles ur
    JOIN public.user_countries uc ON uc.user_id=ur.user_id AND uc.country=_country
    JOIN public.profiles p ON p.id=ur.user_id
   WHERE ur.role='manager' AND p.active ORDER BY p.created_at,p.id LIMIT 1),_caller) END
$$;
CREATE OR REPLACE FUNCTION app_private.appointment_owner(_caller uuid, _country text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT app_private.appointment_owner(_caller,_country,false)
$$;

DO $do$
DECLARE d text := pg_get_functiondef('public.record_lead_action'::regproc);
BEGIN
  d := replace(d, '''photo_path'',''month'',''do_not_call'')', '''photo_path'',''month'',''do_not_call'',''self_assign'')');
  d := replace(d, 'app_private.appointment_owner(a,bt.country)', 'app_private.appointment_owner(a,bt.country,coalesce((p_details->>''self_assign'')::boolean,false))');
  EXECUTE d;
END $do$;

DROP FUNCTION IF EXISTS public.save_calendar_appointment(timestamptz, text, text, text, text, uuid);
CREATE FUNCTION public.save_calendar_appointment(p_starts_at timestamptz, p_kind text, p_title text, p_notes text, p_country text, p_lead_id uuid DEFAULT NULL, p_self boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a uuid := auth.uid(); new_id uuid;
BEGIN
  IF a IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT public.can_access_country(p_country) THEN RAISE EXCEPTION 'country_forbidden'; END IF;
  IF public.user_role(a)='recruit' THEN RAISE EXCEPTION 'appointment_forbidden' USING ERRCODE='42501'; END IF;
  IF p_starts_at IS NULL THEN RAISE EXCEPTION 'missing_date'; END IF;
  INSERT INTO public.appointments(user_id, lead_id, starts_at, notes, title, kind, country, booked_by)
  VALUES (app_private.appointment_owner(a,p_country,p_self), p_lead_id, p_starts_at, nullif(btrim(p_notes),''), nullif(btrim(p_title),''), coalesce(p_kind,'other'), p_country, a)
  RETURNING id INTO new_id;
  RETURN new_id;
END $$;
GRANT EXECUTE ON FUNCTION public.save_calendar_appointment(timestamptz, text, text, text, text, uuid, boolean) TO authenticated;

-- Manager/admin hands an appointment to a team member of the same country (or takes it).
CREATE OR REPLACE FUNCTION public.assign_appointment(p_appointment_id uuid, p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a uuid := auth.uid(); c text;
BEGIN
  SELECT country INTO c FROM public.appointments WHERE id=p_appointment_id;
  IF c IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF a IS NULL OR NOT public.has_admin_rights(a,c) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=p_user_id AND p.active)
     OR (public.user_role(p_user_id)<>'admin' AND NOT EXISTS(SELECT 1 FROM public.user_countries WHERE user_id=p_user_id AND country=c)) THEN
    RAISE EXCEPTION 'invalid_assignee' USING ERRCODE='22023';
  END IF;
  UPDATE public.appointments SET user_id=p_user_id WHERE id=p_appointment_id;
END $$;
GRANT EXECUTE ON FUNCTION public.assign_appointment(uuid, uuid) TO authenticated;

-- Visibility: own appointments; managers/admins every appointment of their countries.
DROP POLICY IF EXISTS "ap read" ON public.appointments;
CREATE POLICY "ap read" ON public.appointments FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_admin_rights(auth.uid(), country));

-- Notifications about appointments someone else gave you.
CREATE TABLE public.appointment_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  appointment_id uuid NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);
GRANT SELECT, UPDATE ON public.appointment_notifications TO authenticated;
GRANT ALL ON public.appointment_notifications TO service_role;
ALTER TABLE public.appointment_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own notifications read" ON public.appointment_notifications FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "own notifications update" ON public.appointment_notifications FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE INDEX appointment_notifications_user_idx ON public.appointment_notifications(user_id) WHERE read_at IS NULL;

CREATE OR REPLACE FUNCTION app_private.trg_appointment_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF NEW.user_id IS NOT NULL AND NEW.user_id IS DISTINCT FROM auth.uid()
     AND (TG_OP='INSERT' OR NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
    INSERT INTO public.appointment_notifications(user_id, appointment_id) VALUES (NEW.user_id, NEW.id);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER appointment_notify AFTER INSERT OR UPDATE OF user_id ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION app_private.trg_appointment_notify();