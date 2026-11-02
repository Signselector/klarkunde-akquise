DO $$ DECLARE d text; o text;
BEGIN
 d:=pg_get_functiondef('public.record_lead_action(uuid,uuid,integer,text,text,timestamptz,text,jsonb)'::regprocedure); o:=d;
 d:=replace(d,$a$octet_length(p_details::text)>20000$a$,$a$octet_length(p_details::text)>200000$a$);
 d:=replace(d,$a$'do_not_call','self_assign'))) THEN
  RAISE EXCEPTION 'validation_failed' USING ERRCODE='22023';
 END IF;$a$,$a$'do_not_call','self_assign','extra_logo_paths','extra_photo_paths'))) THEN
  RAISE EXCEPTION 'validation_failed' USING ERRCODE='22023';
 END IF;
 IF p_details IS NOT NULL AND EXISTS(
   SELECT 1 FROM unnest(ARRAY['extra_logo_paths','extra_photo_paths']) k
   WHERE p_details ? k AND (jsonb_typeof(p_details->k)<>'array' OR EXISTS(
     SELECT 1 FROM jsonb_array_elements(p_details->k) e
     WHERE jsonb_typeof(e)<>'string' OR length(e#>>'{}')>500
       OR (e#>>'{}') NOT LIKE app_private.actor()::text||'/'||p_lead_id::text||'/%')))
 THEN RAISE EXCEPTION 'validation_failed' USING ERRCODE='22023'; END IF;$a$);
 IF d=o THEN RAISE EXCEPTION 'patch did not apply'; END IF;
 EXECUTE d;
END $$;