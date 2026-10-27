-- Appointments booked by callers (recruit, senior caller) need 3 days of lead time; managers and admins keep 2 days.
-- Counted from today (Vienna time): booked on the 27th, callers can start on the 30th, managers on the 29th.
CREATE OR REPLACE FUNCTION app_private.trg_appointment_lead_time() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE days integer;
BEGIN
 IF NEW.starts_at IS NULL OR coalesce(current_setting('app.skip_slot_check',true),'')='1' THEN RETURN NEW; END IF;
 days:=CASE WHEN public.user_role(coalesce(NEW.booked_by,NEW.user_id)) IN ('admin','manager') THEN 2 ELSE 3 END;
 IF NEW.starts_at < (date_trunc('day',now() AT TIME ZONE 'Europe/Vienna')+make_interval(days=>days)) AT TIME ZONE 'Europe/Vienna' THEN
  RAISE EXCEPTION 'appointment_too_soon' USING ERRCODE='22023';
 END IF;
 RETURN NEW;
END $$;
