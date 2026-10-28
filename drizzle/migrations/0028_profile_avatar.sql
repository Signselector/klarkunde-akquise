ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_avatar_url_len;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_avatar_url_len CHECK (avatar_url IS NULL OR length(avatar_url)<=500);
GRANT SELECT (avatar_url), UPDATE (avatar_url) ON public.profiles TO authenticated;
-- Skipped where no storage schema exists (tests).
DO $$ BEGIN
 IF to_regclass('storage.objects') IS NOT NULL THEN
 EXECUTE $p$DROP POLICY IF EXISTS avatars_read ON storage.objects$p$;
 EXECUTE $p$DROP POLICY IF EXISTS avatars_insert ON storage.objects$p$;
 EXECUTE $p$DROP POLICY IF EXISTS avatars_update ON storage.objects$p$;
 EXECUTE $p$DROP POLICY IF EXISTS avatars_delete ON storage.objects$p$;
 EXECUTE $p$CREATE POLICY avatars_read ON storage.objects FOR SELECT USING (bucket_id='avatars')$p$;
 EXECUTE $p$CREATE POLICY avatars_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id='avatars' AND (storage.foldername(name))[1]=auth.uid()::text)$p$;
 EXECUTE $p$CREATE POLICY avatars_update ON storage.objects FOR UPDATE TO authenticated USING (bucket_id='avatars' AND (storage.foldername(name))[1]=auth.uid()::text)$p$;
 EXECUTE $p$CREATE POLICY avatars_delete ON storage.objects FOR DELETE TO authenticated USING (bucket_id='avatars' AND (storage.foldername(name))[1]=auth.uid()::text)$p$;
 END IF;
END $$;
