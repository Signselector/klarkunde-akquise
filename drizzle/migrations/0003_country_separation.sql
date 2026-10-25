ALTER TABLE public.lead_batches ADD COLUMN country text NOT NULL DEFAULT 'DE';
ALTER TABLE public.lead_batches ADD CONSTRAINT lead_batches_country_chk CHECK (country IN ('DE','AT','NL'));
CREATE INDEX lead_batches_country_idx ON public.lead_batches(country);

CREATE FUNCTION public.claim_next_lead(p_country text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor(); l public.leads%ROWTYPE; c public.lead_claims%ROWTYPE; cb uuid;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('claim:'||a::text,0));
 SELECT x.* INTO c FROM public.lead_claims x JOIN public.leads y ON y.id=x.lead_id JOIN public.lead_batches bt ON bt.id=y.batch_id
  WHERE x.user_id=a AND x.expires_at>now() AND y.archived_at IS NULL AND bt.country=p_country LIMIT 1;
 IF FOUND THEN SELECT * INTO l FROM public.leads WHERE id=c.lead_id;
 ELSE
  SELECT x.* INTO l FROM public.leads x JOIN public.lead_batches bt ON bt.id=x.batch_id
   WHERE x.archived_at IS NULL AND bt.country=p_country AND
   (x.status='open' OR EXISTS(SELECT 1 FROM public.callbacks b WHERE b.lead_id=x.id AND b.user_id=a AND NOT b.done AND b.due_at<=now()))
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
REVOKE ALL ON FUNCTION public.claim_next_lead(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.claim_next_lead(text) TO authenticated;