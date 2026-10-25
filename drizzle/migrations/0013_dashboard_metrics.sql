CREATE FUNCTION app_private.call_outcomes() RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT ARRAY['not_reached','no_interest','callback','appointment','production','low_q','high_q','waiting_3d','on_hold','reference_mail','in_progress']
$$;

ALTER TABLE public.lead_actions DROP CONSTRAINT IF EXISTS lead_actions_crm_sync_state_check;
ALTER TABLE public.lead_actions ADD CONSTRAINT lead_actions_crm_sync_state_check
  CHECK (crm_sync_state IN ('queued','syncing','synced','error','review','simulated'));

CREATE FUNCTION public.get_caller_day(p_day date DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor(); d date:=coalesce(p_day,(now() AT TIME ZONE 'Europe/Vienna')::date); s timestamptz; e timestamptz; r jsonb;
BEGIN
 s:=d::timestamp AT TIME ZONE 'Europe/Vienna'; e:=(d+1)::timestamp AT TIME ZONE 'Europe/Vienna';
 SELECT jsonb_build_object('day',d,'timezone','Europe/Vienna',
  'attempts',count(*),
  'reached',count(DISTINCT lead_id) FILTER (WHERE new_status<>'not_reached'),
  'no_interest',count(*) FILTER (WHERE new_status='no_interest'),
  'not_reached',count(*) FILTER (WHERE new_status='not_reached'),
  'low_q',count(DISTINCT lead_id) FILTER (WHERE new_status='low_q'),
  'high_q',count(DISTINCT lead_id) FILTER (WHERE new_status='high_q'),
  'waiting_3d',count(DISTINCT lead_id) FILTER (WHERE new_status='waiting_3d'),
  'total_leads',count(DISTINCT lead_id)) INTO r
 FROM public.status_changes WHERE user_id=a AND created_at>=s AND created_at<e AND new_status=ANY(app_private.call_outcomes());
 RETURN r;
END $$;

CREATE TABLE public.monthly_quality (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  month date NOT NULL CHECK (month = date_trunc('month', month)::date),
  processed integer NOT NULL CHECK (processed >= 0),
  qualified integer NOT NULL CHECK (qualified >= 0),
  low_q integer NOT NULL CHECK (low_q >= 0),
  high_q integer NOT NULL CHECK (high_q >= 0),
  per_100 numeric(8,2),
  frozen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, month),
  CHECK (qualified = low_q + high_q AND qualified <= processed)
);
GRANT SELECT ON public.monthly_quality TO authenticated;
GRANT ALL ON public.monthly_quality TO service_role;
ALTER TABLE public.monthly_quality ENABLE ROW LEVEL SECURITY;
CREATE POLICY monthly_quality_read ON public.monthly_quality FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

CREATE FUNCTION app_private.month_quality(p_user uuid, p_month date) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 WITH w AS (SELECT p_month::timestamp AT TIME ZONE 'Europe/Vienna' s,(p_month+interval '1 month')::timestamp AT TIME ZONE 'Europe/Vienna' e),
 ev AS (SELECT c.lead_id,c.new_status,c.created_at,c.id FROM public.status_changes c,w
        WHERE c.user_id=p_user AND c.created_at>=w.s AND c.created_at<w.e AND c.new_status=ANY(app_private.call_outcomes())),
 q AS (SELECT DISTINCT ON (lead_id) lead_id,new_status FROM ev WHERE new_status IN ('low_q','high_q') ORDER BY lead_id,created_at DESC,id DESC)
 SELECT jsonb_build_object('processed',(SELECT count(DISTINCT lead_id) FROM ev),
  'low_q',(SELECT count(*) FROM q WHERE new_status='low_q'),'high_q',(SELECT count(*) FROM q WHERE new_status='high_q'))
$$;

CREATE FUNCTION app_private.store_month_quality(p_user uuid, p_month date) RETURNS public.monthly_quality LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m jsonb:=app_private.month_quality(p_user,p_month); row public.monthly_quality;
BEGIN
 INSERT INTO public.monthly_quality(user_id,month,processed,qualified,low_q,high_q,per_100)
  VALUES(p_user,p_month,(m->>'processed')::int,(m->>'low_q')::int+(m->>'high_q')::int,(m->>'low_q')::int,(m->>'high_q')::int,
   CASE WHEN (m->>'processed')::int=0 THEN NULL ELSE round(((m->>'low_q')::int+(m->>'high_q')::int)*100.0/(m->>'processed')::int,2) END)
  ON CONFLICT (user_id,month) DO NOTHING;
 SELECT * INTO row FROM public.monthly_quality WHERE user_id=p_user AND month=p_month;
 RETURN row;
