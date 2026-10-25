ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS one_role_per_user;
ALTER TABLE public.user_roles ADD CONSTRAINT user_role_unique UNIQUE(user_id, role);
CREATE OR REPLACE FUNCTION public.set_user_role(p_user_id uuid, p_role app_role) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_role NOT IN ('admin','caller') THEN RAISE EXCEPTION 'invalid_role'; END IF;
  IF p_role='caller' AND public.has_role(p_user_id,'admin') AND
    NOT EXISTS(SELECT 1 FROM public.user_roles WHERE role='admin' AND user_id<>p_user_id) THEN
    RAISE EXCEPTION 'last_admin'; END IF;
  DELETE FROM public.user_roles WHERE user_id=p_user_id AND role IN ('admin','caller');
  INSERT INTO public.user_roles(user_id,role) VALUES(p_user_id,p_role);
END $$;
CREATE OR REPLACE FUNCTION public.set_user_fulfilment(p_user_id uuid, p_on boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_on THEN
    INSERT INTO public.user_roles(user_id,role) VALUES(p_user_id,'fulfilment') ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.user_roles WHERE user_id=p_user_id AND role='fulfilment';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.set_user_fulfilment(uuid, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_user_fulfilment(uuid, boolean) TO authenticated;