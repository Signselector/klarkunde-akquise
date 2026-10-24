CREATE TABLE public.integration_config (
 id boolean PRIMARY KEY DEFAULT true CHECK(id), enabled boolean NOT NULL DEFAULT false,
 pipeline_id bigint, appointment_stage_id bigint, production_stage_id bigint, owner_id bigint,
 CHECK(NOT enabled OR (pipeline_id IS NOT NULL AND appointment_stage_id IS NOT NULL AND production_stage_id IS NOT NULL AND pipeline_id>0 AND appointment_stage_id>0 AND production_stage_id>0))
);
INSERT INTO public.integration_config(id) VALUES(true);
ALTER TABLE public.integration_config ENABLE ROW LEVEL SECURITY;
GRANT SELECT,UPDATE ON public.integration_config TO authenticated;
CREATE POLICY config_admin ON public.integration_config FOR ALL TO authenticated USING(public.has_role(auth.uid(),'admin')) WITH CHECK(public.has_role(auth.uid(),'admin'));
CREATE TABLE public.integration_jobs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lead_id uuid NOT NULL REFERENCES public.leads(id),
 event_id uuid NOT NULL UNIQUE REFERENCES public.status_changes(id), outcome text NOT NULL CHECK(outcome IN ('appointment','production')),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','succeeded','failed','needs_review')),
 attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
 lease_token uuid, lease_until timestamptz, error_code text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_due ON public.integration_jobs(status,next_attempt_at);
CREATE TABLE app_private.integration_links(lead_id uuid PRIMARY KEY REFERENCES public.leads(id), organization_id bigint, person_id bigint, deal_id bigint, updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.integration_jobs ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.integration_jobs TO authenticated;
CREATE POLICY jobs_read ON public.integration_jobs FOR SELECT TO authenticated USING(true);
CREATE FUNCTION app_private.enqueue_sync() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.new_status IN ('appointment','production') THEN
  INSERT INTO public.integration_jobs(lead_id,event_id,outcome) VALUES(NEW.lead_id,NEW.id,NEW.new_status);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER queue_sync AFTER INSERT ON public.status_changes FOR EACH ROW EXECUTE FUNCTION app_private.enqueue_sync();
CREATE FUNCTION public.claim_integration_jobs(p_limit integer DEFAULT 5) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb:='[]'; j public.integration_jobs%ROWTYPE; cfg public.integration_config%ROWTYPE; l public.leads%ROWTYPE;
BEGIN
 SELECT * INTO cfg FROM public.integration_config WHERE id;
 IF NOT cfg.enabled THEN RETURN result; END IF;
 -- An expired worker may have completed an external POST: never blindly recreate it.
 UPDATE public.integration_jobs SET status='needs_review',error_code='lease_expired',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE status='running' AND lease_until<now();
 FOR j IN SELECT x.* FROM public.integration_jobs x WHERE x.status='pending' AND x.next_attempt_at<=now() AND x.attempts<8
  AND NOT EXISTS(SELECT 1 FROM public.integration_jobs prev WHERE prev.lead_id=x.lead_id AND prev.status<>'succeeded' AND (prev.created_at,prev.id)<(x.created_at,x.id))
  ORDER BY x.created_at,x.id LIMIT greatest(1,least(coalesce(p_limit,5),10)) FOR UPDATE SKIP LOCKED LOOP
  -- A per-lead lock and recheck prevent distinct jobs for the same lead running together.
  PERFORM 1 FROM public.leads WHERE id=j.lead_id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.integration_jobs WHERE lead_id=j.lead_id AND status='running') THEN CONTINUE; END IF;
  UPDATE public.integration_jobs SET status='running',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',updated_at=now() WHERE id=j.id RETURNING * INTO j;
  SELECT * INTO l FROM public.leads WHERE id=j.lead_id;
  result:=result||jsonb_build_array(jsonb_build_object('job',to_jsonb(j),'lead',to_jsonb(l),'config',to_jsonb(cfg),'links',coalesce((SELECT to_jsonb(k) FROM app_private.integration_links k WHERE lead_id=j.lead_id),'{}')));
 END LOOP;
 RETURN result;
