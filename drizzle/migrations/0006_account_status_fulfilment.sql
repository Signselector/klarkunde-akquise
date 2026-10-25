ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'fulfilment';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
CREATE OR REPLACE FUNCTION public.set_user_active(p_user_id uuid, p_active boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_user_id = auth.uid() OR public.is_master(p_user_id) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  UPDATE public.profiles SET active = p_active WHERE id = p_user_id;
END $$;
REVOKE ALL ON FUNCTION public.set_user_active(uuid, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_user_active(uuid, boolean) TO authenticated;