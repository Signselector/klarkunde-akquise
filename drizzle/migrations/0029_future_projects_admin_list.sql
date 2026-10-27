-- Admin area: every lead that was completed as "Zukunftsprojekt" (on hold until the chosen month), for download.
CREATE OR REPLACE FUNCTION public.get_future_projects_leads(p_country text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  a uuid := app_private.actor();
BEGIN
  IF NOT public.has_admin_rights(a, p_country) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;

  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'lead_id', l.id,
      'company', l.company,
      'contact_name', l.contact_name,
      'phone', l.phone,
      'email', l.email,
      'city', l.city,
      'extra', l.extra,
      'batch', b.name,
      'caller', (SELECT display_name FROM public.profiles WHERE id = la.user_id),
      'target_month', la.details->>'month',
      'created_at', la.created_at,
      'note', la.note
    ) ORDER BY la.details->>'month' ASC, la.created_at DESC)
    FROM public.leads l
    JOIN public.lead_batches b ON b.id = l.batch_id
    JOIN LATERAL (
      SELECT x.*
      FROM public.lead_actions x
      WHERE x.lead_id = l.id AND x.action = 'on_hold'
      ORDER BY x.created_at DESC
      LIMIT 1
    ) la ON true
    WHERE b.country = p_country
      AND l.status = 'on_hold'
      AND l.archived_at IS NULL
  ), '[]'::jsonb);
END $$;

REVOKE ALL ON FUNCTION public.get_future_projects_leads(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_future_projects_leads(text) TO authenticated;