END $$;
CREATE FUNCTION public.checkpoint_integration(p_job_id uuid,p_lease_token uuid,p_kind text,p_external_id bigint) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.integration_jobs%ROWTYPE;
BEGIN
 SELECT * INTO j FROM public.integration_jobs WHERE id=p_job_id AND status='running' AND lease_token=p_lease_token AND lease_until>now() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'lease_expired' USING ERRCODE='40001'; END IF;
 IF p_external_id IS NULL OR p_external_id<=0 OR p_kind IS NULL OR p_kind NOT IN ('organization','person','deal') THEN RAISE EXCEPTION 'invalid_checkpoint' USING ERRCODE='22023'; END IF;
 INSERT INTO app_private.integration_links(lead_id) VALUES(j.lead_id) ON CONFLICT DO NOTHING;
 IF p_kind='organization' THEN UPDATE app_private.integration_links SET organization_id=p_external_id,updated_at=now() WHERE lead_id=j.lead_id;
 ELSIF p_kind='person' THEN UPDATE app_private.integration_links SET person_id=p_external_id,updated_at=now() WHERE lead_id=j.lead_id;
 ELSE UPDATE app_private.integration_links SET deal_id=p_external_id,updated_at=now() WHERE lead_id=j.lead_id; END IF;
END $$;
CREATE FUNCTION public.finish_integration_job(p_job_id uuid,p_lease_token uuid,p_status text,p_error_code text DEFAULT NULL,p_retry_after integer DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.integration_jobs%ROWTYPE; delay integer;
BEGIN
 SELECT * INTO j FROM public.integration_jobs WHERE id=p_job_id AND status='running' AND lease_token=p_lease_token AND lease_until>now() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'lease_expired' USING ERRCODE='40001'; END IF;
 IF p_status IS NULL OR p_status NOT IN ('succeeded','pending','failed','needs_review') THEN RAISE EXCEPTION 'invalid_status' USING ERRCODE='22023'; END IF;
 IF p_error_code IS NOT NULL AND p_error_code NOT IN ('rate_limited','unauthorized','invalid_payload','provider_error','ambiguous_response','checkpoint_failed','missing_contact','archived_lead','configuration_error','network_error') THEN RAISE EXCEPTION 'invalid_error_code' USING ERRCODE='22023'; END IF;
 delay:=greatest(least(coalesce(p_retry_after,0),86400),least(3600,(30*power(2,j.attempts-1))::integer));
 UPDATE public.integration_jobs SET status=CASE WHEN p_status='pending' AND attempts>=8 THEN 'failed' ELSE p_status END,
 error_code=p_error_code,next_attempt_at=now()+make_interval(secs=>delay),lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=j.id;
END $$;
CREATE FUNCTION public.retry_integration(p_job_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor(); r jsonb;
BEGIN
 IF NOT public.has_role(a,'admin') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 UPDATE public.integration_jobs SET status='pending',attempts=0,error_code=NULL,next_attempt_at=now(),updated_at=now() WHERE id=p_job_id AND status='failed' RETURNING to_jsonb(integration_jobs.*) INTO r;
 IF NOT FOUND THEN RAISE EXCEPTION 'not_retryable' USING ERRCODE='22023'; END IF;
 INSERT INTO public.audit_events(actor,action,target_id) VALUES(a,'retry_integration',p_job_id);
 RETURN r;
END $$;
-- Ambiguous creates require a human to inspect Pipedrive; do not expose a blind retry.
CREATE FUNCTION public.resolve_integration_review(p_job_id uuid,p_organization_id bigint,p_person_id bigint,p_deal_id bigint,p_confirmed_absent boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor(); j public.integration_jobs%ROWTYPE;
BEGIN
 IF NOT public.has_role(a,'admin') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO j FROM public.integration_jobs WHERE id=p_job_id AND status='needs_review' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'not_reviewable' USING ERRCODE='22023'; END IF;
 IF NOT coalesce(p_confirmed_absent,false) AND p_deal_id IS NULL AND p_person_id IS NULL AND p_organization_id IS NULL THEN RAISE EXCEPTION 'review_required' USING ERRCODE='22023'; END IF;
 IF coalesce(p_organization_id,1)<=0 OR coalesce(p_person_id,1)<=0 OR coalesce(p_deal_id,1)<=0 THEN RAISE EXCEPTION 'invalid_external_id' USING ERRCODE='22023'; END IF;
 INSERT INTO app_private.integration_links(lead_id,organization_id,person_id,deal_id) VALUES(j.lead_id,p_organization_id,p_person_id,p_deal_id)
 ON CONFLICT(lead_id) DO UPDATE SET organization_id=coalesce(EXCLUDED.organization_id,integration_links.organization_id),person_id=coalesce(EXCLUDED.person_id,integration_links.person_id),deal_id=coalesce(EXCLUDED.deal_id,integration_links.deal_id),updated_at=now();
 UPDATE public.integration_jobs SET status='pending',attempts=0,next_attempt_at=now(),error_code=NULL WHERE id=j.id;
 INSERT INTO public.audit_events(actor,action,target_id) VALUES(a,'resolve_integration',j.id);
END $$;
CREATE FUNCTION public.backend_maintenance() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE claims integer; jobs integer;
BEGIN
 DELETE FROM public.lead_claims WHERE expires_at<=now(); GET DIAGNOSTICS claims=ROW_COUNT;
 UPDATE public.integration_jobs SET status='needs_review',error_code='lease_expired',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE status='running' AND lease_until<now(); GET DIAGNOSTICS jobs=ROW_COUNT;
 RETURN jsonb_build_object('expired_claims',claims,'expired_jobs',jobs);
END $$;

CREATE TABLE public.quality_resolutions(lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE,kind text NOT NULL,reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),resolved_by uuid NOT NULL, resolved_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(lead_id,kind));
ALTER TABLE public.quality_resolutions ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.quality_resolutions TO authenticated;
CREATE POLICY quality_read ON public.quality_resolutions FOR SELECT TO authenticated USING(true);
CREATE FUNCTION public.get_quality_issues(p_limit integer DEFAULT 100,p_offset integer DEFAULT 0) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor(); r jsonb;
BEGIN
 WITH issues AS (
 SELECT l.id AS lead_id,'missing_phone' AS kind FROM public.leads l WHERE archived_at IS NULL AND app_private.phone(phone) IS NULL
 UNION ALL SELECT id,'invalid_email' FROM public.leads WHERE archived_at IS NULL AND nullif(btrim(email),'') IS NOT NULL AND email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
 UNION ALL SELECT l.id,'possible_duplicate' FROM public.leads l WHERE archived_at IS NULL AND EXISTS(SELECT 1 FROM public.leads x WHERE x.id<>l.id AND x.archived_at IS NULL AND (app_private.phone(x.phone)=app_private.phone(l.phone) OR nullif(lower(btrim(x.email)),'')=nullif(lower(btrim(l.email)),'')))
 UNION ALL SELECT DISTINCT c.lead_id,'overdue_callback' FROM public.callbacks c JOIN public.leads l ON l.id=c.lead_id WHERE NOT c.done AND c.due_at<now() AND l.archived_at IS NULL AND (c.user_id=a OR public.has_role(a,'admin'))
 UNION ALL SELECT id,'missing_sync_contact' FROM public.leads WHERE archived_at IS NULL AND status IN ('appointment','production') AND nullif(btrim(contact_name),'') IS NULL
 ) SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]') INTO r FROM (SELECT i.*,coalesce(l.company,l.contact_name,'Ohne Name') AS company,r.reason AS acknowledged_reason FROM issues i JOIN public.leads l ON l.id=i.lead_id LEFT JOIN public.quality_resolutions r USING(lead_id,kind) ORDER BY lead_id,kind LIMIT greatest(1,least(coalesce(p_limit,100),500)) OFFSET greatest(coalesce(p_offset,0),0)) q;
 RETURN r;
END $$;
CREATE FUNCTION public.acknowledge_quality(p_lead_id uuid,p_kind text,p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor();
BEGIN
 IF p_kind IS NULL OR p_kind NOT IN ('missing_phone','invalid_email','possible_duplicate','overdue_callback','missing_sync_contact') THEN RAISE EXCEPTION 'invalid_kind' USING ERRCODE='22023'; END IF;
 INSERT INTO public.quality_resolutions(lead_id,kind,reason,resolved_by) VALUES(p_lead_id,p_kind,p_reason,a)
 ON CONFLICT(lead_id,kind) DO UPDATE SET reason=EXCLUDED.reason,resolved_by=a,resolved_at=now();
END $$;
-- The event history stores call outcomes separately from current lead state.
CREATE FUNCTION public.get_dashboard(p_from date,p_to date,p_scope text DEFAULT 'mine') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor(); r jsonb; start_at timestamptz; end_at timestamptz;
BEGIN
 IF p_from IS NULL OR p_to IS NULL OR p_to<p_from OR p_to-p_from>366 OR p_scope IS NULL OR p_scope NOT IN ('mine','team') THEN RAISE EXCEPTION 'invalid_range' USING ERRCODE='22023'; END IF;
 IF p_scope='team' AND NOT public.has_role(a,'admin') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 start_at:=p_from::timestamp AT TIME ZONE 'Europe/Vienna'; end_at:=(p_to+1)::timestamp AT TIME ZONE 'Europe/Vienna';
 WITH days AS (SELECT p_from+n AS day FROM generate_series(0,p_to-p_from) n), events AS (
 SELECT (created_at AT TIME ZONE 'Europe/Vienna')::date AS day,new_status FROM public.status_changes WHERE created_at>=start_at AND created_at<end_at AND (p_scope='team' OR user_id=a) AND new_status IN ('not_reached','no_interest','callback','appointment','production')
 ), daily AS (SELECT d.day,count(e.new_status)::int attempts,count(*) FILTER(WHERE e.new_status<>'not_reached')::int reached,count(*) FILTER(WHERE e.new_status='appointment')::int appointments,count(*) FILTER(WHERE e.new_status='production')::int production,count(*) FILTER(WHERE e.new_status='not_reached')::int not_reached,count(*) FILTER(WHERE e.new_status='no_interest')::int no_interest,count(*) FILTER(WHERE e.new_status='callback')::int callback FROM days d LEFT JOIN events e USING(day) GROUP BY d.day ORDER BY d.day)
 SELECT jsonb_build_object('timezone','Europe/Vienna','daily',jsonb_agg(to_jsonb(daily)),'attempts',sum(attempts),'reached',sum(reached),'appointments',sum(appointments),'production',sum(production),'not_reached',sum(not_reached),'no_interest',sum(no_interest),'callback',sum(callback),'appointment_rate',CASE WHEN sum(attempts)=0 THEN 0 ELSE round(sum(appointments)::numeric/sum(attempts),4) END) INTO r FROM daily;
 RETURN r;
END $$;
CREATE FUNCTION public.get_batch_progress() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor(); r jsonb;
BEGIN
 SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') INTO r FROM (SELECT b.id,b.name,b.import_state,b.created_at,count(l.id)::int total,count(l.id) FILTER(WHERE l.status<>'open' OR l.archived_at IS NOT NULL)::int completed FROM public.lead_batches b LEFT JOIN public.leads l ON l.batch_id=b.id GROUP BY b.id ORDER BY b.created_at DESC,b.id LIMIT 500) x; RETURN r;
END $$;
CREATE FUNCTION public.get_capabilities() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor(); admin boolean:=public.has_role(a,'admin');
BEGIN RETURN jsonb_build_object('user_id',a,'role',CASE WHEN admin THEN 'admin' ELSE 'caller' END,'can_manage_accounts',admin,'can_archive_leads',admin,'can_manage_products',admin,'can_retry_integrations',admin,'can_view_team_stats',admin,'can_import',true,'can_call',true); END $$;
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure signature,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('claim_integration_jobs','checkpoint_integration','finish_integration_job','backend_maintenance','retry_integration','resolve_integration_review','get_quality_issues','acknowledge_quality','get_dashboard','get_batch_progress','get_capabilities') LOOP
  EXECUTE 'REVOKE ALL ON FUNCTION '||f.signature||' FROM PUBLIC, anon, authenticated';
  IF f.proname IN ('claim_integration_jobs','checkpoint_integration','finish_integration_job','backend_maintenance') THEN EXECUTE 'GRANT EXECUTE ON FUNCTION '||f.signature||' TO service_role';
  ELSE EXECUTE 'GRANT EXECUTE ON FUNCTION '||f.signature||' TO authenticated'; END IF;
 END LOOP;
END $$;
