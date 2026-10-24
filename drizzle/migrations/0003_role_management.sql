-- Serialize role changes and prevent deleting the final administrator.
CREATE OR REPLACE FUNCTION public.set_user_role(p_user_id uuid, p_role public.app_role)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(71923101);
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  IF p_role IS NULL THEN RAISE EXCEPTION 'invalid_role' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM auth.users WHERE id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'user_not_found' USING ERRCODE='P0002'; END IF;
  IF p_role <> 'admin' AND public.has_role(p_user_id,'admin') AND
    NOT EXISTS(SELECT 1 FROM public.user_roles WHERE role='admin' AND user_id<>p_user_id) THEN
    RAISE EXCEPTION 'last_admin' USING ERRCODE='23514';
  END IF;
  DELETE FROM public.user_roles WHERE user_id=p_user_id;
  INSERT INTO public.user_roles(user_id,role) VALUES(p_user_id,p_role);
END $$;
REVOKE ALL ON FUNCTION public.set_user_role(uuid,public.app_role) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_user_role(uuid,public.app_role) TO authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.user_roles FROM authenticated;
-- New signups never acquire administration automatically. Provision the first
-- admin through the trusted Lovable Cloud database console, using its exact user ID.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  INSERT INTO public.profiles(id,email,display_name)
    VALUES(NEW.id,NEW.email,coalesce(NEW.raw_user_meta_data->>'display_name',split_part(NEW.email,'@',1)));
  INSERT INTO public.user_roles(user_id,role) VALUES(NEW.id,'caller');
  RETURN NEW;
END $$;
