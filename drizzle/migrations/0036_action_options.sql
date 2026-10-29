-- Lead action options:
--  * Kein Interesse: optional flag "Kunde unzufrieden" (details.unhappy).
--  * Referenzmail: an optional callback can be planned right away (the lead stays closed until the customer answers).
--  * reopen_lead: only managers/admins of the lead's country (used to give a "Kein Interesse" lead another chance).
DO $$ DECLARE d text; o text;
BEGIN
 d:=pg_get_functiondef('public.record_lead_action(uuid,uuid,integer,text,text,timestamptz,text,jsonb)'::regprocedure); o:=d;
 d:=replace(d,$a$'do_not_call','self_assign'))) THEN$a$,$a$'do_not_call','self_assign','unhappy'))) THEN$a$);
 IF d=o THEN RAISE EXCEPTION 'patch 1 did not apply'; END IF; o:=d;
 d:=replace(d,$a$ IF p_action='on_hold' THEN
  IF note IS NULL THEN$a$,$a$ IF p_action='reference_mail' AND p_scheduled_at IS NOT NULL AND (NOT pg_catalog.isfinite(p_scheduled_at) OR p_scheduled_at<=now()) THEN
  RAISE EXCEPTION 'invalid_schedule' USING ERRCODE='22023';
 END IF;
 IF p_action='on_hold' THEN
  IF note IS NULL THEN$a$);
 IF d=o THEN RAISE EXCEPTION 'patch 2 did not apply'; END IF; o:=d;
 d:=replace(d,$a$IF p_action IN ('callback','waiting_3d') AND p_scheduled_at IS NOT NULL THEN$a$,$a$IF p_action IN ('callback','waiting_3d','reference_mail') AND p_scheduled_at IS NOT NULL THEN$a$);
 IF d=o THEN RAISE EXCEPTION 'patch 3 did not apply'; END IF;
 EXECUTE d;

 d:=pg_get_functiondef('public.reopen_lead(uuid,uuid,integer,text)'::regprocedure); o:=d;
 d:=replace(d,$a$ IF l.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'stale_lead' USING ERRCODE='40001'; END IF;$a$,$a$ IF l.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'stale_lead' USING ERRCODE='40001'; END IF;
 IF NOT public.has_admin_rights(a,(SELECT country FROM public.lead_batches WHERE id=l.batch_id)) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;$a$);
 IF d=o THEN RAISE EXCEPTION 'patch 4 did not apply'; END IF;
 EXECUTE d;
END $$;
