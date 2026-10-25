-- One caller per lead batch: a caller takes a batch, an admin can release it again.
ALTER TABLE public.lead_batches
  ADD COLUMN assigned_to uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN assigned_at timestamptz;
CREATE INDEX lead_batches_assigned_idx ON public.lead_batches(assigned_to);

CREATE FUNCTION public.claim_batch(p_batch_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor(); b public.lead_batches%ROWTYPE;
BEGIN
 SELECT * INTO b FROM public.lead_batches WHERE id=p_batch_id FOR UPDATE;
 IF NOT FOUND OR b.import_state<>'confirmed' THEN RAISE EXCEPTION 'batch_not_found' USING ERRCODE='P0002'; END IF;
 IF NOT public.can_access_country(b.country) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 IF b.assigned_to IS NOT NULL AND b.assigned_to<>a THEN RAISE EXCEPTION 'batch_taken' USING ERRCODE='40001'; END IF;
 IF b.assigned_to IS NULL THEN
  UPDATE public.lead_batches SET assigned_to=a,assigned_at=now() WHERE id=b.id RETURNING * INTO b;
  INSERT INTO public.audit_events(actor,action,target_id) VALUES(a,'claim_batch',b.id);
 END IF;
 RETURN jsonb_build_object('id',b.id,'assigned_to',b.assigned_to,'assigned_at',b.assigned_at);
END $$;

CREATE FUNCTION public.release_batch(p_batch_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor(); b public.lead_batches%ROWTYPE;
BEGIN
 IF NOT public.has_role(a,'admin') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 SELECT * INTO b FROM public.lead_batches WHERE id=p_batch_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'batch_not_found' USING ERRCODE='P0002'; END IF;
 IF b.assigned_to IS NOT NULL THEN
  UPDATE public.lead_batches SET assigned_to=NULL,assigned_at=NULL WHERE id=b.id RETURNING * INTO b;
  INSERT INTO public.audit_events(actor,action,target_id) VALUES(a,'release_batch',b.id);
 END IF;
 RETURN jsonb_build_object('id',b.id,'assigned_to',b.assigned_to,'assigned_at',b.assigned_at);
END $$;

-- Open leads are only handed out from batches the caller has taken. Own due callbacks stay reachable.
CREATE OR REPLACE FUNCTION public.claim_next_lead(p_country text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor(); l public.leads%ROWTYPE; c public.lead_claims%ROWTYPE; cb uuid;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('claim:'||a::text,0));
 SELECT x.* INTO c FROM public.lead_claims x JOIN public.leads y ON y.id=x.lead_id JOIN public.lead_batches bt ON bt.id=y.batch_id
  WHERE x.user_id=a AND x.expires_at>now() AND y.archived_at IS NULL AND bt.country=p_country LIMIT 1;
 IF FOUND THEN SELECT * INTO l FROM public.leads WHERE id=c.lead_id;
 ELSE
  SELECT x.* INTO l FROM public.leads x JOIN public.lead_batches bt ON bt.id=x.batch_id
   WHERE x.archived_at IS NULL AND bt.country=p_country AND
   ((x.status='open' AND bt.assigned_to=a) OR EXISTS(SELECT 1 FROM public.callbacks b WHERE b.lead_id=x.id AND b.user_id=a AND NOT b.done AND b.due_at<=now()))
   AND NOT EXISTS(SELECT 1 FROM public.lead_claims q WHERE q.lead_id=x.id AND q.expires_at>now())
   ORDER BY (SELECT min(b.due_at) FROM public.callbacks b WHERE b.lead_id=x.id AND b.user_id=a AND NOT b.done AND b.due_at<=now()) NULLS LAST,x.last_called_at NULLS FIRST,x.created_at,x.id
   LIMIT 1 FOR UPDATE OF x SKIP LOCKED;
  IF NOT FOUND THEN RETURN NULL; END IF;
  INSERT INTO public.lead_claims(lead_id,user_id,expires_at) VALUES(l.id,a,now()+interval '10 minutes')
   ON CONFLICT(lead_id) DO UPDATE SET id=gen_random_uuid(),user_id=a,expires_at=now()+interval '10 minutes' WHERE public.lead_claims.expires_at<=now() RETURNING * INTO c;
  IF NOT FOUND THEN RETURN NULL; END IF;
 END IF;
 SELECT id INTO cb FROM public.callbacks WHERE lead_id=l.id AND user_id=a AND NOT done AND due_at<=now() ORDER BY due_at,id LIMIT 1;
 RETURN jsonb_build_object('lead',to_jsonb(l),'claim_id',c.id,'expires_at',c.expires_at,'callback_id',cb);
END $$;

-- Same list as before plus who holds each batch and how many leads are still open.
CREATE OR REPLACE FUNCTION public.get_batch_progress() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor(); r jsonb;
BEGIN
 SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') INTO r FROM (
  SELECT b.id,b.name,b.import_state,b.created_at,b.assigned_to,b.assigned_at,p.display_name assigned_name,
   count(l.id)::int total,
   count(l.id) FILTER(WHERE l.status<>'open' OR l.archived_at IS NOT NULL)::int completed,
   count(l.id) FILTER(WHERE l.status='open' AND l.archived_at IS NULL)::int open
  FROM public.lead_batches b LEFT JOIN public.leads l ON l.batch_id=b.id LEFT JOIN public.profiles p ON p.id=b.assigned_to
  GROUP BY b.id,p.display_name ORDER BY b.created_at DESC,b.id LIMIT 500) x;
 RETURN r;
END $$;

REVOKE ALL ON FUNCTION public.claim_batch(uuid), public.release_batch(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_batch(uuid), public.release_batch(uuid) TO authenticated;
