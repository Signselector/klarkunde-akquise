-- Showroom results of an appointment: no show, little / medium / very interested, delete, move.
-- Every result needs a note; the note, the deal stage and the follow-ups are also sent to Pipedrive by the server.
ALTER TABLE public.leads DROP CONSTRAINT lead_status_valid;
ALTER TABLE public.leads ADD CONSTRAINT lead_status_valid
  CHECK (status IN ('open','callback','appointment','production','no_interest','in_progress','on_hold','waiting_3d','low_q','high_q','reference_mail','contact_saved','appointment_missed'));

ALTER TABLE public.appointments ADD COLUMN outcome text
  CHECK (outcome IS NULL OR outcome IN ('no_show','low_interest','medium_interest','high_interest'));

CREATE TABLE public.appointment_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  country text NOT NULL,
  user_id uuid NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('no_show','low_interest','medium_interest','high_interest','deleted','rescheduled')),
  note text NOT NULL,
  stage_key text,
  starts_at timestamptz,
  new_starts_at timestamptz,
  followup_appointment_id uuid,
  pd_state text NOT NULL DEFAULT 'pending' CHECK (pd_state IN ('pending','synced','simulated','error','no_deal')),
  pd_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX appointment_outcomes_lead_idx ON public.appointment_outcomes(lead_id, created_at DESC);
GRANT SELECT ON public.appointment_outcomes TO authenticated;
GRANT ALL ON public.appointment_outcomes TO service_role;
ALTER TABLE public.appointment_outcomes ENABLE ROW LEVEL SECURITY;
CREATE POLICY appointment_outcomes_read ON public.appointment_outcomes FOR SELECT TO authenticated
  USING (user_id=auth.uid() OR public.has_admin_rights(auth.uid(),country));

