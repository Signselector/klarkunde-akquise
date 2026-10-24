CREATE TABLE public.call_requests (
  user_id uuid NOT NULL,
  request_id uuid NOT NULL,
  payload jsonb NOT NULL,
  result jsonb NOT NULL,
  PRIMARY KEY (user_id, request_id)
);
REVOKE ALL ON public.call_requests FROM anon, authenticated;
GRANT ALL ON public.call_requests TO service_role;
ALTER TABLE public.call_requests ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.record_call_outcome(
  p_request_id uuid, p_lead_id uuid, p_expected_attempts integer,
  p_outcome text, p_note text DEFAULT NULL,
  p_scheduled_at timestamptz DEFAULT NULL, p_callback_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor uuid := auth.uid();
  current_lead public.leads%ROWTYPE;
  request_payload jsonb;
  previous public.call_requests%ROWTYPE;
  event_id uuid;
  new_callback uuid;
  new_appointment uuid;
  result jsonb;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  IF NOT (public.has_role(actor, 'caller') OR public.has_role(actor, 'admin')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL OR p_lead_id IS NULL OR p_expected_attempts IS NULL OR p_expected_attempts < 0
     OR p_outcome IS NULL OR p_outcome NOT IN ('not_reached','no_interest','callback','appointment','production') THEN
    RAISE EXCEPTION 'validation_failed' USING ERRCODE = '22023';
  END IF;
  request_payload := jsonb_build_object('lead_id',p_lead_id,'attempts',p_expected_attempts,
    'outcome',p_outcome,'note',p_note,'scheduled_at',p_scheduled_at,'callback_id',p_callback_id);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text || p_request_id::text,0));
  SELECT * INTO previous FROM public.call_requests WHERE user_id=actor AND request_id=p_request_id;
  IF FOUND THEN
    IF previous.payload <> request_payload THEN RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='22023'; END IF;
    RETURN previous.result;
  END IF;
  IF p_outcome IN ('callback','appointment') AND
     (p_scheduled_at IS NULL OR NOT pg_catalog.isfinite(p_scheduled_at) OR p_scheduled_at <= now()) THEN
    RAISE EXCEPTION 'invalid_schedule' USING ERRCODE='22023';
  END IF;
  IF length(coalesce(p_note,'')) > 10000 THEN RAISE EXCEPTION 'note_too_long' USING ERRCODE='22023'; END IF;
  SELECT * INTO current_lead FROM public.leads WHERE id=p_lead_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'lead_not_found' USING ERRCODE='P0002'; END IF;
  IF current_lead.attempts <> p_expected_attempts THEN RAISE EXCEPTION 'stale_lead' USING ERRCODE='40001'; END IF;
  IF p_callback_id IS NOT NULL THEN
    UPDATE public.callbacks SET done=true WHERE id=p_callback_id AND lead_id=p_lead_id AND NOT done
      AND (user_id=actor OR public.has_role(actor,'admin'));
    IF NOT FOUND THEN RAISE EXCEPTION 'callback_conflict' USING ERRCODE='42501'; END IF;
  END IF;
  UPDATE public.leads SET status=CASE WHEN p_outcome='not_reached' THEN 'open' ELSE p_outcome END,
    attempts=attempts+1,last_called_at=now(),last_called_by=actor WHERE id=p_lead_id;
  INSERT INTO public.status_changes(lead_id,user_id,old_status,new_status)
    VALUES(p_lead_id,actor,current_lead.status,p_outcome) RETURNING id INTO event_id;
  IF nullif(btrim(p_note),'') IS NOT NULL THEN
    INSERT INTO public.lead_notes(lead_id,user_id,body) VALUES(p_lead_id,actor,btrim(p_note));
  END IF;
  IF p_outcome='callback' THEN
    INSERT INTO public.callbacks(lead_id,user_id,due_at) VALUES(p_lead_id,actor,p_scheduled_at) RETURNING id INTO new_callback;
  ELSIF p_outcome='appointment' THEN
    INSERT INTO public.appointments(lead_id,user_id,starts_at,notes)
      VALUES(p_lead_id,actor,p_scheduled_at,nullif(btrim(p_note),'')) RETURNING id INTO new_appointment;
  END IF;
  result := jsonb_build_object('lead_id',p_lead_id,'status',CASE WHEN p_outcome='not_reached' THEN 'open' ELSE p_outcome END,
    'attempts',current_lead.attempts+1,'status_change_id',event_id,'callback_id',new_callback,'appointment_id',new_appointment);
  INSERT INTO public.call_requests VALUES(actor,p_request_id,request_payload,result);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.record_call_outcome(uuid,uuid,integer,text,text,timestamptz,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_call_outcome(uuid,uuid,integer,text,text,timestamptz,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_user_role(p_user_id uuid, p_role public.app_role)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(71923101);
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  IF p_role IS NULL THEN RAISE EXCEPTION 'invalid_role' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM auth.users WHERE id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'user_not_found' USING ERRCODE='P0002'; END IF;
  IF p_role <> 'admin' AND public.has_role(p_user_id,'admin') AND
    NOT EXISTS(SELECT 1 FROM public.user_roles WHERE role='admin' AND user_id<>p_user_id) THEN
    RAISE EXCEPTION 'last_admin' USING ERRCODE='23514';
  END IF;
  DELETE FROM public.user_roles WHERE user_id=p_user_id;
  INSERT INTO public.user_roles(user_id,role) VALUES(p_user_id,p_role);
END $$;
REVOKE ALL ON FUNCTION public.set_user_role(uuid,public.app_role) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_user_role(uuid,public.app_role) TO authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.user_roles FROM authenticated;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  INSERT INTO public.profiles(id,email,display_name)
    VALUES(NEW.id,NEW.email,coalesce(NEW.raw_user_meta_data->>'display_name',split_part(NEW.email,'@',1)));
  INSERT INTO public.user_roles(user_id,role) VALUES(NEW.id,'caller');
  RETURN NEW;
END $$;