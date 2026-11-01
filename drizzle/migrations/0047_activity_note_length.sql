-- Pipedrive notes of calendar entries can be long (HTML); keep up to 20000 characters instead of 2000.
CREATE OR REPLACE FUNCTION public.cal_apply_activity(p_country text, p_user uuid, p_a jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
   (p_a->>'deal_id')::bigint,left(p_a->>'person_name',200),left(p_a->>'org_name',200),left(p_a->>'note',20000),now())
  ON CONFLICT (country,activity_id) DO UPDATE SET user_id=EXCLUDED.user_id,subject=EXCLUDED.subject,type=EXCLUDED.type,due_at=EXCLUDED.due_at,
   duration_min=EXCLUDED.duration_min,done=EXCLUDED.done,deal_id=EXCLUDED.deal_id,person_name=EXCLUDED.person_name,org_name=EXCLUDED.org_name,
   note=EXCLUDED.note,updated_at=now();
 RETURN 'external';
END $$;