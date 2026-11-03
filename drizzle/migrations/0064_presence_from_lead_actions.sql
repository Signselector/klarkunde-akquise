ALTER TYPE public.audit_action_type ADD VALUE IF NOT EXISTS 'lead_action';

CREATE OR REPLACE FUNCTION app_private.lead_action_presence_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c text; co text;
BEGIN
  INSERT INTO public.user_presence(user_id,last_seen_at,is_online) VALUES(NEW.user_id,now(),true)
    ON CONFLICT (user_id) DO UPDATE SET last_seen_at=GREATEST(public.user_presence.last_seen_at,now()),is_online=true;
  BEGIN
    SELECT b.country, l.company INTO c, co FROM public.leads l LEFT JOIN public.lead_batches b ON b.id=l.batch_id WHERE l.id=NEW.lead_id;
    PERFORM app_private.audit_write(NEW.user_id,'lead_action'::public.audit_action_type,
      CASE WHEN c IN ('DE','AT','NL') THEN c END,'lead',NEW.lead_id::text,left(coalesce(co,'Lead'),200),
      jsonb_build_object('outcome',NEW.action));
  EXCEPTION WHEN others THEN NULL;
  END;
  RETURN NEW;
EXCEPTION WHEN others THEN RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS lead_action_presence_audit ON public.lead_actions;
CREATE TRIGGER lead_action_presence_audit AFTER INSERT ON public.lead_actions
FOR EACH ROW EXECUTE FUNCTION app_private.lead_action_presence_audit();