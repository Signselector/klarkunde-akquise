-- Achievements for callers: a deal of the caller reaches Low Q / High Q in the CRM (e.g. from "3D waiting").
-- The caller's own Logo / Realismus Render is celebrated by the page itself right after saving; this table covers
-- the stage changes someone else (or Pipedrive) makes.
CREATE TABLE public.achievement_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('deal_qualified')),
  stage_key text NOT NULL CHECK (stage_key IN ('low_q','high_q')),
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  company text,
  created_at timestamptz NOT NULL DEFAULT now(),
  seen_at timestamptz
);
CREATE INDEX achievement_events_unseen_idx ON public.achievement_events(user_id) WHERE seen_at IS NULL;
GRANT SELECT ON public.achievement_events TO authenticated;
GRANT UPDATE (seen_at) ON public.achievement_events TO authenticated;
GRANT ALL ON public.achievement_events TO service_role;
ALTER TABLE public.achievement_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY achievement_read ON public.achievement_events FOR SELECT TO authenticated USING (user_id=auth.uid());
CREATE POLICY achievement_seen ON public.achievement_events FOR UPDATE TO authenticated
  USING (user_id=auth.uid()) WITH CHECK (user_id=auth.uid());

CREATE FUNCTION app_private.trg_achievement_stage() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r uuid; c text;
BEGIN
 IF NEW.action_type<>'stage_change' OR NEW.new_stage NOT IN ('low_q','high_q') OR NEW.previous_stage IS NOT DISTINCT FROM NEW.new_stage THEN RETURN NEW; END IF;
 SELECT coalesce(NEW.origin_caller_id,l.last_called_by),l.company INTO r,c FROM public.leads l WHERE l.id=NEW.lead_id;
 -- Nothing for the caller's own action (the page celebrates that immediately) and nothing without an owner.
 IF r IS NULL OR r IS NOT DISTINCT FROM NEW.acting_user_id OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=r) THEN RETURN NEW; END IF;
 INSERT INTO public.achievement_events(user_id,kind,stage_key,lead_id,company) VALUES(r,'deal_qualified',NEW.new_stage,NEW.lead_id,c);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.trg_achievement_stage() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER achievement_on_stage AFTER INSERT ON public.lead_activity FOR EACH ROW EXECUTE FUNCTION app_private.trg_achievement_stage();

DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.achievement_events; EXCEPTION WHEN duplicate_object THEN NULL; END;
 END IF;
END $$;
