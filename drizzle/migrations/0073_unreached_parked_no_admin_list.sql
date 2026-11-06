-- "Nicht erreicht" is no longer an admin list and has no 20 day rule. Not reached leads stay in the caller's folded
-- section "Nicht Erreicht: Aktuell nicht anrufen" and are not handed out by the call queue any more.
DROP FUNCTION IF EXISTS public.get_unreached_leads(text);

DO $$ DECLARE d text; o text;
BEGIN
 d:=pg_get_functiondef('public.claim_next_lead(text)'::regprocedure); o:=d;
 d:=replace(d,'AND NOT (x.attempts>0 AND x.last_called_at<now()-interval ''20 days'')','AND x.attempts=0');
 IF d=o THEN RAISE EXCEPTION 'patch did not apply'; END IF;
 EXECUTE d;
END $$;
