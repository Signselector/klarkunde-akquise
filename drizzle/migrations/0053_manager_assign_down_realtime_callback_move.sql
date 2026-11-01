CREATE OR REPLACE FUNCTION public.reassign_batch(p_batch_id uuid, p_user_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE a uuid:=app_private.actor(); b public.lead_batches%ROWTYPE;
BEGIN
 SELECT * INTO b FROM public.lead_batches WHERE id=p_batch_id AND import_state='confirmed' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'batch_not_found' USING ERRCODE='P0002'; END IF;
 IF NOT public.has_admin_rights(a,b.country) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 IF NOT (public.has_role(p_user_id,'caller') OR public.has_role(p_user_id,'admin'))
    OR NOT EXISTS(SELECT 1 FROM public.user_countries WHERE user_id=p_user_id AND country=b.country) THEN
  RAISE EXCEPTION 'invalid_assignee' USING ERRCODE='22023';
 END IF;
 -- Managers may only hand batches to roles below them (senior caller, caller).
 IF NOT public.is_global_admin(a) AND NOT app_private.is_caller_role(p_user_id) THEN
  RAISE EXCEPTION 'invalid_assignee' USING ERRCODE='22023';
 END IF;
 UPDATE public.lead_batches SET assigned_to=p_user_id,assigned_at=now() WHERE id=b.id RETURNING * INTO b;
 INSERT INTO public.audit_events(actor,action,target_id) VALUES(a,'reassign_batch',b.id);
 RETURN jsonb_build_object('id',b.id,'assigned_to',b.assigned_to,'assigned_at',b.assigned_at);
END $function$;

CREATE OR REPLACE FUNCTION public.reschedule_callback(p_callback_id uuid, p_due_at timestamptz)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE a uuid:=auth.uid(); r uuid;
BEGIN
 IF a IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
 IF p_due_at IS NULL OR p_due_at < now() - interval '1 minute' THEN RAISE EXCEPTION 'invalid_schedule'; END IF;
 UPDATE public.callbacks SET due_at=p_due_at WHERE id=p_callback_id AND user_id=a AND NOT done RETURNING id INTO r;
 IF r IS NULL THEN RAISE EXCEPTION 'callback_not_found'; END IF;
 RETURN r;
END $function$;
REVOKE ALL ON FUNCTION public.reschedule_callback(uuid,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reschedule_callback(uuid,timestamptz) TO authenticated;

ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS pd_push_claimed_at timestamptz;

CREATE OR REPLACE FUNCTION public.cal_claim_appointments(p_ids uuid[])
 RETURNS SETOF uuid LANGUAGE sql SECURITY DEFINER SET search_path TO ''
AS $function$
 UPDATE public.appointments SET pd_push_claimed_at=now()
 WHERE id=ANY(p_ids) AND (pd_push_claimed_at IS NULL OR pd_push_claimed_at < now()-interval '2 minutes')
 RETURNING id
$function$;
REVOKE ALL ON FUNCTION public.cal_claim_appointments(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cal_claim_appointments(uuid[]) TO service_role;

DO $$ BEGIN
 BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.appointment_notifications; EXCEPTION WHEN duplicate_object THEN NULL; END;
 BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.appointments; EXCEPTION WHEN duplicate_object THEN NULL; END;
 BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.callbacks; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;