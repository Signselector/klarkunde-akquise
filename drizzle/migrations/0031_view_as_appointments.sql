-- Appointments in "Ansicht als Mitarbeiter": visibility is evaluated for the viewed employee, not for the manager.
-- A Caller / Senior Caller sees only the appointments assigned to them; managers and admins see their countries.
CREATE FUNCTION app_private.eff_uid() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(app_private.view_as_uid(),auth.uid()) $$;
REVOKE ALL ON FUNCTION app_private.eff_uid() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION app_private.eff_uid() TO authenticated;

DROP POLICY IF EXISTS "ap read" ON public.appointments;
CREATE POLICY "ap read" ON public.appointments FOR SELECT TO authenticated
  USING (user_id = app_private.eff_uid() OR public.has_admin_rights(app_private.eff_uid(), country));
