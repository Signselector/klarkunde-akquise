CREATE TABLE public.external_api_keys (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  key text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.external_api_keys TO service_role;
ALTER TABLE public.external_api_keys ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.activity_audit_logs ADD COLUMN request_ip text, ADD COLUMN user_agent text;
REVOKE SELECT ON public.activity_audit_logs FROM authenticated;
GRANT SELECT (id,created_at,actor_id,actor_name,actor_email,actor_role,action,country,target_type,target_id,target_label,metadata) ON public.activity_audit_logs TO authenticated;

CREATE OR REPLACE FUNCTION app_private.audit_write(
  p_actor uuid,p_action public.audit_action_type,p_country text,p_type text,p_id text,p_label text,p_meta jsonb DEFAULT '{}'::jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n text; e text; r text; h json; ip text;
BEGIN
 IF p_actor IS NOT NULL THEN
  SELECT p.display_name,p.email INTO n,e FROM public.profiles p WHERE p.id=p_actor;
  r:=public.user_role(p_actor)::text;
 END IF;
 BEGIN h:=nullif(current_setting('request.headers',true),'')::json; EXCEPTION WHEN others THEN h:=NULL; END;
 ip:=coalesce(h->>'cf-connecting-ip',h->>'x-real-ip',trim(split_part(coalesce(h->>'x-forwarded-for',''),',',1)));
 INSERT INTO public.activity_audit_logs(actor_id,actor_name,actor_email,actor_role,action,country,target_type,target_id,target_label,metadata,request_ip,user_agent)
  VALUES(p_actor,coalesce(n,e,CASE WHEN p_actor IS NULL THEN 'System' ELSE 'Unbekannt' END),coalesce(e,''),coalesce(r,'system'),p_action,p_country,p_type,p_id,p_label,coalesce(p_meta,'{}'::jsonb),nullif(ip,''),left(h->>'user-agent',300));
END $$;
REVOKE ALL ON FUNCTION app_private.audit_write(uuid,public.audit_action_type,text,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;