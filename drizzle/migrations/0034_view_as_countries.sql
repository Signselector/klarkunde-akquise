-- "Ansicht als Mitarbeiter": the country list is that of the viewed employee (a caller of AT sees only AT).
DO $$ DECLARE d text;
BEGIN
 d:=pg_get_functiondef('public.my_countries()'::regprocedure);
 d:=replace(d,'auth.uid()','app_private.eff_uid()');
 EXECUTE d;
END $$;
