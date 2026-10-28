-- Profile picture: URL on the profile, file in the public bucket 'avatars' (one folder per user, 1 MB, images only).
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_avatar_url_len;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_avatar_url_len CHECK (avatar_url IS NULL OR length(avatar_url)<=500);

-- Skipped where no storage schema exists (tests).
DO $$ BEGIN
 IF to_regclass('storage.buckets') IS NOT NULL AND to_regclass('storage.objects') IS NOT NULL THEN
  INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
   VALUES('avatars','avatars',true,1048576,ARRAY['image/jpeg','image/png','image/webp'])
   ON CONFLICT (id) DO UPDATE SET public=true,file_size_limit=1048576,allowed_mime_types=ARRAY['image/jpeg','image/png','image/webp'];
  EXECUTE $p$CREATE POLICY avatars_insert ON storage.objects FOR INSERT TO authenticated
   WITH CHECK (bucket_id='avatars' AND (storage.foldername(name))[1]=auth.uid()::text)$p$;
  EXECUTE $p$CREATE POLICY avatars_update ON storage.objects FOR UPDATE TO authenticated
   USING (bucket_id='avatars' AND (storage.foldername(name))[1]=auth.uid()::text)$p$;
  EXECUTE $p$CREATE POLICY avatars_delete ON storage.objects FOR DELETE TO authenticated
   USING (bucket_id='avatars' AND (storage.foldername(name))[1]=auth.uid()::text)$p$;
 END IF;
END $$;
