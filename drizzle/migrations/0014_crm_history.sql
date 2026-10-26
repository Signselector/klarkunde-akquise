-- Permanent lead history, original-caller attribution, CRM stage tracking, e-mail tracking and validation.
-- Written by the server only where noted. Test mode (integration_config.test_mode) still prevents real CRM and e-mail traffic.

-- 1. Statuses: "Kontaktdaten hinterlegt" is a real outcome now.
ALTER TABLE public.leads DROP CONSTRAINT lead_status_valid;
ALTER TABLE public.leads ADD CONSTRAINT lead_status_valid
  CHECK (status IN ('open','callback','appointment','production','no_interest','in_progress','on_hold','waiting_3d','low_q','high_q','reference_mail','contact_saved'));
CREATE OR REPLACE FUNCTION app_private.call_outcomes() RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT ARRAY['not_reached','no_interest','callback','appointment','production','low_q','high_q','waiting_3d','on_hold','reference_mail','contact_saved','in_progress']
$$;

-- 2. One CRM link per lead: who found it, which deal, where it is now.
ALTER TABLE public.lead_crm_links
  ADD COLUMN origin_caller_id uuid,
  ADD COLUMN origin_lead_id uuid,
  ADD COLUMN current_stage_key text,
  ADD COLUMN current_stage_id bigint,
  ADD COLUMN deal_status text,
  ADD COLUMN is_customer boolean NOT NULL DEFAULT false,
  ADD COLUMN stage_event_at timestamptz,
  ADD COLUMN sync_state text NOT NULL DEFAULT 'pending' CHECK (sync_state IN ('pending','syncing','synced','failed')),
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN last_synced_at timestamptz;
UPDATE public.lead_crm_links k SET origin_lead_id=k.lead_id,
  origin_caller_id=(SELECT a.user_id FROM public.lead_actions a WHERE a.lead_id=k.lead_id AND a.stage_key IS NOT NULL ORDER BY a.created_at LIMIT 1),
  current_stage_key=(SELECT a.stage_key FROM public.lead_actions a WHERE a.lead_id=k.lead_id AND a.stage_key IS NOT NULL ORDER BY a.created_at DESC LIMIT 1),
  sync_state=CASE WHEN k.deal_id IS NULL THEN 'pending' ELSE 'synced' END,
  is_customer=coalesce((SELECT bool_or(a.stage_key IN ('low_q','high_q','waiting_3d','on_hold','future_interest')) FROM public.lead_actions a WHERE a.lead_id=k.lead_id AND a.stage_key IS NOT NULL),false);
CREATE UNIQUE INDEX lead_crm_links_deal_unique ON public.lead_crm_links(country,deal_id) WHERE deal_id IS NOT NULL;
CREATE INDEX lead_crm_links_origin_idx ON public.lead_crm_links(origin_caller_id) WHERE is_customer;

-- The original caller and the deal never change once set. Stage changes and owner changes do not touch them.
CREATE FUNCTION app_private.crm_link_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF OLD.origin_caller_id IS NOT NULL AND NEW.origin_caller_id IS DISTINCT FROM OLD.origin_caller_id THEN
  RAISE EXCEPTION 'origin_caller_immutable' USING ERRCODE='23514';
 END IF;
 IF OLD.deal_id IS NOT NULL AND NEW.deal_id IS DISTINCT FROM OLD.deal_id THEN
  RAISE EXCEPTION 'deal_immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER crm_link_guard BEFORE UPDATE ON public.lead_crm_links FOR EACH ROW EXECUTE FUNCTION app_private.crm_link_guard();

-- 3. Activity history: append only.
CREATE TABLE public.lead_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq bigint GENERATED ALWAYS AS IDENTITY,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  deal_id bigint,
  origin_caller_id uuid,
  acting_user_id uuid,
  acting_user_name text,
  action_type text NOT NULL,
  previous_stage text,
  new_stage text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL CHECK (source IN ('cold_caller','pipedrive')),
  external_id text,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lead_activity_lead_idx ON public.lead_activity(lead_id, occurred_at);
CREATE INDEX lead_activity_origin_idx ON public.lead_activity(origin_caller_id, action_type, occurred_at);
CREATE UNIQUE INDEX lead_activity_external_unique ON public.lead_activity(external_id) WHERE external_id IS NOT NULL;
GRANT SELECT ON public.lead_activity TO authenticated;
GRANT ALL ON public.lead_activity TO service_role;
ALTER TABLE public.lead_activity ENABLE ROW LEVEL SECURITY;
CREATE POLICY lead_activity_read ON public.lead_activity FOR SELECT TO authenticated USING (
  public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'fulfilment')
  OR origin_caller_id = auth.uid() OR acting_user_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.leads l JOIN public.lead_batches b ON b.id=l.batch_id WHERE l.id=lead_activity.lead_id AND b.assigned_to=auth.uid()));

