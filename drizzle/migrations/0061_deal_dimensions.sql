DO $$ DECLARE d text; o text;
BEGIN
 d:=pg_get_functiondef('public.record_lead_action(uuid,uuid,integer,text,text,timestamptz,text,jsonb)'::regprocedure); o:=d;
 d:=replace(d,$a$'extra_logo_paths','extra_photo_paths'))) THEN$a$,$a$'extra_logo_paths','extra_photo_paths','dimensions'))) THEN$a$);
 IF d=o THEN RAISE EXCEPTION 'patch did not apply'; END IF;
 EXECUTE d;
END $$;