-- "Nicht erreicht": a lead that was tried but not reached stays at the bottom of the caller's open leads for 20 days.
-- After that it is no longer handed out and leaves the caller's list; managers and admins find it in their own list.
-- Such a lead keeps counting as processed for its batch (attempts > 0).

-- 1) The call queue no longer hands out a not-reached lead after 20 days.
DO $$ DECLARE d text; o text;
BEGIN
 d:=pg_get_functiondef('public.claim_next_lead(text)'::regprocedure); o:=d;
 d:=replace(d,'(x.status=''open'' AND bt.assigned_to=a)','(x.status=''open'' AND bt.assigned_to=a AND NOT (x.attempts>0 AND x.last_called_at<now()-interval ''20 days''))');
 IF d=o THEN RAISE EXCEPTION 'patch did not apply'; END IF;
 EXECUTE d;
END $$;

-- 2) The list for managers and admins.
CREATE OR REPLACE FUNCTION public.get_unreached_leads(p_country text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
   'attempts',l.attempts,'last_attempt_at',l.last_called_at)
   ORDER BY l.last_called_at DESC NULLS LAST)
  FROM public.leads l JOIN public.lead_batches b ON b.id=l.batch_id
  WHERE (p_country='ALL' OR b.country=p_country) AND l.status='open' AND l.attempts>0
     AND l.last_called_at<now()-interval '20 days' AND l.archived_at IS NULL),'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.get_unreached_leads(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_unreached_leads(text) TO authenticated;