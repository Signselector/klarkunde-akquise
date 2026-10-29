ALTER TABLE public.appointments ADD COLUMN decision_pending boolean NOT NULL DEFAULT false;
CREATE INDEX appointments_decision_idx ON public.appointments(country,starts_at) WHERE decision_pending;
CREATE FUNCTION app_private.trg_appointment_decision() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.booked_by IS NOT NULL AND NEW.user_id IS DISTINCT FROM NEW.booked_by AND public.user_role(NEW.booked_by) IN ('recruit','veteran') THEN NEW.decision_pending:=true; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.trg_appointment_decision() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER appointment_decision BEFORE INSERT ON public.appointments FOR EACH ROW EXECUTE FUNCTION app_private.trg_appointment_decision();
DO $$ DECLARE d text; o text;
BEGIN
 d:=pg_get_functiondef('public.assign_appointment(uuid,uuid)'::regprocedure); o:=d;
 d:=replace(d,'UPDATE public.appointments SET user_id=p_user_id','UPDATE public.appointments SET decision_pending=false, user_id=p_user_id');
 IF d=o THEN RAISE EXCEPTION 'patch did not apply'; END IF;
 EXECUTE d;
END $$;
CREATE FUNCTION public.reschedule_appointment(p_appointment_id uuid, p_starts_at timestamptz) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=auth.uid(); ap public.appointments%ROWTYPE;
BEGIN
 IF a IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO ap FROM public.appointments WHERE id=p_appointment_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
 IF NOT (ap.user_id IS NOT DISTINCT FROM a OR public.has_admin_rights(a,ap.country)) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 IF p_starts_at IS NULL OR NOT pg_catalog.isfinite(p_starts_at) OR p_starts_at<=now() THEN RAISE EXCEPTION 'invalid_schedule' USING ERRCODE='22023'; END IF;
 IF p_starts_at < (date_trunc('day',now() AT TIME ZONE 'Europe/Vienna')+interval '3 days') AT TIME ZONE 'Europe/Vienna' THEN RAISE EXCEPTION 'appointment_too_soon' USING ERRCODE='22023'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('appt:'||ap.country,0));
 UPDATE public.appointments SET starts_at=p_starts_at,pd_sync_state='pending',pd_sync_error=NULL WHERE id=ap.id;
 IF app_private.appointment_load(ap.country,p_starts_at,p_starts_at+interval '30 minutes')-1>=(CASE WHEN ap.country='DE' THEN 1 ELSE 2 END) THEN RAISE EXCEPTION 'slot_full' USING ERRCODE='23505'; END IF;
 IF ap.user_id IS NOT NULL AND (
 EXISTS(SELECT 1 FROM public.callbacks c WHERE c.user_id=ap.user_id AND NOT c.done AND c.due_at<p_starts_at+interval '30 minutes' AND c.due_at+interval '15 minutes'>p_starts_at)
 OR EXISTS(SELECT 1 FROM public.appointments x WHERE x.user_id=ap.user_id AND x.id<>ap.id AND x.starts_at<p_starts_at+interval '30 minutes' AND x.starts_at+interval '30 minutes'>p_starts_at)
 OR EXISTS(SELECT 1 FROM public.pipedrive_activities p WHERE p.user_id=ap.user_id AND NOT p.done AND p.country=ap.country AND p.activity_id IS DISTINCT FROM ap.pd_activity_id AND p.due_at<p_starts_at+interval '30 minutes' AND p.due_at+make_interval(mins=>greatest(p.duration_min,15))>p_starts_at)) THEN RAISE EXCEPTION 'slot_conflict' USING ERRCODE='23505'; END IF;
 INSERT INTO public.audit_events(actor,action,target_id) VALUES(a,'appointment_rescheduled',ap.id);
 RETURN jsonb_build_object('id',ap.id,'user_id',ap.user_id,'country',ap.country,'pd_activity_id',ap.pd_activity_id,'starts_at',p_starts_at);
END $$;
REVOKE ALL ON FUNCTION public.reschedule_appointment(uuid,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reschedule_appointment(uuid,timestamptz) TO authenticated;