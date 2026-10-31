-- Releasing a batch is for managers and admins only. A caller or senior caller who owns a batch can no longer release it.
DO $$ DECLARE d text; o text;
BEGIN
 d:=pg_get_functiondef('public.release_batch(uuid)'::regprocedure); o:=d;
 d:=replace(d,'IF NOT (public.has_admin_rights(a,b.country) OR b.assigned_to IS NOT DISTINCT FROM a) THEN','IF NOT public.has_admin_rights(a,b.country) THEN');
 IF d=o THEN RAISE EXCEPTION 'patch did not apply'; END IF;
 EXECUTE d;
END $$;