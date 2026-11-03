DO $$ DECLARE d text; o text;
BEGIN
 d:=pg_get_functiondef('public.get_completed_overview(text,integer)'::regprocedure); o:=d;
 d:=replace(d,'a uuid:=app_private.actor(); adm boolean:=public.has_role(app_private.actor(),''admin'');','a uuid:=app_private.eff_actor();');
 IF d=o THEN RAISE EXCEPTION 'patch 1 did not apply'; END IF; o:=d;
 d:=replace(d,'AND (adm OR l.last_called_by=a OR b.assigned_to=a OR k.origin_caller_id=a)','AND (l.last_called_by=a OR EXISTS(SELECT 1 FROM public.lead_actions mine WHERE mine.lead_id=l.id AND mine.user_id=a))');
 IF d=o THEN RAISE EXCEPTION 'patch 2 did not apply'; END IF;
 EXECUTE d;
END $$;