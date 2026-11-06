-- Internal note per lead ("Interne Notiz (nur für dich)"): stays in this tool and is never sent to Pipedrive.
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS internal_note text;

-- Changing only the internal note must not change the lead's version: open forms of the lead would otherwise
-- fail with "stale_lead" after the note was saved.
CREATE OR REPLACE FUNCTION app_private.bump_lead_version() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.internal_note IS DISTINCT FROM OLD.internal_note
    AND (to_jsonb(NEW) - 'version' - 'internal_note') = (to_jsonb(OLD) - 'version' - 'internal_note') THEN
  NEW.version=OLD.version;
 ELSE
  NEW.version=OLD.version+1;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS lead_version ON public.leads;
CREATE TRIGGER lead_version BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION app_private.bump_lead_version();

CREATE OR REPLACE FUNCTION public.update_lead_internal_note(p_lead_id uuid, p_internal_note text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor(); l public.leads%ROWTYPE; c text; ok boolean;
BEGIN
 IF a IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 IF length(coalesce(p_internal_note,''))>5000 THEN RAISE EXCEPTION 'note_too_long' USING ERRCODE='22023'; END IF;
 SELECT * INTO l FROM public.leads WHERE id=p_lead_id AND archived_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'lead_not_found' USING ERRCODE='P0002'; END IF;
 SELECT b.country INTO c FROM public.lead_batches b WHERE b.id=l.batch_id;
 -- The country of the lead must be one the user may access.
 IF c IS NULL OR NOT public.can_access_country(c) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 -- Managers and admins of the country: every lead. Callers and Senior Callers: their own leads only.
 ok:=public.has_admin_rights(a,c)
  OR l.last_called_by IS NOT DISTINCT FROM a
  OR EXISTS(SELECT 1 FROM public.lead_batches b WHERE b.id=l.batch_id AND b.assigned_to=a)
  OR EXISTS(SELECT 1 FROM public.lead_actions x WHERE x.lead_id=l.id AND x.user_id=a)
  OR EXISTS(SELECT 1 FROM public.lead_crm_links k WHERE k.lead_id=l.id AND k.origin_caller_id=a);
 IF NOT ok THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 UPDATE public.leads SET internal_note=nullif(btrim(p_internal_note),'') WHERE id=l.id;
END $$;
REVOKE ALL ON FUNCTION public.update_lead_internal_note(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_lead_internal_note(uuid,text) TO authenticated;