END $$;
REVOKE ALL ON FUNCTION app_private.store_month_quality(uuid,date) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.get_monthly_quality(p_month date DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor(); today date:=(now() AT TIME ZONE 'Europe/Vienna')::date; mth date; stored public.monthly_quality; m jsonb; q int; p int;
BEGIN
 mth:=date_trunc('month',coalesce(p_month,(date_trunc('month',today)-interval '1 month')::date))::date;
 IF mth>date_trunc('month',today)::date THEN RAISE EXCEPTION 'invalid_month' USING ERRCODE='22023'; END IF;
 SELECT * INTO stored FROM public.monthly_quality WHERE user_id=a AND month=mth;
 IF NOT FOUND AND mth<date_trunc('month',today)::date THEN stored:=app_private.store_month_quality(a,mth); END IF;
 IF stored.user_id IS NOT NULL THEN
  RETURN jsonb_build_object('month',mth,'processed',stored.processed,'qualified',stored.qualified,'low_q',stored.low_q,'high_q',stored.high_q,'per_100',stored.per_100,'final',true,'frozen_at',stored.frozen_at);
 END IF;
 m:=app_private.month_quality(a,mth); p:=(m->>'processed')::int; q:=(m->>'low_q')::int+(m->>'high_q')::int;
 RETURN jsonb_build_object('month',mth,'processed',p,'qualified',q,'low_q',(m->>'low_q')::int,'high_q',(m->>'high_q')::int,
  'per_100',CASE WHEN p=0 THEN NULL ELSE round(q*100.0/p,2) END,'final',false,'frozen_at',NULL);
END $$;

CREATE FUNCTION public.freeze_monthly_quality(p_month date DEFAULT NULL) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE today date:=(now() AT TIME ZONE 'Europe/Vienna')::date; mth date; n int:=0; u uuid;
BEGIN
 mth:=date_trunc('month',coalesce(p_month,(date_trunc('month',today)-interval '1 month')::date))::date;
 IF mth>=date_trunc('month',today)::date THEN RAISE EXCEPTION 'month_not_finished' USING ERRCODE='22023'; END IF;
 FOR u IN SELECT DISTINCT c.user_id FROM public.status_changes c
   WHERE c.user_id IS NOT NULL AND c.created_at>=mth::timestamp AT TIME ZONE 'Europe/Vienna' AND c.created_at<(mth+interval '1 month')::timestamp AT TIME ZONE 'Europe/Vienna'
     AND c.new_status=ANY(app_private.call_outcomes())
     AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=c.user_id)
     AND NOT EXISTS(SELECT 1 FROM public.monthly_quality q WHERE q.user_id=c.user_id AND q.month=mth) LOOP
  PERFORM app_private.store_month_quality(u,mth); n:=n+1;
 END LOOP;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.freeze_monthly_quality(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.freeze_monthly_quality(date) TO service_role;

DO $$ BEGIN
 IF to_regnamespace('cron') IS NOT NULL THEN
  PERFORM cron.schedule('freeze-monthly-quality','10 1 * * *','SELECT public.freeze_monthly_quality()');
 END IF;
END $$;

CREATE TABLE public.team_metrics (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  period date NOT NULL CHECK (period = date_trunc('month', period)::date),
  lead_quality numeric CHECK (lead_quality IS NULL OR lead_quality >= 0),
  leads_contributed integer CHECK (leads_contributed IS NULL OR leads_contributed >= 0),
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, period)
);
GRANT SELECT ON public.team_metrics TO authenticated;
GRANT ALL ON public.team_metrics TO service_role;
ALTER TABLE public.team_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY team_metrics_read ON public.team_metrics FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

CREATE FUNCTION public.upsert_team_metrics(p_rows jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r jsonb; uid uuid; n int:=0; unmatched jsonb:='[]'::jsonb; per date; lq numeric; lc int;
BEGIN
 IF p_rows IS NULL OR jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows)>5000 THEN RAISE EXCEPTION 'validation_failed' USING ERRCODE='22023'; END IF;
 FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
  per:=date_trunc('month',(r->>'period')::date)::date;
  lq:=CASE WHEN r->'lead_quality' IS NULL OR jsonb_typeof(r->'lead_quality')='null' THEN NULL ELSE (r->>'lead_quality')::numeric END;
  lc:=CASE WHEN r->'leads_contributed' IS NULL OR jsonb_typeof(r->'leads_contributed')='null' THEN NULL ELSE (r->>'leads_contributed')::int END;
  SELECT id INTO uid FROM public.profiles WHERE lower(email)=lower(btrim(r->>'email'));
  IF uid IS NULL THEN unmatched:=unmatched||to_jsonb(r->>'email'); CONTINUE; END IF;
  INSERT INTO public.team_metrics(user_id,period,lead_quality,leads_contributed,synced_at) VALUES(uid,per,lq,lc,now())
   ON CONFLICT (user_id,period) DO UPDATE SET lead_quality=EXCLUDED.lead_quality,leads_contributed=EXCLUDED.leads_contributed,synced_at=now();
  n:=n+1;
 END LOOP;
 RETURN jsonb_build_object('updated',n,'unmatched',unmatched);
