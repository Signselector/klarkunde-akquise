-- Live celebrations (confetti + anonymous toast) are sent over Supabase Realtime broadcast: nothing is stored.

-- 1) crm_apply_stage also reports whether a deal just became "won" (status or a won stage), so the webhook and the
--    hourly reconcile can announce it exactly once per change.
DO $$ DECLARE d text; o text;
BEGIN
 d:=pg_get_functiondef('public.crm_apply_stage(text,bigint,bigint,text,timestamptz,text,uuid,text,text,text)'::regprocedure); o:=d;
 d:=replace(d,'RETURN jsonb_build_object(''applied'',coalesce(changed,false) OR won_change,''stage_key'',newkey,''customer_assigned'',flip);',
  'RETURN jsonb_build_object(''applied'',coalesce(changed,false) OR won_change,''stage_key'',newkey,''customer_assigned'',flip,''won_change'',(won_change AND p_status=''won''),''won_stage'',(coalesce(changed,false) AND newkey LIKE ''won\_%'' AND newkey IS DISTINCT FROM oldkey));');
 IF d=o THEN RAISE EXCEPTION 'patch did not apply'; END IF;
 EXECUTE d;
END $$;

-- 2) Only signed-in users of a country may LISTEN to that country's private channel "celebrations-<country>".
--    Nobody but the server (service role) can send: there is no INSERT policy for clients.
DO $$ BEGIN
 IF to_regclass('realtime.messages') IS NOT NULL THEN
  EXECUTE 'DROP POLICY IF EXISTS celebrations_listen ON realtime.messages';
  EXECUTE $p$CREATE POLICY celebrations_listen ON realtime.messages FOR SELECT TO authenticated
   USING (realtime.messages.extension = 'broadcast'
          AND (SELECT realtime.topic()) ~ '^celebrations-(DE|AT|NL)$'
          AND public.can_access_country(substr((SELECT realtime.topic()), 14)))$p$;
 END IF;
END $$;
