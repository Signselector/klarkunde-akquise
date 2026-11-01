-- When a batch is fully processed (no lead left that is still open without an attempt), its owner automatically gets the
-- next free batch of the same country. No confirmation of a manager is needed. Managers still assign batches by hand.
ALTER TABLE public.lead_batches
  ADD COLUMN IF NOT EXISTS auto_next_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_next_batch_id uuid REFERENCES public.lead_batches(id) ON DELETE SET NULL;

-- Batches that are finished already when this runs do not trigger anything retroactively.
UPDATE public.lead_batches b SET auto_next_at = now()
 WHERE b.auto_next_at IS NULL
   AND EXISTS (SELECT 1 FROM public.leads l WHERE l.batch_id = b.id AND l.archived_at IS NULL)
   AND NOT EXISTS (SELECT 1 FROM public.leads l WHERE l.batch_id = b.id AND l.archived_at IS NULL AND l.status = 'open' AND l.attempts = 0);

CREATE OR REPLACE FUNCTION app_private.auto_assign_next(p_batch uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b public.lead_batches%ROWTYPE; nxt uuid;
BEGIN
 SELECT * INTO b FROM public.lead_batches WHERE id = p_batch AND import_state = 'confirmed' FOR UPDATE;
 IF NOT FOUND OR b.assigned_to IS NULL OR b.auto_next_at IS NOT NULL THEN RETURN NULL; END IF;
 -- Only callers and Senior Callers get batches automatically, and only while their account is active.
 IF public.user_role(b.assigned_to) NOT IN ('recruit','veteran')
    OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = b.assigned_to AND p.active) THEN RETURN NULL; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.leads l WHERE l.batch_id = b.id AND l.archived_at IS NULL) THEN RETURN NULL; END IF;
 IF EXISTS (SELECT 1 FROM public.leads l WHERE l.batch_id = b.id AND l.archived_at IS NULL AND l.status = 'open' AND l.attempts = 0) THEN RETURN NULL; END IF;
 IF NOT public.is_global_admin(b.assigned_to) AND NOT EXISTS (SELECT 1 FROM public.user_countries uc WHERE uc.user_id = b.assigned_to AND uc.country = b.country) THEN RETURN NULL; END IF;
 -- The oldest free batch of the country that still has leads to work on.
 SELECT n.id INTO nxt FROM public.lead_batches n
  WHERE n.country = b.country AND n.import_state = 'confirmed' AND n.assigned_to IS NULL AND n.id <> b.id
    AND EXISTS (SELECT 1 FROM public.leads l WHERE l.batch_id = n.id AND l.archived_at IS NULL AND l.status = 'open' AND l.attempts = 0)
  ORDER BY n.created_at, n.id LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF nxt IS NULL THEN RETURN NULL; END IF;
 UPDATE public.lead_batches SET assigned_to = b.assigned_to, assigned_at = now() WHERE id = nxt;
 UPDATE public.lead_batches SET auto_next_at = now(), auto_next_batch_id = nxt WHERE id = b.id;
 INSERT INTO public.audit_events(actor, action, target_id) VALUES (b.assigned_to, 'auto_assign_batch', nxt);
 RETURN nxt;
END $$;
REVOKE ALL ON FUNCTION app_private.auto_assign_next(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION app_private.trg_leads_auto_assign() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.batch_id IS NOT NULL THEN PERFORM app_private.auto_assign_next(NEW.batch_id); END IF;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS leads_auto_assign ON public.leads;
CREATE TRIGGER leads_auto_assign AFTER UPDATE OF status, attempts, archived_at ON public.leads
 FOR EACH ROW WHEN (NEW.batch_id IS NOT NULL AND NEW.archived_at IS NULL AND (NEW.status <> 'open' OR NEW.attempts > 0))
 EXECUTE FUNCTION app_private.trg_leads_auto_assign();

-- Safety net for the case that no free batch existed when a batch was finished: tried again by the maintenance job.
CREATE OR REPLACE FUNCTION public.auto_assign_finished_batches() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r record; n integer := 0;
BEGIN
 FOR r IN SELECT id FROM public.lead_batches WHERE import_state = 'confirmed' AND assigned_to IS NOT NULL AND auto_next_at IS NULL ORDER BY created_at LOOP
  IF app_private.auto_assign_next(r.id) IS NOT NULL THEN n := n + 1; END IF;
 END LOOP;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.auto_assign_finished_batches() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_assign_finished_batches() TO service_role;

DO $$ DECLARE d text; o text;
BEGIN
 d := pg_get_functiondef('public.backend_maintenance()'::regprocedure); o := d;
 d := replace(d, 'RETURN jsonb_build_object(''expired_claims'',claims,''expired_jobs'',jobs);',
   'RETURN jsonb_build_object(''expired_claims'',claims,''expired_jobs'',jobs,''auto_assigned_batches'',public.auto_assign_finished_batches());');
 IF d = o THEN RAISE EXCEPTION 'patch did not apply'; END IF;
 EXECUTE d;
END $$;
