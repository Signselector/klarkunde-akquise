DO $$
DECLARE f record; def text; fixed text;
BEGIN
  FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='record_lead_action' LOOP
    def:=pg_get_functiondef(f.oid);
    fixed:=regexp_replace(def,',\s*''contact_details''','');
    IF fixed=def THEN RAISE EXCEPTION 'allowed action list not found'; END IF;
    EXECUTE fixed;
  END LOOP;
END $$;