END $$;
REVOKE ALL ON FUNCTION public.upsert_team_metrics(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_team_metrics(jsonb) TO service_role;

CREATE FUNCTION public.get_team_metrics() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor(); t public.team_metrics;
BEGIN
 SELECT * INTO t FROM public.team_metrics WHERE user_id=a ORDER BY period DESC LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('period',t.period,'lead_quality',t.lead_quality,'leads_contributed',t.leads_contributed,'synced_at',t.synced_at);
END $$;

CREATE TABLE public.points_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  points integer NOT NULL CHECK (points <> 0),
  reason text NOT NULL,
  source_type text NOT NULL,
  source_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX points_ledger_source_uidx ON public.points_ledger(source_type, source_id, reason) WHERE source_id IS NOT NULL;
CREATE INDEX points_ledger_week_idx ON public.points_ledger(occurred_at);
CREATE TABLE public.coins_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  coins integer NOT NULL CHECK (coins <> 0),
  reason text NOT NULL,
  source_type text NOT NULL,
  source_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX coins_ledger_source_uidx ON public.coins_ledger(source_type, source_id, reason) WHERE source_id IS NOT NULL;
CREATE TABLE public.weekly_ranking_snapshots (
  week_start date NOT NULL,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  points integer NOT NULL,
  rank integer NOT NULL,
  frozen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (week_start, user_id)
);
GRANT SELECT ON public.points_ledger, public.coins_ledger TO authenticated;
GRANT ALL ON public.points_ledger, public.coins_ledger, public.weekly_ranking_snapshots TO service_role;
ALTER TABLE public.points_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coins_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_ranking_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY points_own ON public.points_ledger FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY coins_own ON public.coins_ledger FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));

CREATE FUNCTION public.get_weekly_ranking(p_week date DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor(); today date:=(now() AT TIME ZONE 'Europe/Vienna')::date; w date; s timestamptz; e timestamptz; done boolean; rows jsonb; mine jsonb;
BEGIN
 w:=date_trunc('week',coalesce(p_week,today)::timestamp)::date;
 IF w>date_trunc('week',today::timestamp)::date THEN RAISE EXCEPTION 'invalid_week' USING ERRCODE='22023'; END IF;
 s:=w::timestamp AT TIME ZONE 'Europe/Vienna'; e:=(w+7)::timestamp AT TIME ZONE 'Europe/Vienna'; done:=e<=now();
 IF done AND NOT EXISTS(SELECT 1 FROM public.weekly_ranking_snapshots WHERE week_start=w) THEN
  INSERT INTO public.weekly_ranking_snapshots(week_start,user_id,points,rank)
   SELECT w,t.user_id,t.points,rank() OVER (ORDER BY t.points DESC)
   FROM (SELECT user_id,sum(points)::int points FROM public.points_ledger WHERE occurred_at>=s AND occurred_at<e GROUP BY user_id HAVING sum(points)>0) t
   ON CONFLICT DO NOTHING;
 END IF;
 IF done THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('rank',x.rank,'user_id',x.user_id,'name',x.name,'points',x.points,'is_me',x.user_id=a) ORDER BY x.rank,x.name),'[]'::jsonb) INTO rows
   FROM (SELECT q.rank,q.user_id,q.points,coalesce(p.display_name,'Unbekannt') name FROM public.weekly_ranking_snapshots q LEFT JOIN public.profiles p ON p.id=q.user_id WHERE q.week_start=w ORDER BY q.rank,p.display_name LIMIT 50) x;
 ELSE
  SELECT coalesce(jsonb_agg(jsonb_build_object('rank',x.rank,'user_id',x.user_id,'name',x.name,'points',x.points,'is_me',x.user_id=a) ORDER BY x.rank,x.name),'[]'::jsonb) INTO rows
   FROM (SELECT rank() OVER (ORDER BY t.points DESC) rank,t.user_id,t.points,coalesce(p.display_name,'Unbekannt') name
         FROM (SELECT user_id,sum(points)::int points FROM public.points_ledger WHERE occurred_at>=s AND occurred_at<e GROUP BY user_id HAVING sum(points)>0) t
         LEFT JOIN public.profiles p ON p.id=t.user_id ORDER BY 1,p.display_name LIMIT 50) x;
 END IF;
 SELECT jsonb_build_object('rank',CASE WHEN done THEN (SELECT rank FROM public.weekly_ranking_snapshots WHERE week_start=w AND user_id=a)
    ELSE (SELECT z.rank FROM (SELECT t.user_id,rank() OVER (ORDER BY t.points DESC) rank FROM (SELECT user_id,sum(points)::int points FROM public.points_ledger WHERE occurred_at>=s AND occurred_at<e GROUP BY user_id HAVING sum(points)>0) t) z WHERE z.user_id=a) END,
   'points',coalesce((SELECT sum(points)::int FROM public.points_ledger WHERE user_id=a AND occurred_at>=s AND occurred_at<e),0)) INTO mine;
 RETURN jsonb_build_object('week_start',w,'week_end',w+6,'final',done,'rows',rows,'me',mine);
