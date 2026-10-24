-- Optional deployment step AFTER the worker and Vault secrets exist in Lovable.
-- Requires the platform-supported pg_cron, pg_net and Vault extensions.
-- Store `coldcaller_worker_url` (actual HTTPS function URL) and
-- `coldcaller_scheduler_secret` in Vault securely; never commit values here.
-- If these platform extensions are unavailable, use Lovable's supported scheduler
-- to POST once per minute with the same Authorization header instead.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') OR
    NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net') OR
    to_regclass('vault.decrypted_secrets') IS NULL THEN
  RAISE EXCEPTION 'Required scheduling capabilities unavailable; configure the supported Lovable scheduler';
 END IF;
END $$;
DO $$ DECLARE existing bigint; BEGIN
 SELECT jobid INTO existing FROM cron.job WHERE jobname='coldcaller-worker';
 IF existing IS NOT NULL THEN PERFORM cron.unschedule(existing); END IF;
 PERFORM cron.schedule('coldcaller-worker','* * * * *',$job$
   SELECT net.http_post(
    url:=(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='coldcaller_worker_url'),
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='coldcaller_scheduler_secret')),
    body:='{}'::jsonb, timeout_milliseconds:=120000
   );
 $job$);
END $$;
