DO $mig$
DECLARE d text;
BEGIN
 d := pg_get_functiondef('public.update_lead_contact(uuid,integer,jsonb)'::regprocedure);
 d := replace(d, 'OR l.last_called_by IS NOT DISTINCT FROM a) THEN',
   'OR l.last_called_by IS NOT DISTINCT FROM a OR EXISTS(SELECT 1 FROM public.appointments ap WHERE ap.lead_id=l.id AND ap.user_id=a)) THEN');
 d := replace(d, 'AND expires_at>now() AND user_id<>a) THEN RAISE EXCEPTION ''lead_claimed''',
   'AND expires_at>now() AND user_id<>a) AND NOT public.has_admin_rights(a,bt.country) AND bt.assigned_to IS DISTINCT FROM a THEN RAISE EXCEPTION ''lead_claimed''');
 EXECUTE d;
END $mig$;