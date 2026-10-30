-- Showroom results, refined:
--  * No show and the interest results only after the appointment has started; delete and move any time.
--  * The follow-up appointment is required for the three interest results.
--  * No automatic callback for a missed appointment: the original caller schedules it himself.
DO $$ DECLARE d text; o text;
BEGIN
 d:=pg_get_functiondef('public.record_appointment_outcome(uuid,text,text,timestamptz,timestamptz)'::regprocedure); o:=d;
 d:=replace(d,$a$ IF ap.outcome IS NOT NULL THEN RAISE EXCEPTION 'already_decided' USING ERRCODE='22023'; END IF;$a$,
 $a$ IF ap.outcome IS NOT NULL THEN RAISE EXCEPTION 'already_decided' USING ERRCODE='22023'; END IF;
 IF p_outcome IN ('no_show','low_interest','medium_interest','high_interest') AND ap.starts_at>now() THEN
  RAISE EXCEPTION 'appointment_not_started' USING ERRCODE='22023';
 END IF;
 IF p_outcome IN ('low_interest','medium_interest','high_interest') AND p_followup_at IS NULL THEN
  RAISE EXCEPTION 'followup_required' USING ERRCODE='22023';
 END IF;$a$);
 IF d=o THEN RAISE EXCEPTION 'patch 1 did not apply'; END IF; o:=d;
 d:=regexp_replace(d,'\s+WHILE n<240 AND EXISTS.*?INSERT INTO public\.callbacks\(lead_id,user_id,due_at,country\) VALUES\(l\.id,origin,due,ap\.country\);','','s');
 IF d=o THEN RAISE EXCEPTION 'patch 2 did not apply'; END IF;
 EXECUTE d;
END $$;
