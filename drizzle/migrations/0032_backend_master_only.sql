-- The backend (integration config, Pipedrive stage mapping and validation, audit trail, integration jobs, maintenance
-- and test-batch purge) belongs to the master admin only. Other admins keep all countries and the day-to-day admin work.
DROP POLICY IF EXISTS config_admin ON public.integration_config;
CREATE POLICY config_admin ON public.integration_config FOR UPDATE TO authenticated
  USING (public.is_master(auth.uid())) WITH CHECK (public.is_master(auth.uid()));
DROP POLICY IF EXISTS audit_admin ON public.audit_events;
CREATE POLICY audit_admin ON public.audit_events FOR SELECT TO authenticated USING (public.is_master(auth.uid()));
DROP POLICY IF EXISTS psm_admin_ins ON public.pipedrive_stage_mapping;
DROP POLICY IF EXISTS psm_admin_upd ON public.pipedrive_stage_mapping;
CREATE POLICY psm_admin_ins ON public.pipedrive_stage_mapping FOR INSERT TO authenticated WITH CHECK (public.is_master(auth.uid()));
CREATE POLICY psm_admin_upd ON public.pipedrive_stage_mapping FOR UPDATE TO authenticated USING (public.is_master(auth.uid())) WITH CHECK (public.is_master(auth.uid()));
DROP POLICY IF EXISTS psv_read ON public.pipedrive_stage_validation;
CREATE POLICY psv_read ON public.pipedrive_stage_validation FOR SELECT TO authenticated USING (public.is_master(auth.uid()));

DO $$
DECLARE f record; def text; fixed text;
BEGIN
  FOR f IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
           WHERE n.nspname='public' AND p.proname IN ('retry_integration','resolve_integration_review','archive_open_leads','get_batch_crm_objects','purge_test_batch') LOOP
    def:=pg_get_functiondef(f.oid);
    fixed:=regexp_replace(def,'public\.is_global_admin\(','public.is_master(','g');
    IF fixed=def THEN RAISE EXCEPTION 'admin check not found in %',f.proname; END IF;
    EXECUTE fixed;
  END LOOP;
END $$;
