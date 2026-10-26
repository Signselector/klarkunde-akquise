CREATE TABLE public.pipedrive_user_map (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  country text NOT NULL CHECK (country IN ('DE','AT','NL')),
  pipedrive_user_id bigint NOT NULL,
  matched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, country)
);
GRANT SELECT ON public.pipedrive_user_map TO authenticated;
GRANT ALL ON public.pipedrive_user_map TO service_role;
ALTER TABLE public.pipedrive_user_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY pum_own ON public.pipedrive_user_map FOR SELECT TO authenticated USING (user_id = auth.uid());

ALTER TABLE public.callbacks
  ADD COLUMN pd_activity_id bigint,
  ADD COLUMN pd_sync_state text NOT NULL DEFAULT 'pending' CHECK (pd_sync_state IN ('pending','synced','failed')),
  ADD COLUMN pd_sync_error text,
  ADD COLUMN pd_synced_at timestamptz;
ALTER TABLE public.appointments
  ADD COLUMN pd_activity_id bigint,
  ADD COLUMN pd_sync_state text NOT NULL DEFAULT 'pending' CHECK (pd_sync_state IN ('pending','synced','failed')),
  ADD COLUMN pd_sync_error text,
  ADD COLUMN pd_synced_at timestamptz;
UPDATE public.callbacks SET pd_sync_state='synced' WHERE pd_activity_id IS NULL;
UPDATE public.appointments SET pd_sync_state='synced' WHERE pd_activity_id IS NULL;
CREATE UNIQUE INDEX callbacks_pd_activity_unique ON public.callbacks(country,pd_activity_id) WHERE pd_activity_id IS NOT NULL;
CREATE UNIQUE INDEX appointments_pd_activity_unique ON public.appointments(country,pd_activity_id) WHERE pd_activity_id IS NOT NULL;

CREATE TABLE public.pipedrive_activities (
  country text NOT NULL CHECK (country IN ('DE','AT','NL')),
  activity_id bigint NOT NULL,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  subject text,
  type text,
  due_at timestamptz NOT NULL,
  duration_min integer NOT NULL DEFAULT 30,
  done boolean NOT NULL DEFAULT false,
  deal_id bigint,
  person_name text,
  org_name text,
  note text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (country, activity_id)
);
CREATE INDEX pipedrive_activities_user_idx ON public.pipedrive_activities(user_id, due_at);
GRANT SELECT ON public.pipedrive_activities TO authenticated;
GRANT ALL ON public.pipedrive_activities TO service_role;
ALTER TABLE public.pipedrive_activities ENABLE ROW LEVEL SECURITY;
CREATE POLICY pa_own ON public.pipedrive_activities FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE TABLE public.pd_calendar_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country text NOT NULL,
  user_id uuid,
  activity_id bigint NOT NULL,
  action text NOT NULL CHECK (action IN ('delete','done')),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.pd_calendar_queue TO service_role;
ALTER TABLE public.pd_calendar_queue ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION app_private.trg_appointment_deleted() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF OLD.pd_activity_id IS NOT NULL THEN
  INSERT INTO public.pd_calendar_queue(country,user_id,activity_id,action) VALUES(OLD.country,OLD.user_id,OLD.pd_activity_id,'delete');
 END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER appointment_deleted BEFORE DELETE ON public.appointments FOR EACH ROW EXECUTE FUNCTION app_private.trg_appointment_deleted();
CREATE FUNCTION app_private.trg_callback_done() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.done AND NOT OLD.done AND NEW.pd_activity_id IS NOT NULL AND NEW.pd_sync_state IS DISTINCT FROM 'failed' THEN
  IF NEW.pd_synced_at IS NOT DISTINCT FROM OLD.pd_synced_at THEN
   INSERT INTO public.pd_calendar_queue(country,user_id,activity_id,action) VALUES(NEW.country,NEW.user_id,NEW.pd_activity_id,'done');
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER callback_done AFTER UPDATE OF done ON public.callbacks FOR EACH ROW EXECUTE FUNCTION app_private.trg_callback_done();

DROP POLICY IF EXISTS "cb read" ON public.callbacks;
CREATE POLICY "cb read" ON public.callbacks FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "ap read" ON public.appointments;
CREATE POLICY "ap read" ON public.appointments FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE FUNCTION public.cal_apply_activity(p_country text, p_user uuid, p_a jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id bigint:=(p_a->>'id')::bigint; v_due timestamptz:=(p_a->>'due_at')::timestamptz; v_done boolean:=coalesce((p_a->>'done')::boolean,false); n integer;
BEGIN
 UPDATE public.callbacks c SET
   due_at=CASE WHEN NOT c.done AND NOT v_done THEN v_due ELSE c.due_at END,
   done=c.done OR v_done, pd_sync_state='synced', pd_synced_at=now(), pd_sync_error=NULL
  WHERE c.country=p_country AND c.pd_activity_id=v_id AND c.user_id=p_user;
 GET DIAGNOSTICS n=ROW_COUNT; IF n>0 THEN RETURN 'callback'; END IF;
 UPDATE public.appointments ap SET starts_at=v_due, pd_sync_state='synced', pd_synced_at=now(), pd_sync_error=NULL
  WHERE ap.country=p_country AND ap.pd_activity_id=v_id AND ap.user_id=p_user;
 GET DIAGNOSTICS n=ROW_COUNT; IF n>0 THEN RETURN 'appointment'; END IF;
 INSERT INTO public.pipedrive_activities(country,activity_id,user_id,subject,type,due_at,duration_min,done,deal_id,person_name,org_name,note,updated_at)
  VALUES(p_country,v_id,p_user,left(p_a->>'subject',300),p_a->>'type',v_due,coalesce((p_a->>'duration_min')::int,30),v_done,
   (p_a->>'deal_id')::bigint,left(p_a->>'person_name',200),left(p_a->>'org_name',200),left(p_a->>'note',2000),now())
  ON CONFLICT (country,activity_id) DO UPDATE SET user_id=EXCLUDED.user_id,subject=EXCLUDED.subject,type=EXCLUDED.type,due_at=EXCLUDED.due_at,
   duration_min=EXCLUDED.duration_min,done=EXCLUDED.done,deal_id=EXCLUDED.deal_id,person_name=EXCLUDED.person_name,org_name=EXCLUDED.org_name,
   note=EXCLUDED.note,updated_at=now();
 RETURN 'external';
END $$;
CREATE FUNCTION public.cal_prune(p_country text, p_user uuid, p_from timestamptz, p_to timestamptz, p_keep bigint[]) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n integer;
BEGIN
 DELETE FROM public.pipedrive_activities WHERE country=p_country AND user_id=p_user AND due_at>=p_from AND due_at<p_to AND NOT (activity_id=ANY(coalesce(p_keep,'{}')));
 GET DIAGNOSTICS n=ROW_COUNT; RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.cal_apply_activity(text,uuid,jsonb),public.cal_prune(text,uuid,timestamptz,timestamptz,bigint[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cal_apply_activity(text,uuid,jsonb),public.cal_prune(text,uuid,timestamptz,timestamptz,bigint[]) TO service_role;