-- Appointments (30 minutes) cannot be booked between 12:00 and 13:00 Vienna time.
CREATE OR REPLACE FUNCTION app_private.is_lunch_break(ts timestamptz) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT (ts AT TIME ZONE 'Europe/Vienna')::time >= time '12:00' AND (ts AT TIME ZONE 'Europe/Vienna')::time < time '13:00'
$$;

-- New booked appointments (with a lead). Entries without a lead (the manager's own calendar entries) and system
-- flows that set app.skip_slot_check are not affected.
CREATE OR REPLACE FUNCTION app_private.trg_appointment_lunch() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.starts_at IS NULL OR NEW.lead_id IS NULL OR coalesce(current_setting('app.skip_slot_check',true),'')='1' THEN RETURN NEW; END IF;
 IF app_private.is_lunch_break(NEW.starts_at) THEN RAISE EXCEPTION 'lunch_break' USING ERRCODE='22023'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS appointment_lunch ON public.appointments;
CREATE TRIGGER appointment_lunch BEFORE INSERT ON public.appointments FOR EACH ROW EXECUTE FUNCTION app_private.trg_appointment_lunch();

-- Moving an appointment follows the same rule.
DO $$ DECLARE d text; o text;
BEGIN
 d:=pg_get_functiondef('public.reschedule_appointment(uuid,timestamptz)'::regprocedure); o:=d;
 d:=replace(d,'PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(''appt:''||ap.country,0));',
  'IF app_private.is_lunch_break(p_starts_at) THEN RAISE EXCEPTION ''lunch_break'' USING ERRCODE=''22023''; END IF;'||chr(10)||' PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(''appt:''||ap.country,0));');
 IF d=o THEN RAISE EXCEPTION 'patch did not apply'; END IF;
 EXECUTE d;
END $$;
