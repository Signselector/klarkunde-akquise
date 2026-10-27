-- Follow-ups to 0023/0024:
--  * callbacks are not sent to Pipedrive (no queue entries, nothing pending)
--  * a reply to a reference mail always reaches the original caller (skips the slot check)
--  * handing an appointment to someone re-queues it, so the Pipedrive activity moves to the new person's calendar
--  * appointments and their notifications are pushed live to the open pages (Supabase Realtime)

UPDATE public.callbacks SET pd_sync_state='synced' WHERE pd_sync_state IN ('pending','failed');
CREATE OR REPLACE FUNCTION app_private.trg_callback_done() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app_private.apply_reference_reply(_email uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.lead_emails%ROWTYPE; l public.leads%ROWTYPE; bt public.lead_batches%ROWTYPE; origin uuid; due timestamptz:=date_trunc('minute',now()); n integer:=0;
BEGIN
 SELECT * INTO e FROM public.lead_emails WHERE id=_email FOR UPDATE;
 IF NOT FOUND OR e.replied_at IS NOT NULL THEN RETURN jsonb_build_object('matched',false); END IF;
 SELECT * INTO l FROM public.leads WHERE id=e.lead_id AND archived_at IS NULL AND status='reference_mail' FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('matched',false); END IF;
 SELECT * INTO bt FROM public.lead_batches WHERE id=l.batch_id;
 origin:=coalesce((SELECT k.origin_caller_id FROM public.lead_crm_links k WHERE k.lead_id=l.id), e.created_by);
 UPDATE public.lead_emails SET replied_at=now() WHERE id=e.id;
 UPDATE public.leads SET status='callback',last_called_by=origin WHERE id=l.id;
 INSERT INTO public.status_changes(lead_id,user_id,old_status,new_status) VALUES(l.id,origin,l.status,'callback');
 UPDATE public.callbacks SET done=true WHERE lead_id=l.id AND NOT done;
 PERFORM set_config('app.skip_slot_check','1',true);
 WHILE n<240 AND EXISTS(SELECT 1 FROM public.callbacks c WHERE c.user_id=origin AND NOT c.done
   AND floor(extract(epoch FROM c.due_at)/60)=floor(extract(epoch FROM due)/60)) LOOP
  due:=due-interval '1 minute'; n:=n+1;
 END LOOP;
 INSERT INTO public.callbacks(lead_id,user_id,due_at,country) VALUES(l.id,origin,due,bt.country);
 PERFORM app_private.log_activity(l.id,'reference_reply',origin,'cold_caller',NULL,NULL,NULL,'reply:'||e.id,
  jsonb_build_object('email_id',e.id),now());
 INSERT INTO public.audit_events(actor,action,target_id) VALUES(origin,'reference_mail_reply',l.id);
 RETURN jsonb_build_object('matched',true,'lead_id',l.id,'assigned_to',origin);
END $$;

CREATE OR REPLACE FUNCTION public.assign_appointment(p_appointment_id uuid, p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a uuid := auth.uid(); c text;
BEGIN
  SELECT country INTO c FROM public.appointments WHERE id=p_appointment_id;
  IF c IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF a IS NULL OR NOT public.has_admin_rights(a,c) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=p_user_id AND p.active)
     OR (public.user_role(p_user_id)<>'admin' AND NOT EXISTS(SELECT 1 FROM public.user_countries WHERE user_id=p_user_id AND country=c)) THEN
    RAISE EXCEPTION 'invalid_assignee' USING ERRCODE='22023';
  END IF;
  UPDATE public.appointments SET user_id=p_user_id,
    pd_sync_state=CASE WHEN user_id IS DISTINCT FROM p_user_id THEN 'pending' ELSE pd_sync_state END
   WHERE id=p_appointment_id;
END $$;

ALTER TABLE public.appointments REPLICA IDENTITY FULL;
DO $rt$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.appointments; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.appointment_notifications; EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $rt$;
