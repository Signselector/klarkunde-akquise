CREATE OR REPLACE FUNCTION public.touch_presence_from_action()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF NEW.user_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.profiles WHERE id=NEW.user_id) THEN
  INSERT INTO public.user_presence(user_id,last_seen_at,is_online) VALUES(NEW.user_id,now(),true)
   ON CONFLICT (user_id) DO UPDATE SET last_seen_at=greatest(public.user_presence.last_seen_at,now()),is_online=true;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.touch_presence_from_action() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_presence_lead_actions ON public.lead_actions;
CREATE TRIGGER trg_presence_lead_actions AFTER INSERT ON public.lead_actions FOR EACH ROW EXECUTE FUNCTION public.touch_presence_from_action();
DROP TRIGGER IF EXISTS trg_presence_status_changes ON public.status_changes;
CREATE TRIGGER trg_presence_status_changes AFTER INSERT ON public.status_changes FOR EACH ROW EXECUTE FUNCTION public.touch_presence_from_action();
INSERT INTO public.user_presence(user_id,last_seen_at,is_online)
 SELECT la.user_id,max(la.created_at),false FROM public.lead_actions la JOIN public.profiles p ON p.id=la.user_id GROUP BY la.user_id
 ON CONFLICT (user_id) DO UPDATE SET last_seen_at=greatest(public.user_presence.last_seen_at,EXCLUDED.last_seen_at);