DROP POLICY IF EXISTS uc_insert ON public.user_countries;
DROP POLICY IF EXISTS uc_delete ON public.user_countries;
CREATE POLICY uc_insert ON public.user_countries FOR INSERT TO authenticated WITH CHECK (public.is_global_admin(auth.uid()));
CREATE POLICY uc_delete ON public.user_countries FOR DELETE TO authenticated USING (public.is_global_admin(auth.uid()));
DROP FUNCTION IF EXISTS public.can_grant_country(uuid,text);