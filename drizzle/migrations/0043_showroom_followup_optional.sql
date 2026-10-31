-- The follow-up appointment of the three interest results is optional again.
DO $$ DECLARE d text; o text;
BEGIN
 d:=pg_get_functiondef('public.record_appointment_outcome(uuid,text,text,timestamptz,timestamptz)'::regprocedure); o:=d;
 d:=regexp_replace(d,'\s+IF p_outcome IN \(''low_interest'',''medium_interest'',''high_interest''\) AND p_followup_at IS NULL THEN\s+RAISE EXCEPTION ''followup_required'' USING ERRCODE=''22023'';\s+END IF;','');
 IF d=o THEN RAISE EXCEPTION 'patch did not apply'; END IF;
 EXECUTE d;
END $$;
