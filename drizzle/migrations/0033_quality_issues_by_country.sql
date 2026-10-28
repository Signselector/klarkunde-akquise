-- Data quality hints for the dashboard: managers and admins only, and only for leads of the countries they administer.
-- (Before, every signed-in user got the hints of all countries.)
CREATE OR REPLACE FUNCTION public.get_quality_issues(p_limit integer DEFAULT 100, p_offset integer DEFAULT 0) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=app_private.actor(); r jsonb;
BEGIN
 IF NOT public.has_role(a,'admin') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 WITH s AS (
  SELECT l.id,l.phone,l.email,l.status,l.contact_name,b.country AS c
  FROM public.leads l JOIN public.lead_batches b ON b.id=l.batch_id
  WHERE l.archived_at IS NULL AND public.has_admin_rights(a,b.country)
 ), issues AS (
  SELECT id AS lead_id,'missing_phone' AS kind FROM s WHERE app_private.phone(phone) IS NULL
  UNION ALL SELECT id,'invalid_email' FROM s WHERE nullif(btrim(email),'') IS NOT NULL AND email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  UNION ALL SELECT l.id,'possible_duplicate' FROM s l WHERE EXISTS(SELECT 1 FROM s x WHERE x.id<>l.id AND x.c=l.c AND (app_private.phone(x.phone)=app_private.phone(l.phone) OR nullif(lower(btrim(x.email)),'')=nullif(lower(btrim(l.email)),'')))
  UNION ALL SELECT DISTINCT c.lead_id,'overdue_callback' FROM public.callbacks c JOIN s l ON l.id=c.lead_id WHERE NOT c.done AND c.due_at<now()
  UNION ALL SELECT id,'missing_sync_contact' FROM s WHERE status IN ('appointment','production') AND nullif(btrim(contact_name),'') IS NULL
 ) SELECT coalesce(jsonb_agg(to_jsonb(q)),'[]') INTO r FROM (SELECT i.*,coalesce(l.company,l.contact_name,'Ohne Name') AS company,r.reason AS acknowledged_reason FROM issues i JOIN public.leads l ON l.id=i.lead_id LEFT JOIN public.quality_resolutions r USING(lead_id,kind) ORDER BY lead_id,kind LIMIT greatest(1,least(coalesce(p_limit,100),500)) OFFSET greatest(coalesce(p_offset,0),0)) q;
 RETURN r;
END $$;
