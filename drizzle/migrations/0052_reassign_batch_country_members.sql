-- A batch can only be assigned to accounts that belong to the batch's country. Global admins are no longer an exception.
DO $$ DECLARE d text; o text;
BEGIN
 d:=pg_get_functiondef('public.reassign_batch(uuid,uuid)'::regprocedure); o:=d;
 d:=replace(d,'(public.is_global_admin(p_user_id) OR EXISTS(SELECT 1 FROM public.user_countries WHERE user_id=p_user_id AND country=b.country))','EXISTS(SELECT 1 FROM public.user_countries WHERE user_id=p_user_id AND country=b.country)');
 IF d=o THEN RAISE EXCEPTION 'patch did not apply'; END IF;
 EXECUTE d;
END $$;