END $$;

CREATE OR REPLACE FUNCTION public.get_batch_progress() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor(); r jsonb;
BEGIN
 SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') INTO r FROM (
  SELECT b.id,b.name,b.import_state,b.created_at,b.assigned_to,b.assigned_at,p.display_name assigned_name,
   count(l.id)::int total,
   count(l.id) FILTER(WHERE l.status<>'open' OR l.attempts>0)::int processed,
   count(l.id) FILTER(WHERE l.status='open' AND l.attempts=0)::int unprocessed,
   count(l.id) FILTER(WHERE l.status<>'open' OR l.attempts>0)::int completed,
   count(l.id) FILTER(WHERE l.status='open' AND l.attempts=0)::int open
  FROM public.lead_batches b LEFT JOIN public.leads l ON l.batch_id=b.id AND l.archived_at IS NULL LEFT JOIN public.profiles p ON p.id=b.assigned_to
  GROUP BY b.id,p.display_name ORDER BY b.created_at DESC,b.id LIMIT 500) x;
 RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.release_batch(p_batch_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor(); b public.lead_batches%ROWTYPE;
BEGIN
 SELECT * INTO b FROM public.lead_batches WHERE id=p_batch_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'batch_not_found' USING ERRCODE='P0002'; END IF;
 IF NOT (public.has_role(a,'admin') OR b.assigned_to IS NOT DISTINCT FROM a) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 IF b.assigned_to IS NOT NULL THEN
  UPDATE public.lead_batches SET assigned_to=NULL,assigned_at=NULL WHERE id=b.id RETURNING * INTO b;
  INSERT INTO public.audit_events(actor,action,target_id) VALUES(a,'release_batch',b.id);
 END IF;
 RETURN jsonb_build_object('id',b.id,'assigned_to',b.assigned_to,'assigned_at',b.assigned_at);
END $$;

CREATE FUNCTION public.reassign_batch(p_batch_id uuid, p_user_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor(); b public.lead_batches%ROWTYPE;
BEGIN
 IF NOT public.has_role(a,'admin') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO b FROM public.lead_batches WHERE id=p_batch_id AND import_state='confirmed' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'batch_not_found' USING ERRCODE='P0002'; END IF;
 IF NOT (public.has_role(p_user_id,'caller') OR public.has_role(p_user_id,'admin'))
    OR NOT (public.is_master(p_user_id) OR EXISTS(SELECT 1 FROM public.user_countries WHERE user_id=p_user_id AND country=b.country)) THEN
  RAISE EXCEPTION 'invalid_assignee' USING ERRCODE='22023';
 END IF;
 UPDATE public.lead_batches SET assigned_to=p_user_id,assigned_at=now() WHERE id=b.id RETURNING * INTO b;
 INSERT INTO public.audit_events(actor,action,target_id) VALUES(a,'reassign_batch',b.id);
 RETURN jsonb_build_object('id',b.id,'assigned_to',b.assigned_to,'assigned_at',b.assigned_at);
END $$;

REVOKE ALL ON FUNCTION public.get_caller_day(date), public.get_monthly_quality(date), public.get_team_metrics(), public.get_weekly_ranking(date), public.reassign_batch(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_caller_day(date), public.get_monthly_quality(date), public.get_team_metrics(), public.get_weekly_ranking(date), public.reassign_batch(uuid,uuid) TO authenticated;