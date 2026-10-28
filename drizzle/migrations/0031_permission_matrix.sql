-- Permission matrix, round two:
--  * admin lists (no interest, future projects, unanswered reference mails): managers see their own country,
--    global admins can pick a country or "ALL"; every row carries its country
--  * import: only managers and admins; the target country is set through set_import_batch_country
--    (managers only for their own country, admins for any)
CREATE OR REPLACE FUNCTION public.get_no_interest_leads(p_country text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor();
BEGIN
 IF p_country='ALL' THEN
  IF NOT public.is_global_admin(a) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 ELSIF NOT public.has_admin_rights(a,p_country) THEN
  RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
 END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('country',b.country,
   'lead_id',l.id,'company',l.company,'contact_name',l.contact_name,'phone',l.phone,'email',l.email,'city',l.city,'extra',l.extra,
   'batch',b.name,'caller',(SELECT display_name FROM public.profiles WHERE id=l.last_called_by),
   'declined_at',(SELECT max(x.created_at) FROM public.lead_actions x WHERE x.lead_id=l.id AND x.action='no_interest'),
   'note',(SELECT x.note FROM public.lead_actions x WHERE x.lead_id=l.id AND x.action='no_interest' ORDER BY x.created_at DESC LIMIT 1))
   ORDER BY l.last_called_at DESC NULLS LAST)
  FROM public.leads l JOIN public.lead_batches b ON b.id=l.batch_id
  WHERE (p_country='ALL' OR b.country=p_country) AND l.status='no_interest' AND l.archived_at IS NULL),'[]'::jsonb);
END $$;
CREATE OR REPLACE FUNCTION public.get_unanswered_reference_leads(p_country text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor();
BEGIN
 IF p_country='ALL' THEN
  IF NOT public.is_global_admin(a) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 ELSIF NOT public.has_admin_rights(a,p_country) THEN
  RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
 END IF;
 RETURN coalesce((SELECT jsonb_agg(x ORDER BY (x->>'sent_at') DESC) FROM (
  SELECT jsonb_build_object('country',b.country,
   'lead_id',l.id,'company',l.company,'contact_name',l.contact_name,'phone',l.phone,'email',l.email,'city',l.city,'extra',l.extra,
   'batch',b.name,
   'caller_id',oc.id,'caller',oc.display_name,
   'mail_to',m.to_email,'subject',m.subject,'sent_at',m.sent_at) x
  FROM public.leads l
  JOIN public.lead_batches b ON b.id=l.batch_id
  JOIN LATERAL (SELECT e.* FROM public.lead_emails e WHERE e.lead_id=l.id AND e.kind='reference_mail' AND e.status IN ('sent','simulated')
                ORDER BY e.sent_at DESC NULLS LAST LIMIT 1) m ON true
  LEFT JOIN public.lead_crm_links k ON k.lead_id=l.id
  LEFT JOIN public.profiles oc ON oc.id=coalesce(k.origin_caller_id,m.created_by)
  WHERE (p_country='ALL' OR b.country=p_country) AND l.status='reference_mail' AND l.archived_at IS NULL AND m.replied_at IS NULL
    AND m.sent_at<=now()-interval '3 months') s),'[]'::jsonb);
END $$;
CREATE OR REPLACE FUNCTION public.get_future_projects_leads(p_country text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  a uuid := app_private.actor();
BEGIN
  IF p_country='ALL' THEN
  IF NOT public.is_global_admin(a) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 ELSIF NOT public.has_admin_rights(a,p_country) THEN
  RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
 END IF;

  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('country',b.country,
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
    WHERE (p_country='ALL' OR b.country=p_country)
      AND l.status = 'on_hold'
      AND l.archived_at IS NULL
  ), '[]'::jsonb);
END $$;

-- The target country of an import batch (draft). Managers: their own country only. Admins: any country.
CREATE OR REPLACE FUNCTION public.set_import_batch_country(p_batch_id uuid, p_country text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor();
BEGIN
 IF p_country IS NULL OR p_country NOT IN ('DE','AT','NL') THEN RAISE EXCEPTION 'invalid_import' USING ERRCODE='22023'; END IF;
 IF NOT public.has_admin_rights(a,p_country) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 UPDATE public.lead_batches SET country=p_country WHERE id=p_batch_id AND import_state='draft' AND (created_by=a OR public.is_global_admin(a));
 IF NOT FOUND THEN RAISE EXCEPTION 'import_not_ready' USING ERRCODE='42501'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.set_import_batch_country(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_import_batch_country(uuid,text) TO authenticated;

-- preview_import and confirm_import: staff only, and a batch is confirmed only for a country the user administers.
DO $patch$
DECLARE d text; fixed text;
BEGIN
 d:=pg_get_functiondef('public.preview_import(uuid,text,jsonb,uuid)'::regprocedure);
 fixed:=regexp_replace(d,'BEGIN\s+r:=app_private.request','BEGIN'||E'\n'||' IF NOT public.has_role(a,''admin'') THEN RAISE EXCEPTION ''forbidden'' USING ERRCODE=''42501''; END IF;'||E'\n'||' r:=app_private.request');
 IF fixed=d THEN RAISE EXCEPTION 'preview_import not patched'; END IF;
 EXECUTE fixed;
 d:=pg_get_functiondef('public.confirm_import(uuid,uuid,integer[],boolean)'::regprocedure);
 fixed:=regexp_replace(d,'BEGIN\s+r:=app_private.request','BEGIN'||E'\n'||' IF NOT public.has_role(a,''admin'') THEN RAISE EXCEPTION ''forbidden'' USING ERRCODE=''42501''; END IF;'||E'\n'||' r:=app_private.request');
 IF fixed=d THEN RAISE EXCEPTION 'confirm_import not patched (staff)'; END IF;
 d:=fixed;
 fixed:=replace(d,'IF NOT FOUND THEN RAISE EXCEPTION ''import_not_ready'' USING ERRCODE=''42501''; END IF;','IF NOT FOUND THEN RAISE EXCEPTION ''import_not_ready'' USING ERRCODE=''42501''; END IF;'||E'\n'||' IF NOT public.has_admin_rights(a,(SELECT country FROM public.lead_batches WHERE id=p_batch_id)) THEN RAISE EXCEPTION ''forbidden'' USING ERRCODE=''42501''; END IF;');
 IF fixed=d THEN RAISE EXCEPTION 'confirm_import not patched (country)'; END IF;
 EXECUTE fixed;
END $patch$;
