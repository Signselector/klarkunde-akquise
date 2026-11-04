CREATE OR REPLACE FUNCTION app_private.trg_callback_slot() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 -- Callbacks may overlap freely; no slot conflict check anymore.
 RETURN NEW;
END $$;