CREATE FUNCTION public.record_appointment_outcome(
  p_appointment_id uuid, p_outcome text, p_note text,
  p_new_start timestamptz DEFAULT NULL, p_followup_at timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 a uuid:=auth.uid();
 note text:=nullif(btrim(p_note),'');
 ap public.appointments%ROWTYPE;
 l public.leads%ROWTYPE;
 k public.lead_crm_links%ROWTYPE;
 stage text;
 origin uuid;
 fu uuid;
 oid uuid;
 owner_id uuid;
 due timestamptz:=date_trunc('minute',now());
 n integer:=0;
 label text;
BEGIN
 IF a IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 IF p_outcome IS NULL OR p_outcome NOT IN ('no_show','low_interest','medium_interest','high_interest','deleted','rescheduled') THEN
  RAISE EXCEPTION 'validation_failed' USING ERRCODE='22023';
 END IF;
 IF note IS NULL THEN RAISE EXCEPTION 'note_required' USING ERRCODE='22023'; END IF;
 IF length(note)>10000 THEN RAISE EXCEPTION 'note_too_long' USING ERRCODE='22023'; END IF;
 SELECT * INTO ap FROM public.appointments WHERE id=p_appointment_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
 IF NOT (ap.user_id IS NOT DISTINCT FROM a OR public.has_admin_rights(a,ap.country)) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 IF ap.outcome IS NOT NULL THEN RAISE EXCEPTION 'already_decided' USING ERRCODE='22023'; END IF;
 owner_id:=ap.user_id;
 IF ap.lead_id IS NOT NULL THEN
  SELECT * INTO l FROM public.leads WHERE id=ap.lead_id FOR UPDATE;
  SELECT * INTO k FROM public.lead_crm_links WHERE lead_id=ap.lead_id;
 END IF;
 stage:=CASE p_outcome WHEN 'no_show' THEN 'no_show' WHEN 'low_interest' THEN 'low_chance'
   WHEN 'medium_interest' THEN 'maybe_interested' WHEN 'high_interest' THEN 'very_interested' END;
 label:=CASE p_outcome WHEN 'no_show' THEN 'Termin nicht wahrgenommen' WHEN 'low_interest' THEN 'Wenig interessiert'
   WHEN 'medium_interest' THEN 'Mittleres Interesse' WHEN 'high_interest' THEN 'Sehr interessiert'
   WHEN 'deleted' THEN 'Termin gelöscht' ELSE 'Termin verschoben' END;
 IF stage IS NOT NULL AND ap.lead_id IS NULL THEN RAISE EXCEPTION 'lead_required' USING ERRCODE='22023'; END IF;

 IF p_outcome='rescheduled' THEN
  IF p_new_start IS NULL THEN RAISE EXCEPTION 'appointment_required' USING ERRCODE='22023'; END IF;
  PERFORM public.reschedule_appointment(ap.id,p_new_start);
 ELSIF p_outcome='deleted' THEN
  DELETE FROM public.appointments WHERE id=ap.id;
  INSERT INTO public.audit_events(actor,action,target_id) VALUES(a,'delete_appointment',ap.id);
 ELSE
  UPDATE public.appointments SET outcome=p_outcome WHERE id=ap.id;
  IF p_outcome='no_show' THEN
   -- The lead goes back to the caller who found it, with a callback right now, so that he can call again.
   origin:=coalesce(k.origin_caller_id,l.last_called_by,ap.booked_by);
   IF origin IS NOT NULL THEN
    UPDATE public.leads SET status='appointment_missed',last_called_by=origin WHERE id=l.id;
    INSERT INTO public.status_changes(lead_id,user_id,old_status,new_status) VALUES(l.id,origin,l.status,'appointment_missed');
    UPDATE public.callbacks SET done=true WHERE lead_id=l.id AND NOT done;
    WHILE n<240 AND EXISTS(SELECT 1 FROM public.callbacks c WHERE c.user_id=origin AND NOT c.done
      AND floor(extract(epoch FROM c.due_at)/60)=floor(extract(epoch FROM due)/60)) LOOP
     due:=due-interval '1 minute'; n:=n+1;
    END LOOP;
    INSERT INTO public.callbacks(lead_id,user_id,due_at,country) VALUES(l.id,origin,due,ap.country);
   END IF;
  ELSIF p_followup_at IS NOT NULL THEN
   -- Follow-up appointment: the usual booking rules apply (slots, three days ahead); it shows up again at the manager.
   INSERT INTO public.appointments(user_id,lead_id,starts_at,notes,title,kind,country,booked_by)
    VALUES(app_private.appointment_owner(a,ap.country,false),ap.lead_id,p_followup_at,note,
           'Folgetermin: '||coalesce(l.company,'Lead'),'presentation',ap.country,a)
    RETURNING id INTO fu;
  END IF;
  IF k.lead_id IS NOT NULL AND stage IS NOT NULL THEN
   UPDATE public.lead_crm_links SET current_stage_key=stage,stage_event_at=now(),updated_at=now() WHERE lead_id=k.lead_id;
   PERFORM app_private.log_activity(l.id,'stage_change',a,'cold_caller',k.current_stage_key,stage,k.deal_id,NULL,
     jsonb_build_object('appointment_id',ap.id,'outcome',p_outcome),now());
  END IF;
 END IF;

 IF ap.lead_id IS NOT NULL THEN
  INSERT INTO public.lead_notes(lead_id,user_id,body) VALUES(ap.lead_id,a,label||': '||note);
  PERFORM app_private.log_activity(ap.lead_id,'showroom_result',a,'cold_caller',NULL,stage,k.deal_id,NULL,
    jsonb_build_object('outcome',p_outcome,'appointment_id',ap.id),now());
 END IF;
 INSERT INTO public.appointment_outcomes(appointment_id,lead_id,country,user_id,outcome,note,stage_key,starts_at,new_starts_at,followup_appointment_id,pd_state)
  VALUES(CASE WHEN p_outcome='deleted' THEN NULL ELSE ap.id END,ap.lead_id,ap.country,a,p_outcome,note,stage,ap.starts_at,p_new_start,fu,
         CASE WHEN k.deal_id IS NULL THEN 'no_deal' ELSE 'pending' END)
  RETURNING id INTO oid;
 INSERT INTO public.audit_events(actor,action,target_id) VALUES(a,'appointment_'||p_outcome,ap.id);
 RETURN jsonb_build_object('outcome_id',oid,'outcome',p_outcome,'lead_id',ap.lead_id,'deal_id',k.deal_id,'country',ap.country,
   'stage_key',CASE WHEN k.deal_id IS NULL THEN NULL ELSE stage END,'owner_id',owner_id,'followup_id',fu,'label',label,
   'company',l.company,'actor_id',a);
END $$;
REVOKE ALL ON FUNCTION public.record_appointment_outcome(uuid,text,text,timestamptz,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_appointment_outcome(uuid,text,text,timestamptz,timestamptz) TO authenticated;

-- A lead with a missed appointment is open work again, not a completed lead.
DO $$ DECLARE d text; o text;
BEGIN
 d:=pg_get_functiondef('public.get_completed_overview(text,integer)'::regprocedure); o:=d;
 d:=replace(d,'AND l.status NOT IN (''open'',''callback'')','AND l.status NOT IN (''open'',''callback'',''appointment_missed'')');
 IF d=o THEN RAISE EXCEPTION 'patch did not apply'; END IF;
 EXECUTE d;
END $$;