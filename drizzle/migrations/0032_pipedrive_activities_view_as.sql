DROP POLICY IF EXISTS pa_own ON public.pipedrive_activities;
CREATE POLICY pa_own ON public.pipedrive_activities FOR SELECT TO authenticated
  USING (user_id = app_private.eff_uid() OR public.has_admin_rights(app_private.eff_uid(), country));