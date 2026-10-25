CREATE TABLE public.pipedrive_stage_mapping (
  country text PRIMARY KEY CHECK (country IN ('DE','AT','NL')),
  mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.pipedrive_stage_mapping TO authenticated;
GRANT ALL ON public.pipedrive_stage_mapping TO service_role;
ALTER TABLE public.pipedrive_stage_mapping ENABLE ROW LEVEL SECURITY;
CREATE POLICY psm_read ON public.pipedrive_stage_mapping FOR SELECT TO authenticated USING (public.can_access_country(country));
CREATE POLICY psm_admin_ins ON public.pipedrive_stage_mapping FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin') AND public.can_access_country(country));
CREATE POLICY psm_admin_upd ON public.pipedrive_stage_mapping FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin') AND public.can_access_country(country)) WITH CHECK (public.has_role(auth.uid(),'admin') AND public.can_access_country(country));
INSERT INTO public.pipedrive_stage_mapping(country, mapping) VALUES
('DE','{"low_q":8,"high_q":9,"no_interest":33,"on_hold":30,"reference_mail":36,"animation":10,"rd_done":11,"waiting_3d":7,"gerald_waiting":22,"nico_waiting":21,"offer":23,"contract":27,"production":25,"contact_saved":6,"future_interest":30,"lost":35,"erebay_production":25,"goodbong_production":24}'),
('AT','{"low_q":21,"high_q":1,"no_interest":23,"on_hold":13,"reference_mail":30,"animation":17,"rd_done":16,"gerald_waiting":31,"nico_waiting":32,"offer":33,"contract":8,"contact_saved":22,"erebay_production":6,"goodbong_production":20}');