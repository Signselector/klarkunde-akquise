CREATE INDEX IF NOT EXISTS leads_email_nonempty ON public.leads (lower(btrim(email))) WHERE nullif(lower(btrim(email)),'') IS NOT NULL;

CREATE OR REPLACE FUNCTION public.import_duplicates(p_batch_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE a uuid:=app_private.actor(); r jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.lead_batches WHERE id=p_batch_id AND (created_by=a OR public.has_role(a,'admin'))) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 WITH x AS (
   SELECT row_no, app_private.phone(data->>'phone') ph, nullif(lower(btrim(data->>'email')),'') em
   FROM public.import_rows WHERE batch_id=p_batch_id
 ), w AS (
   SELECT row_no, ph, em,
     CASE WHEN ph IS NULL THEN 1 ELSE row_number() OVER (PARTITION BY ph ORDER BY row_no) END rp,
     CASE WHEN em IS NULL THEN 1 ELSE row_number() OVER (PARTITION BY em ORDER BY row_no) END re
   FROM x
 )
 SELECT coalesce(jsonb_agg(row_no ORDER BY row_no),'[]') INTO r FROM w
 WHERE rp>1 OR re>1
   OR (ph IS NOT NULL AND EXISTS(SELECT 1 FROM public.leads l WHERE app_private.phone(l.phone)=w.ph))
   OR (em IS NOT NULL AND EXISTS(SELECT 1 FROM public.leads l WHERE lower(btrim(l.email))=w.em));
 RETURN r;
END $function$;