CREATE FUNCTION app_private.activity_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 -- Only cascading deletes (a lead is removed for good) may remove history; nobody edits it.
 IF TG_OP='DELETE' AND pg_trigger_depth()>1 THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'activity_is_append_only' USING ERRCODE='23514';
END $$;
CREATE TRIGGER activity_guard BEFORE UPDATE OR DELETE ON public.lead_activity FOR EACH ROW EXECUTE FUNCTION app_private.activity_guard();

-- Returns false when an event with the same external id was already stored (webhook delivered twice).
CREATE FUNCTION app_private.log_activity(
  p_lead uuid, p_type text, p_acting uuid, p_source text DEFAULT 'cold_caller',
  p_prev text DEFAULT NULL, p_new text DEFAULT NULL, p_deal bigint DEFAULT NULL,
  p_external text DEFAULT NULL, p_details jsonb DEFAULT NULL, p_at timestamptz DEFAULT now(), p_actor_name text DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE k public.lead_crm_links%ROWTYPE; nm text;
BEGIN
 SELECT * INTO k FROM public.lead_crm_links WHERE lead_id=p_lead;
 nm:=coalesce(p_actor_name,(SELECT display_name FROM public.profiles WHERE id=p_acting));
 INSERT INTO public.lead_activity(lead_id,deal_id,origin_caller_id,acting_user_id,acting_user_name,action_type,previous_stage,new_stage,occurred_at,source,external_id,details,created_at)
  VALUES(p_lead,coalesce(p_deal,k.deal_id),k.origin_caller_id,p_acting,nm,p_type,p_prev,p_new,p_at,p_source,p_external,p_details,clock_timestamp())
  ON CONFLICT (external_id) WHERE external_id IS NOT NULL DO NOTHING;
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION app_private.log_activity(uuid,text,uuid,text,text,text,bigint,text,jsonb,timestamptz,text) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION app_private.trg_lead_created() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM app_private.log_activity(NEW.id,'lead_created',(SELECT created_by FROM public.lead_batches WHERE id=NEW.batch_id),'cold_caller',NULL,NULL,NULL,NULL,NULL,NEW.created_at);
 RETURN NEW;
END $$;
CREATE TRIGGER lead_created_activity AFTER INSERT ON public.leads FOR EACH ROW EXECUTE FUNCTION app_private.trg_lead_created();

CREATE FUNCTION app_private.trg_action_activity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE prev text;
BEGIN
 SELECT current_stage_key INTO prev FROM public.lead_crm_links WHERE lead_id=NEW.lead_id;
 IF NOT EXISTS (SELECT 1 FROM public.lead_activity WHERE lead_id=NEW.lead_id AND action_type='first_contact') THEN
  PERFORM app_private.log_activity(NEW.lead_id,'first_contact',NEW.user_id,'cold_caller',NULL,NULL,NULL,NULL,NULL,NEW.created_at);
 END IF;
 PERFORM app_private.log_activity(NEW.lead_id,NEW.action,NEW.user_id,'cold_caller',prev,NEW.stage_key,NULL,'action:'||NEW.id,
   jsonb_strip_nulls(jsonb_build_object('scheduled_at',NEW.scheduled_at,'action_id',NEW.id)),NEW.created_at);
 IF NEW.logo_path IS NOT NULL THEN
  PERFORM app_private.log_activity(NEW.lead_id,'logo_uploaded',NEW.user_id,'cold_caller',NULL,NULL,NULL,'logo:'||NEW.id,NULL,NEW.created_at);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER lead_action_activity AFTER INSERT ON public.lead_actions FOR EACH ROW EXECUTE FUNCTION app_private.trg_action_activity();

-- 4. E-mails: nothing counts as sent until the provider confirmed it.
CREATE TABLE public.lead_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  created_by uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('reference_mail','contact_details')),
  template_id text,
  to_email text NOT NULL CHECK (to_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' AND length(to_email)<=254),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 300),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 20000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','simulated','failed')),
  provider text,
  provider_message_id text,
  error text,
  request_id uuid NOT NULL UNIQUE,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  attempted_at timestamptz,
  sent_at timestamptz
);
CREATE INDEX lead_emails_lead_idx ON public.lead_emails(lead_id, created_at DESC);
GRANT SELECT ON public.lead_emails TO authenticated;
GRANT ALL ON public.lead_emails TO service_role;
ALTER TABLE public.lead_emails ENABLE ROW LEVEL SECURITY;
CREATE POLICY lead_emails_read ON public.lead_emails FOR SELECT TO authenticated
  USING (created_by = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE FUNCTION app_private.trg_email_activity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.status IN ('sent','simulated') AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
  PERFORM app_private.log_activity(NEW.lead_id,'email_sent',NEW.created_by,'cold_caller',NULL,NULL,NULL,'email:'||NEW.id,
   jsonb_build_object('kind',NEW.kind,'to',NEW.to_email,'simulated',NEW.status='simulated'),coalesce(NEW.sent_at,now()));
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER lead_email_activity AFTER INSERT OR UPDATE OF status ON public.lead_emails FOR EACH ROW EXECUTE FUNCTION app_private.trg_email_activity();

-- 5. Result of the last stage check against the real Pipedrive account. Synchronisation stays locked until it passed.
CREATE TABLE public.pipedrive_stage_validation (
  country text PRIMARY KEY CHECK (country IN ('DE','AT','NL')),
  ok boolean NOT NULL,
  report jsonb NOT NULL,
  origin_field_key text,
  checked_at timestamptz NOT NULL DEFAULT now(),
  checked_by uuid
);
GRANT SELECT ON public.pipedrive_stage_validation TO authenticated;
GRANT ALL ON public.pipedrive_stage_validation TO service_role;
ALTER TABLE public.pipedrive_stage_validation ENABLE ROW LEVEL SECURITY;
CREATE POLICY psv_read ON public.pipedrive_stage_validation FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin') AND public.can_access_country(country));

-- 6. CRM writes, called by the server with the service role only.
CREATE FUNCTION app_private.customer_stage_keys() RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT ARRAY['low_q','high_q','waiting_3d','on_hold','future_interest']
$$;

CREATE FUNCTION public.crm_save_links(
  p_lead uuid, p_country text, p_org bigint, p_person bigint, p_deal bigint,
  p_origin uuid, p_stage_key text, p_actor uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE k public.lead_crm_links%ROWTYPE; created boolean:=false; flip boolean:=false;
BEGIN
 INSERT INTO public.lead_crm_links(lead_id,country,origin_caller_id,origin_lead_id,organization_id,person_id)
  VALUES(p_lead,p_country,p_origin,p_lead,p_org,p_person)
  ON CONFLICT (lead_id) DO UPDATE SET
   organization_id=coalesce(public.lead_crm_links.organization_id,EXCLUDED.organization_id),
   person_id=coalesce(public.lead_crm_links.person_id,EXCLUDED.person_id),
   origin_caller_id=coalesce(public.lead_crm_links.origin_caller_id,EXCLUDED.origin_caller_id),
   updated_at=now();
 SELECT * INTO k FROM public.lead_crm_links WHERE lead_id=p_lead FOR UPDATE;
 IF p_deal IS NOT NULL AND k.deal_id IS NULL THEN
  flip:=p_stage_key=ANY(app_private.customer_stage_keys());
  UPDATE public.lead_crm_links SET deal_id=p_deal,current_stage_key=p_stage_key,is_customer=is_customer OR flip,
   sync_state='synced',last_synced_at=now(),updated_at=now() WHERE lead_id=p_lead;
  created:=true;
  PERFORM app_private.log_activity(p_lead,'deal_created',p_actor,'cold_caller',NULL,p_stage_key,p_deal,'deal:'||p_country||':'||p_deal);
  IF flip THEN PERFORM app_private.log_activity(p_lead,'customer_assigned',p_actor,'cold_caller',NULL,p_stage_key,p_deal,'customer:'||p_country||':'||p_deal); END IF;
 END IF;
 RETURN jsonb_build_object('deal_created',created,'origin_caller_id',k.origin_caller_id);
END $$;

-- Applies a stage (and deal status) seen in Pipedrive or sent by this tool. Safe to call again with the same event.
CREATE FUNCTION public.crm_apply_stage(
  p_country text, p_deal_id bigint, p_stage_id bigint, p_event_id text, p_occurred timestamptz,
  p_source text, p_actor uuid DEFAULT NULL, p_actor_name text DEFAULT NULL, p_status text DEFAULT NULL, p_stage_key text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 k public.lead_crm_links%ROWTYPE; mapping jsonb; newkey text; ext text; changed boolean; flip boolean:=false; oldkey text;
 prio text[]:=ARRAY['low_q','high_q','waiting_3d','on_hold','future_interest','reference_mail','contact_saved','no_interest'];
 src text:=CASE WHEN p_source='pipedrive' THEN 'pipedrive' ELSE 'cold_caller' END;
 won_change boolean:=false;
BEGIN
 IF p_source NOT IN ('pipedrive','cold_caller') THEN RAISE EXCEPTION 'validation_failed' USING ERRCODE='22023'; END IF;
 SELECT * INTO k FROM public.lead_crm_links WHERE country=p_country AND deal_id=p_deal_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('applied',false,'reason','unknown_deal'); END IF;
 ext:=CASE WHEN p_event_id IS NULL THEN NULL ELSE 'stage:'||p_country||':'||p_event_id END;
 IF ext IS NOT NULL AND EXISTS(SELECT 1 FROM public.lead_activity WHERE external_id=ext) THEN
  RETURN jsonb_build_object('applied',false,'reason','duplicate');
 END IF;
 -- An older event that arrives late must not undo a newer stage.
 IF p_occurred IS NOT NULL AND k.stage_event_at IS NOT NULL AND p_occurred<k.stage_event_at THEN
  RETURN jsonb_build_object('applied',false,'reason','stale');
 END IF;
 oldkey:=k.current_stage_key;
 IF p_stage_id IS NOT NULL THEN
  newkey:=p_stage_key;
  IF newkey IS NULL THEN
   SELECT m.key INTO newkey FROM public.pipedrive_stage_mapping s, jsonb_each(s.mapping) AS m(key,value)
    WHERE s.country=p_country AND jsonb_typeof(m.value)='number' AND (m.value)::text::bigint=p_stage_id
    ORDER BY coalesce(array_position(prio,m.key),99), m.key LIMIT 1;
  END IF;
  changed:=p_stage_id IS DISTINCT FROM k.current_stage_id OR newkey IS DISTINCT FROM oldkey;
  -- A stage set by this tool already knows its key but not its id: only the id is new then.
  IF changed AND p_stage_id IS NOT DISTINCT FROM k.current_stage_id AND newkey IS NOT DISTINCT FROM oldkey THEN changed:=false; END IF;
  IF changed THEN
   flip:=NOT k.is_customer AND newkey=ANY(app_private.customer_stage_keys());
   UPDATE public.lead_crm_links SET current_stage_id=p_stage_id,current_stage_key=newkey,is_customer=is_customer OR flip,
    stage_event_at=coalesce(p_occurred,now()),last_synced_at=now(),sync_state='synced',updated_at=now() WHERE lead_id=k.lead_id;
   IF newkey IS DISTINCT FROM oldkey OR oldkey IS NULL THEN
    PERFORM app_private.log_activity(k.lead_id,'stage_change',p_actor,src,oldkey,coalesce(newkey,'stage:'||p_stage_id),p_deal_id,ext,NULL,coalesce(p_occurred,now()),p_actor_name);
    IF newkey='offer' THEN PERFORM app_private.log_activity(k.lead_id,'offer_created',p_actor,src,oldkey,newkey,p_deal_id,ext||':offer',NULL,coalesce(p_occurred,now()),p_actor_name); END IF;
    IF flip THEN PERFORM app_private.log_activity(k.lead_id,'customer_assigned',p_actor,src,oldkey,newkey,p_deal_id,'customer:'||p_country||':'||p_deal_id,NULL,coalesce(p_occurred,now()),p_actor_name); END IF;
   ELSE
    -- Same key, other numeric id (shared mapping): remember the id only.
    UPDATE public.lead_crm_links SET current_stage_id=p_stage_id WHERE lead_id=k.lead_id;
   END IF;
  ELSE
   UPDATE public.lead_crm_links SET current_stage_id=coalesce(current_stage_id,p_stage_id),last_synced_at=now(),sync_state='synced' WHERE lead_id=k.lead_id;
  END IF;
 END IF;
 IF p_status IN ('won','lost') AND k.deal_status IS DISTINCT FROM p_status THEN
  UPDATE public.lead_crm_links SET deal_status=p_status,last_synced_at=now(),updated_at=now() WHERE lead_id=k.lead_id;
  PERFORM app_private.log_activity(k.lead_id,CASE WHEN p_status='won' THEN 'deal_won' ELSE 'deal_lost' END,p_actor,src,oldkey,newkey,p_deal_id,
   coalesce(ext,'status:'||p_country||':'||p_deal_id||':'||p_status)||':status',NULL,coalesce(p_occurred,now()),p_actor_name);
  won_change:=true;
 END IF;
 RETURN jsonb_build_object('applied',coalesce(changed,false) OR won_change,'stage_key',newkey,'customer_assigned',flip);
END $$;

CREATE FUNCTION public.crm_set_sync_state(p_lead uuid, p_state text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 UPDATE public.lead_crm_links SET sync_state=p_state,updated_at=now() WHERE lead_id=p_lead AND p_state IN ('pending','syncing','synced','failed')
$$;
REVOKE ALL ON FUNCTION public.crm_save_links(uuid,text,bigint,bigint,bigint,uuid,text,uuid), public.crm_apply_stage(text,bigint,bigint,text,timestamptz,text,uuid,text,text,text), public.crm_set_sync_state(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_save_links(uuid,text,bigint,bigint,bigint,uuid,text,uuid), public.crm_apply_stage(text,bigint,bigint,text,timestamptz,text,uuid,text,text,text), public.crm_set_sync_state(uuid,text) TO service_role;

-- 7. Reading: customers, completed leads and performance. Callers only ever see their own.
CREATE FUNCTION public.get_my_customers(p_country text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor();
BEGIN
 IF NOT public.can_access_country(p_country) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object(
   'lead_id',k.lead_id,'deal_id',k.deal_id,'company',l.company,'contact_name',l.contact_name,'email',l.email,'phone',l.phone,
   'last_called_at',l.last_called_at,'stage_key',k.current_stage_key,'stage_id',k.current_stage_id,'deal_status',k.deal_status,
   'synced_at',k.last_synced_at,'sync_state',k.sync_state) ORDER BY l.last_called_at DESC NULLS LAST)
  FROM public.lead_crm_links k JOIN public.leads l ON l.id=k.lead_id
  WHERE k.country=p_country AND k.is_customer AND k.deal_id IS NOT NULL AND k.origin_caller_id=a),'[]'::jsonb);
END $$;

CREATE FUNCTION public.get_completed_overview(p_country text, p_limit integer DEFAULT 300) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor(); adm boolean:=public.has_role(app_private.actor(),'admin');
BEGIN
 IF NOT public.can_access_country(p_country) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 RETURN coalesce((SELECT jsonb_agg(x ORDER BY (x->>'completed_at') DESC) FROM (
  SELECT jsonb_build_object(
   'lead_id',l.id,'company',l.company,'contact_name',l.contact_name,'phone',l.phone,'email',l.email,'city',l.city,'extra',l.extra,'status',l.status,
   'origin_caller_id',k.origin_caller_id,'origin_caller_name',(SELECT display_name FROM public.profiles WHERE id=coalesce(k.origin_caller_id,l.last_called_by)),
   'action',(SELECT la.action FROM public.lead_actions la WHERE la.lead_id=l.id ORDER BY la.created_at DESC LIMIT 1),
   'crm_stage_key',k.current_stage_key,'deal_id',k.deal_id,'deal_status',k.deal_status,'sync_state',k.sync_state,
   'completed_at',(SELECT la.created_at FROM public.lead_actions la WHERE la.lead_id=l.id ORDER BY la.created_at DESC LIMIT 1),
   'last_activity_at',(SELECT max(ac.occurred_at) FROM public.lead_activity ac WHERE ac.lead_id=l.id)) AS x
  FROM public.leads l JOIN public.lead_batches b ON b.id=l.batch_id LEFT JOIN public.lead_crm_links k ON k.lead_id=l.id
  WHERE b.country=p_country AND l.archived_at IS NULL
    AND l.status NOT IN ('open','callback')
    AND (adm OR l.last_called_by=a OR b.assigned_to=a OR k.origin_caller_id=a)
  ORDER BY l.last_called_at DESC NULLS LAST LIMIT least(greatest(p_limit,1),1000)) t),'[]'::jsonb);
END $$;

-- Data foundation for rewards: counts per original caller and period. Qualified leads count once per lead.
CREATE FUNCTION public.get_caller_performance(p_from date, p_to date, p_granularity text DEFAULT 'month', p_user uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor(); adm boolean:=public.has_role(app_private.actor(),'admin'); u uuid;
BEGIN
 IF p_granularity NOT IN ('day','week','month') OR p_from IS NULL OR p_to IS NULL OR p_to<p_from OR p_to-p_from>1100 THEN
  RAISE EXCEPTION 'validation_failed' USING ERRCODE='22023';
 END IF;
 u:=CASE WHEN adm THEN p_user ELSE a END;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('period',period,'user_id',uid,'processed',processed,'qualified',qualified,
   'deals',deals,'won',won,'conversion',CASE WHEN deals=0 THEN NULL ELSE round(won*100.0/deals,2) END,
   'per_100',CASE WHEN processed=0 THEN NULL ELSE round(qualified*100.0/processed,2) END) ORDER BY period,uid)
  FROM (
   WITH w AS (SELECT p_from::timestamp AT TIME ZONE 'Europe/Vienna' s,(p_to+1)::timestamp AT TIME ZONE 'Europe/Vienna' e),
   proc AS (SELECT date_trunc(p_granularity,c.created_at AT TIME ZONE 'Europe/Vienna')::date period,c.user_id uid,count(DISTINCT c.lead_id) n
            FROM public.status_changes c,w WHERE c.created_at>=w.s AND c.created_at<w.e AND c.new_status=ANY(app_private.call_outcomes()) AND (u IS NULL OR c.user_id=u) GROUP BY 1,2),
   qual AS (SELECT date_trunc(p_granularity,f.created_at AT TIME ZONE 'Europe/Vienna')::date period,f.user_id uid,count(*) n FROM (
             SELECT DISTINCT ON (lead_id) lead_id,user_id,created_at FROM public.lead_actions WHERE action IN ('low_q','high_q') ORDER BY lead_id,created_at,id) f,w
            WHERE f.created_at>=w.s AND f.created_at<w.e AND (u IS NULL OR f.user_id=u) GROUP BY 1,2),
   dl AS (SELECT date_trunc(p_granularity,ac.occurred_at AT TIME ZONE 'Europe/Vienna')::date period,ac.origin_caller_id uid,
            count(*) FILTER (WHERE ac.action_type='deal_created') deals,count(*) FILTER (WHERE ac.action_type='deal_won') won
          FROM public.lead_activity ac,w WHERE ac.occurred_at>=w.s AND ac.occurred_at<w.e AND ac.action_type IN ('deal_created','deal_won')
            AND ac.origin_caller_id IS NOT NULL AND (u IS NULL OR ac.origin_caller_id=u) GROUP BY 1,2),
   keys AS (SELECT period,uid FROM proc UNION SELECT period,uid FROM qual UNION SELECT period,uid FROM dl)
   SELECT k.period,k.uid,coalesce(p.n,0) processed,coalesce(q.n,0) qualified,coalesce(d.deals,0) deals,coalesce(d.won,0) won
   FROM keys k LEFT JOIN proc p USING(period,uid) LEFT JOIN qual q USING(period,uid) LEFT JOIN dl d USING(period,uid)) r),'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.get_my_customers(text), public.get_completed_overview(text,integer), public.get_caller_performance(date,date,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_customers(text), public.get_completed_overview(text,integer), public.get_caller_performance(date,date,text,uuid) TO authenticated;

-- 8. record_lead_action: e-mail actions need a confirmed e-mail, Kontaktdaten moves the lead on, the first CRM action fixes the original caller.
CREATE OR REPLACE FUNCTION public.record_lead_action(
  p_request_id uuid, p_lead_id uuid, p_expected_version integer, p_action text,
  p_note text DEFAULT NULL, p_scheduled_at timestamptz DEFAULT NULL,
  p_logo_path text DEFAULT NULL, p_details jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 a uuid:=app_private.actor();
 note text:=nullif(btrim(p_note),'');
 payload jsonb;
 r jsonb;
 l public.leads%ROWTYPE;
 bt public.lead_batches%ROWTYPE;
 new_status text;
 stage text;
 counts_as_call boolean:=true;
 aid uuid;
 cb uuid;
 ex jsonb;
 key text;
 val text;
 sync text;
 eid uuid;
BEGIN
 IF p_action IS NULL OR p_action NOT IN ('low_q','high_q','waiting_3d','no_interest','on_hold','contact_details','callback','reference_mail','not_reached') THEN
  RAISE EXCEPTION 'validation_failed' USING ERRCODE='22023';
 END IF;
 payload:=jsonb_build_array(p_lead_id,p_expected_version,p_action,note,p_scheduled_at,p_logo_path,p_details);
 r:=app_private.request('lead_action',p_request_id,payload); IF r IS NOT NULL THEN RETURN r; END IF;
 IF length(coalesce(note,''))>10000 THEN RAISE EXCEPTION 'note_too_long' USING ERRCODE='22023'; END IF;

 SELECT * INTO l FROM public.leads WHERE id=p_lead_id AND archived_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'lead_not_found' USING ERRCODE='P0002'; END IF;
 IF l.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'stale_lead' USING ERRCODE='40001'; END IF;
 SELECT * INTO bt FROM public.lead_batches WHERE id=l.batch_id;
 IF NOT public.can_access_country(bt.country) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 -- Own batch, own earlier work, or an admin. Anyone else may not touch the lead.
 IF NOT (public.has_role(a,'admin') OR bt.assigned_to IS NOT DISTINCT FROM a OR l.last_called_by IS NOT DISTINCT FROM a) THEN
  RAISE EXCEPTION 'not_your_lead' USING ERRCODE='42501';
 END IF;
 IF EXISTS(SELECT 1 FROM public.lead_claims WHERE lead_id=l.id AND expires_at>now() AND user_id<>a) THEN
  RAISE EXCEPTION 'lead_claimed' USING ERRCODE='40001';
 END IF;

 -- Required inputs per action.
 IF p_action IN ('low_q','high_q') THEN
  IF note IS NULL THEN RAISE EXCEPTION 'note_required' USING ERRCODE='22023'; END IF;
  IF p_logo_path IS NULL OR p_logo_path NOT LIKE a::text||'/'||l.id::text||'/%' OR length(p_logo_path)>500 THEN
   RAISE EXCEPTION 'logo_required' USING ERRCODE='22023';
  END IF;
 ELSIF p_action IN ('waiting_3d','on_hold') THEN
  IF note IS NULL THEN RAISE EXCEPTION 'note_required' USING ERRCODE='22023'; END IF;
 END IF;
 IF p_action='callback' AND (p_scheduled_at IS NULL OR NOT pg_catalog.isfinite(p_scheduled_at) OR p_scheduled_at<=now()) THEN
  RAISE EXCEPTION 'invalid_schedule' USING ERRCODE='22023';
 END IF;
 IF p_action='on_hold' AND p_scheduled_at IS NOT NULL AND (NOT pg_catalog.isfinite(p_scheduled_at) OR p_scheduled_at<=now()) THEN
  RAISE EXCEPTION 'invalid_schedule' USING ERRCODE='22023';
 END IF;
 IF p_action='contact_details' THEN
  IF p_details IS NULL OR jsonb_typeof(p_details)<>'object' OR octet_length(p_details::text)>20000
     OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_details) k WHERE k NOT IN ('company','contact_name','phone','email','website','city','address','email_id','template')) THEN
   RAISE EXCEPTION 'validation_failed' USING ERRCODE='22023';
  END IF;
  IF nullif(btrim(p_details->>'email'),'') IS NOT NULL AND btrim(p_details->>'email') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
   RAISE EXCEPTION 'invalid_email' USING ERRCODE='22023';
  END IF;
 END IF;
 -- Emails must have been sent (or simulated in test mode) before the lead may move on.
 IF p_action IN ('reference_mail','contact_details') THEN
  BEGIN eid:=nullif(p_details->>'email_id','')::uuid; EXCEPTION WHEN others THEN eid:=NULL; END;
  IF eid IS NULL OR NOT EXISTS(SELECT 1 FROM public.lead_emails e WHERE e.id=eid AND e.lead_id=l.id AND e.created_by=a AND e.kind=p_action AND e.status IN ('sent','simulated')) THEN
   RAISE EXCEPTION 'email_not_sent' USING ERRCODE='22023';
  END IF;
 END IF;
 IF p_action='reference_mail' AND (p_details IS NULL OR jsonb_typeof(p_details)<>'object' OR octet_length(p_details::text)>50000) THEN
  RAISE EXCEPTION 'validation_failed' USING ERRCODE='22023';
 END IF;

 -- Status and CRM stage key. Only actions with a stage key are queued for the CRM.
 new_status:=CASE p_action
  WHEN 'low_q' THEN 'low_q' WHEN 'high_q' THEN 'high_q'
  WHEN 'waiting_3d' THEN 'waiting_3d' WHEN 'on_hold' THEN 'on_hold'
  WHEN 'no_interest' THEN 'no_interest' WHEN 'callback' THEN 'callback'
  WHEN 'reference_mail' THEN 'reference_mail' WHEN 'contact_details' THEN 'contact_saved'
  WHEN 'not_reached' THEN 'open' ELSE NULL END;
 stage:=CASE p_action WHEN 'low_q' THEN 'low_q' WHEN 'high_q' THEN 'high_q' WHEN 'waiting_3d' THEN 'waiting_3d'
  WHEN 'on_hold' THEN 'on_hold' WHEN 'reference_mail' THEN 'reference_mail' WHEN 'contact_details' THEN 'contact_saved' ELSE NULL END;
 sync:=CASE WHEN stage IS NULL THEN NULL ELSE 'queued' END;
 counts_as_call:=true;

 IF p_action='contact_details' AND (p_details-'email_id'-'template')<>'{}'::jsonb THEN
  ex:=coalesce(l.extra,'{}'::jsonb);
  IF p_details ? 'website' THEN
   SELECT coalesce((SELECT k FROM jsonb_object_keys(ex) k WHERE lower(btrim(k)) IN ('website','webseite','web','url') LIMIT 1),'Website') INTO key;
   val:=nullif(btrim(p_details->>'website'),'');
   ex:=CASE WHEN val IS NULL THEN ex-key ELSE jsonb_set(ex,ARRAY[key],to_jsonb(val)) END;
  END IF;
  IF p_details ? 'address' THEN
   SELECT coalesce((SELECT k FROM jsonb_object_keys(ex) k WHERE lower(btrim(k)) IN ('adresse','address','anschrift') LIMIT 1),'Adresse') INTO key;
   val:=nullif(btrim(p_details->>'address'),'');
   ex:=CASE WHEN val IS NULL THEN ex-key ELSE jsonb_set(ex,ARRAY[key],to_jsonb(val)) END;
  END IF;
  UPDATE public.leads SET
   company=CASE WHEN p_details ? 'company' THEN nullif(btrim(p_details->>'company'),'') ELSE company END,
   contact_name=CASE WHEN p_details ? 'contact_name' THEN nullif(btrim(p_details->>'contact_name'),'') ELSE contact_name END,
   email=CASE WHEN p_details ? 'email' THEN nullif(lower(btrim(p_details->>'email')),'') ELSE email END,
   phone=CASE WHEN p_details ? 'phone' THEN nullif(btrim(p_details->>'phone'),'') ELSE phone END,
   city=CASE WHEN p_details ? 'city' THEN nullif(btrim(p_details->>'city'),'') ELSE city END,
   extra=ex
  WHERE id=l.id;
 END IF;
 IF new_status IS NOT NULL THEN
  UPDATE public.leads SET status=new_status,attempts=attempts+1,last_called_at=now(),last_called_by=a WHERE id=l.id;
  INSERT INTO public.status_changes(lead_id,user_id,old_status,new_status) VALUES(l.id,a,l.status,
   CASE WHEN p_action='not_reached' THEN 'not_reached' ELSE new_status END);
  -- A recorded outcome replaces earlier open callbacks of this lead.
  UPDATE public.callbacks SET done=true WHERE lead_id=l.id AND NOT done;
 END IF;

 IF p_action IN ('callback','on_hold') AND p_scheduled_at IS NOT NULL THEN
  INSERT INTO public.callbacks(lead_id,user_id,due_at,country) VALUES(l.id,a,p_scheduled_at,bt.country) RETURNING id INTO cb;
 END IF;
 IF note IS NOT NULL THEN INSERT INTO public.lead_notes(lead_id,user_id,body) VALUES(l.id,a,note); END IF;
 DELETE FROM public.lead_claims WHERE lead_id=l.id AND user_id=a;

 INSERT INTO public.lead_actions(lead_id,user_id,action,note,stage_key,crm_sync_state,logo_path,scheduled_at,details)
  VALUES(l.id,a,p_action,note,stage,sync,CASE WHEN p_action IN ('low_q','high_q') THEN p_logo_path END,p_scheduled_at,p_details)
  RETURNING id INTO aid;
 IF stage IS NOT NULL THEN
  -- The first caller with a CRM action becomes the permanent original caller of this lead.
  INSERT INTO public.lead_crm_links(lead_id,country,origin_caller_id,origin_lead_id) VALUES(l.id,bt.country,a,l.id)
   ON CONFLICT (lead_id) DO UPDATE SET origin_caller_id=coalesce(public.lead_crm_links.origin_caller_id,a),updated_at=now();
 END IF;
 INSERT INTO public.audit_events(actor,action,target_id) VALUES(a,'lead_action:'||p_action,l.id);

 RETURN app_private.finish('lead_action',p_request_id,payload,jsonb_build_object(
  'lead_id',l.id,'action_id',aid,'action',p_action,
  'status',coalesce(new_status,l.status),
  'version',l.version+1,
  'attempts',l.attempts+CASE WHEN counts_as_call THEN 1 ELSE 0 END,
  'callback_id',cb,'stage_key',stage,'crm_sync_state',sync));
END $$;
REVOKE ALL ON FUNCTION public.record_lead_action(uuid,uuid,integer,text,text,timestamptz,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_lead_action(uuid,uuid,integer,text,text,timestamptz,text,jsonb) TO authenticated;
