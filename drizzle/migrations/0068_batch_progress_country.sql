-- Performance: the dashboard asked for the progress of ALL batches of ALL countries (a scan over every lead) from every
-- open dashboard every 30 seconds. Now it only counts the batches of the country that is shown, and only those the
-- user may access.
DROP FUNCTION IF EXISTS public.get_batch_progress();
CREATE FUNCTION public.get_batch_progress(p_country text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor(); r jsonb;
BEGIN
 IF p_country IS NOT NULL AND NOT public.can_access_country(p_country) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') INTO r FROM (
  SELECT b.id,b.name,b.import_state,b.created_at,b.assigned_to,b.assigned_at,p.display_name assigned_name,
   count(l.id)::int total,
   count(l.id) FILTER(WHERE l.status<>'open' OR l.attempts>0)::int processed,
   count(l.id) FILTER(WHERE l.status='open' AND l.attempts=0)::int unprocessed,
   count(l.id) FILTER(WHERE l.status<>'open' OR l.attempts>0)::int completed,
   count(l.id) FILTER(WHERE l.status='open' AND l.attempts=0)::int open
  FROM public.lead_batches b
  LEFT JOIN public.leads l ON l.batch_id=b.id AND l.archived_at IS NULL
  LEFT JOIN public.profiles p ON p.id=b.assigned_to
  WHERE (p_country IS NULL OR b.country=p_country) AND public.can_access_country(b.country) AND b.import_state='confirmed'
  GROUP BY b.id,p.display_name ORDER BY b.created_at DESC,b.id LIMIT 500) x;
 RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.get_batch_progress(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_batch_progress(text) TO authenticated;

-- The counts per batch can be answered from this index without reading the lead rows.
CREATE INDEX IF NOT EXISTS leads_batch_progress_idx ON public.leads (batch_id, status, attempts) WHERE archived_at IS NULL;
