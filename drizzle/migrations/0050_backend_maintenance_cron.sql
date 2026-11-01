DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='backend-maintenance') THEN PERFORM cron.unschedule('backend-maintenance'); END IF;
 PERFORM cron.schedule('backend-maintenance','20 * * * *','SELECT public.backend_maintenance()');
END $$;