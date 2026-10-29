CREATE TABLE public.sso_nonces (nonce text PRIMARY KEY, used_at timestamptz NOT NULL DEFAULT now());
GRANT ALL ON public.sso_nonces TO service_role;
ALTER TABLE public.sso_nonces ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.api_performance_stats(p_email text, p_month date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE u uuid; m jsonb; p int; lq int; hq int;
BEGIN
 SELECT id INTO u FROM public.profiles WHERE lower(email)=lower(p_email) LIMIT 1;
 IF u IS NULL THEN RETURN NULL; END IF;
 m := app_private.month_quality(u, date_trunc('month', p_month)::date);
 p := (m->>'processed')::int; lq := (m->>'low_q')::int; hq := (m->>'high_q')::int;
 RETURN jsonb_build_object('total_calls',p,'high_q_renders',hq,'low_q_renders',lq,'total_renders',lq+hq,
   'rate_per_100', CASE WHEN p=0 THEN 0 ELSE round((lq+hq)*100.0/p,2) END);
END $$;
REVOKE ALL ON FUNCTION public.api_performance_stats(text,date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_performance_stats(text,date) TO service_role;