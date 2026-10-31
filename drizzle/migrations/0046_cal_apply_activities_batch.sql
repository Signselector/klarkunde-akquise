CREATE OR REPLACE FUNCTION public.cal_apply_activities(p_country text, p_user uuid, p_list jsonb) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a jsonb; n integer := 0;
BEGIN
 FOR a IN SELECT * FROM jsonb_array_elements(coalesce(p_list,'[]'::jsonb)) LOOP
   PERFORM public.cal_apply_activity(p_country, p_user, a);
   n := n + 1;
 END LOOP;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.cal_apply_activities(text,uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cal_apply_activities(text,uuid,jsonb) TO service_role;