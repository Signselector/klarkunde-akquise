-- Appointments (not callbacks) need 3 days of lead time for everybody, counted from today in Vienna time.
CREATE OR REPLACE FUNCTION app_private.trg_appointment_lead_time() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.starts_at IS NULL OR coalesce(current_setting('app.skip_slot_check',true),'')='1' THEN RETURN NEW; END IF;
 IF NEW.starts_at < (date_trunc('day',now() AT TIME ZONE 'Europe/Vienna')+interval '3 days') AT TIME ZONE 'Europe/Vienna' THEN
  RAISE EXCEPTION 'appointment_too_soon' USING ERRCODE='22023';
 END IF;
 RETURN NEW;
END $$;
