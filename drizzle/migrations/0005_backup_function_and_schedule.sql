CREATE OR REPLACE FUNCTION public.create_backup(p_kind text DEFAULT 'manual') RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d jsonb := '{}'::jsonb; part jsonb; t text; n int := 0; c int; new_id uuid;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_master(auth.uid()) THEN RAISE EXCEPTION 'forbidden'; END IF;
  FOREACH t IN ARRAY ARRAY['profiles','user_roles','user_countries','lead_batches','leads','lead_notes','status_changes',
    'callbacks','appointments','offer_customers','offer_products','offers','offer_items','app_settings','integration_config',
    'integration_jobs','quality_resolutions','audit_events'] LOOP
    EXECUTE format('SELECT COALESCE(jsonb_agg(to_jsonb(x)), ''[]''::jsonb), count(*)::int FROM public.%I x', t) INTO part, c;
    d := d || jsonb_build_object(t, part);
    n := n + c;
  END LOOP;
  INSERT INTO public.backups (kind, rows_total, size_bytes, data)
  VALUES (p_kind, n, octet_length(d::text), jsonb_build_object('created_at', now(), 'tables', d))
  RETURNING id INTO new_id;
  DELETE FROM public.backups WHERE id IN (SELECT id FROM public.backups ORDER BY created_at DESC OFFSET 7);
  RETURN new_id;
END $$;
REVOKE ALL ON FUNCTION public.create_backup(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_backup(text) TO authenticated;

CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule('daily-full-backup', '0 2 * * *', $$SELECT public.create_backup('auto')$$);
