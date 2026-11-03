DO $mig$
DECLARE d text;
BEGIN
 d := pg_get_functiondef('public.update_lead_contact(uuid,integer,jsonb)'::regprocedure);
 d := replace(d, '''city'',''website'',''address'')', '''city'',''website'',''address'',''phone_label'',''email_label'')');
 d := replace(d, ' UPDATE public.leads SET',
  ' IF p_contact ? ''phone_label'' THEN IF coalesce(p_contact->>''phone_label'','''') NOT IN (''work'',''home'',''other'') THEN RAISE EXCEPTION ''invalid_contact'' USING ERRCODE=''22023''; END IF; ex:=ex||jsonb_build_object(''phone_label'',p_contact->>''phone_label''); END IF;
 IF p_contact ? ''email_label'' THEN IF coalesce(p_contact->>''email_label'','''') NOT IN (''work'',''home'',''other'') THEN RAISE EXCEPTION ''invalid_contact'' USING ERRCODE=''22023''; END IF; ex:=ex||jsonb_build_object(''email_label'',p_contact->>''email_label''); END IF;
 UPDATE public.leads SET');
 IF position('phone_label' in d) = 0 THEN RAISE EXCEPTION 'patch_failed'; END IF;
 EXECUTE d;
END $mig$;