-- Taking a batch is for managers and admins only (like releasing it). Callers and Senior Callers get batches assigned.
DO $$ DECLARE d text; o text;
BEGIN
 d:=pg_get_functiondef('public.claim_batch(uuid)'::regprocedure); o:=d;
 d:=replace(d,'IF NOT public.can_access_country(b.country) THEN','IF NOT public.can_access_country(b.country) OR NOT public.has_admin_rights(a,b.country) THEN');
 IF d=o THEN RAISE EXCEPTION 'patch did not apply'; END IF;
 EXECUTE d;
END $$;
