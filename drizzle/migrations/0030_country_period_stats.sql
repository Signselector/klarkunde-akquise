-- Statistics cockpit: one country, one period, everybody or one employee. For admins and managers of the country.
--  calls        = recorded call outcomes (status_changes with a call outcome) of leads of the country
--  reached      = calls with any outcome except "not reached"
--  appointments = appointments created through the tool in the period (by the user who booked them)
--  deals        = outcomes Logo Render, Realismus Render, Logo ausstehend, Zukunftsprojekt
--  timeline     = per day (p_bucket 'day') or per hour (p_bucket 'hour') in Vienna time
CREATE OR REPLACE FUNCTION public.get_country_period_stats(
  p_country text, p_from timestamptz, p_to timestamptz, p_user_id uuid DEFAULT NULL, p_bucket text DEFAULT 'day'
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
  a uuid := app_private.actor();
  r jsonb;
  deal_keys text[] := ARRAY['low_q','high_q','waiting_3d','on_hold'];
  outcome_keys text[] := ARRAY['low_q','high_q','waiting_3d','on_hold','reference_mail','callback','not_reached','no_interest'];
BEGIN
  IF NOT public.can_access_country(p_country) OR NOT public.has_admin_rights(a, p_country) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from OR p_to - p_from > interval '400 days' OR p_bucket NOT IN ('day','hour') THEN
    RAISE EXCEPTION 'validation_failed' USING ERRCODE='22023';
  END IF;

  WITH ev AS (
    SELECT sc.user_id, sc.new_status, sc.created_at
    FROM public.status_changes sc
    JOIN public.leads l ON l.id = sc.lead_id
    JOIN public.lead_batches b ON b.id = l.batch_id
    WHERE b.country = p_country
      AND sc.created_at >= p_from AND sc.created_at < p_to
      AND sc.new_status = ANY (app_private.call_outcomes())
  ),
  ap AS (
    SELECT coalesce(x.booked_by, x.user_id) AS user_id
    FROM public.appointments x
    WHERE x.country = p_country AND x.created_at >= p_from AND x.created_at < p_to
  ),
  fev AS (SELECT * FROM ev WHERE p_user_id IS NULL OR user_id = p_user_id),
  fap AS (SELECT * FROM ap WHERE p_user_id IS NULL OR user_id = p_user_id),
  tot AS (
    SELECT count(*)::int calls,
           count(*) FILTER (WHERE new_status <> 'not_reached')::int reached,
           count(*) FILTER (WHERE new_status = ANY (deal_keys))::int deals
    FROM fev
  ),
  buckets AS (
    SELECT CASE WHEN p_bucket = 'day' THEN to_char(d, 'YYYY-MM-DD') ELSE lpad(d::text, 2, '0') END AS k, d
    FROM (
      SELECT g::date AS d FROM generate_series(
        (p_from AT TIME ZONE 'Europe/Vienna')::date, ((p_to - interval '1 microsecond') AT TIME ZONE 'Europe/Vienna')::date, interval '1 day') g
      WHERE p_bucket = 'day'
      UNION ALL
      SELECT NULL::date WHERE false
    ) days
    UNION ALL
    SELECT lpad(h::text, 2, '0'), NULL FROM generate_series(0, 23) h WHERE p_bucket = 'hour'
  ),
  per AS (
    SELECT CASE WHEN p_bucket = 'day' THEN to_char(created_at AT TIME ZONE 'Europe/Vienna', 'YYYY-MM-DD')
                ELSE to_char(created_at AT TIME ZONE 'Europe/Vienna', 'HH24') END AS k,
           count(*)::int calls, count(*) FILTER (WHERE new_status <> 'not_reached')::int reached
    FROM fev GROUP BY 1
  ),
  members AS (
    SELECT p.id, coalesce(p.display_name, p.email, 'Unbekannt') AS name, public.user_role(p.id) AS role
    FROM public.profiles p
    WHERE p.active AND (p_user_id IS NULL)
      AND EXISTS (SELECT 1 FROM public.user_countries uc WHERE uc.user_id = p.id AND uc.country = p_country)
  )
  SELECT jsonb_build_object(
    'country', p_country,
    'user_id', p_user_id,
    'totals', (SELECT jsonb_build_object(
        'calls', t.calls, 'reached', t.reached,
        'reach_rate', CASE WHEN t.calls = 0 THEN NULL ELSE round(t.reached * 100.0 / t.calls, 1) END,
        'appointments', (SELECT count(*)::int FROM fap),
        'appointment_rate', CASE WHEN t.calls = 0 THEN NULL ELSE round((SELECT count(*) FROM fap) * 100.0 / t.calls, 1) END,
        'deals', t.deals) FROM tot t),
    'by_outcome', (SELECT jsonb_object_agg(k, (SELECT count(*)::int FROM fev WHERE new_status = k)) FROM unnest(outcome_keys) k),
    'timeline', coalesce((SELECT jsonb_agg(jsonb_build_object('bucket', bk.k, 'calls', coalesce(pr.calls, 0), 'reached', coalesce(pr.reached, 0)) ORDER BY bk.k)
                          FROM buckets bk LEFT JOIN per pr ON pr.k = bk.k), '[]'::jsonb),
    'team', CASE WHEN p_user_id IS NOT NULL THEN NULL ELSE coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'user_id', m.id, 'name', m.name, 'role', m.role,
          'calls', (SELECT count(*)::int FROM ev WHERE ev.user_id = m.id),
          'reached', (SELECT count(*)::int FROM ev WHERE ev.user_id = m.id AND ev.new_status <> 'not_reached'),
          'appointments', (SELECT count(*)::int FROM ap WHERE ap.user_id = m.id),
          'deals', (SELECT count(*)::int FROM ev WHERE ev.user_id = m.id AND ev.new_status = ANY (deal_keys))
        ) ORDER BY m.name) FROM members m), '[]'::jsonb) END
  ) INTO r;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.get_country_period_stats(text, timestamptz, timestamptz, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_country_period_stats(text, timestamptz, timestamptz, uuid, text) TO authenticated;
