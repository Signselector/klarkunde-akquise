CREATE EXTENSION IF NOT EXISTS pg_net;

-- Random token generated inside the database; never written to any file. Only reachable by privileged roles.
CREATE TABLE IF NOT EXISTS app_private.cron_tokens (name text PRIMARY KEY, token text NOT NULL);
REVOKE ALL ON app_private.cron_tokens FROM PUBLIC, anon, authenticated;
INSERT INTO app_private.cron_tokens(name,token)
 SELECT 'reconcile', encode(extensions.gen_random_bytes(32),'hex')
 WHERE NOT EXISTS (SELECT 1 FROM app_private.cron_tokens WHERE name='reconcile');

CREATE OR REPLACE FUNCTION public.verify_reconcile_token(p_token text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT p_token IS NOT NULL AND length(p_token)>=32 AND EXISTS(
  SELECT 1 FROM app_private.cron_tokens WHERE name='reconcile' AND token=p_token)
$$;
REVOKE ALL ON FUNCTION public.verify_reconcile_token(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_reconcile_token(text) TO service_role;

DO $$ DECLARE j bigint; BEGIN
 SELECT jobid INTO j FROM cron.job WHERE jobname='pipedrive-reconcile-hourly';
 IF j IS NOT NULL THEN PERFORM cron.unschedule(j); END IF;
 PERFORM cron.schedule('pipedrive-reconcile-hourly','5 * * * *',$job$
  SELECT net.http_post(
   url:='https://coldcaller-tool.signselector.com/api/pipedrive-reconcile',
   headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(SELECT token FROM app_private.cron_tokens WHERE name='reconcile')),
   body:='{}'::jsonb, timeout_milliseconds:=120000);
 $job$);
END $$;