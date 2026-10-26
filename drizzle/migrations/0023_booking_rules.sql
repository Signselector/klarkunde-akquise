-- Booking rules, second round:
--  * Callbacks are private and are no longer sent to Pipedrive.
--  * A callback is refused when the caller already has a callback in that window, or already 2 appointments
--    (own appointments and own Pipedrive entries). Callbacks of other users do not matter.
--  * For now every role sees all appointments of the countries it may access (to be narrowed later).

CREATE OR REPLACE FUNCTION app_private.own_load(_user uuid,_country text,_start timestamptz,_end timestamptz,_except_lead uuid) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE
  WHEN (SELECT count(*) FROM public.callbacks c WHERE c.user_id=_user AND NOT c.done AND c.lead_id IS DISTINCT FROM _except_lead
          AND c.due_at<_end AND c.due_at+interval '30 minutes'>_start)>=1 THEN 1
  WHEN ((SELECT count(*) FROM public.appointments a WHERE a.user_id=_user AND a.starts_at<_end AND a.starts_at+interval '30 minutes'>_start)
       +(SELECT count(*) FROM public.pipedrive_activities p WHERE p.user_id=_user AND NOT p.done AND p.country=_country
          AND p.due_at<_end AND p.due_at+make_interval(mins=>greatest(p.duration_min,1))>_start))>=2 THEN 1
  ELSE 0 END
$$;

-- Callbacks stay in the tool: nothing is queued for Pipedrive any more.
UPDATE public.callbacks SET pd_sync_state='synced' WHERE pd_sync_state IN ('pending','failed');
CREATE OR REPLACE FUNCTION app_private.trg_callback_done() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 RETURN NEW;
END $$;

DROP POLICY IF EXISTS "ap read" ON public.appointments;
CREATE POLICY "ap read" ON public.appointments FOR SELECT TO authenticated USING (public.can_access_country(country));
