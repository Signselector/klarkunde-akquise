-- Removes the "fulfilment" role completely: data, RPC, policy reference and the enum value.

DELETE FROM public.user_roles WHERE role = 'fulfilment';
DROP FUNCTION IF EXISTS public.set_user_fulfilment(uuid, boolean);

-- History is readable by admins (and managers), the original caller, the acting user and the owner of the lead's batch.
DROP POLICY IF EXISTS lead_activity_read ON public.lead_activity;
CREATE POLICY lead_activity_read ON public.lead_activity FOR SELECT TO authenticated USING (
  public.has_role(auth.uid(),'admin')
  OR origin_caller_id = auth.uid() OR acting_user_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.leads l JOIN public.lead_batches b ON b.id=l.batch_id WHERE l.id=lead_activity.lead_id AND b.assigned_to=auth.uid()));

-- PostgreSQL cannot drop a single enum value, so the type is rebuilt without it. Everything that depends on the type
-- (the functions that take it and the policies that call them) is saved, dropped, and recreated unchanged.
DO $rebuild$
DECLARE
  labels text;
  f record;
  p record;
  fn_defs text[] := '{}';
  fn_oids oid[] := '{}';
  pol_defs text[] := '{}';
  d text;
  c record;
BEGIN
  SELECT string_agg(quote_literal(enumlabel), ',' ORDER BY enumsortorder) INTO labels
    FROM pg_enum WHERE enumtypid = 'public.app_role'::regtype AND enumlabel <> 'fulfilment';

  -- functions that use the type in their signature
  FOR f IN
    SELECT pr.oid, pr.proname FROM pg_proc pr JOIN pg_namespace n ON n.oid = pr.pronamespace
    WHERE n.nspname = 'public' AND ('public.app_role'::regtype::oid = ANY (pr.proargtypes::oid[]) OR pr.prorettype = 'public.app_role'::regtype)
  LOOP
    IF f.proname NOT IN ('has_role', 'set_user_role') THEN
      RAISE EXCEPTION 'unexpected function using app_role: %', f.proname;
    END IF;
    fn_oids := fn_oids || f.oid;
    fn_defs := fn_defs || pg_get_functiondef(f.oid);
  END LOOP;

  -- policies (any schema) that depend on those functions
  FOR p IN
    SELECT DISTINCT ON (pol.oid) pol.oid, pp.schemaname, pp.tablename, pp.policyname, pp.permissive, pp.roles, pp.cmd, pp.qual, pp.with_check
    FROM pg_depend dep
    JOIN pg_policy pol ON dep.classid = 'pg_policy'::regclass AND dep.objid = pol.oid
    JOIN pg_class cl ON cl.oid = pol.polrelid
    JOIN pg_namespace ns ON ns.oid = cl.relnamespace
    JOIN pg_policies pp ON pp.schemaname = ns.nspname AND pp.tablename = cl.relname AND pp.policyname = pol.polname
    WHERE dep.refobjid = ANY (fn_oids)
  LOOP
    pol_defs := pol_defs || format('CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s%s%s',
      p.policyname, p.schemaname, p.tablename, p.permissive, p.cmd,
      (SELECT string_agg(CASE WHEN r = 'public' THEN 'PUBLIC' ELSE quote_ident(r) END, ', ') FROM unnest(p.roles) r),
      CASE WHEN p.qual IS NULL THEN '' ELSE ' USING (' || p.qual || ')' END,
      CASE WHEN p.with_check IS NULL THEN '' ELSE ' WITH CHECK (' || p.with_check || ')' END);
    EXECUTE format('DROP POLICY %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
  END LOOP;

  FOR f IN SELECT unnest(fn_oids) AS oid LOOP
    EXECUTE 'DROP FUNCTION ' || f.oid::regprocedure::text;
  END LOOP;

  -- the partial index compares against typed literals, so it is rebuilt with the column
  DROP INDEX IF EXISTS public.one_primary_role;
  ALTER TYPE public.app_role RENAME TO app_role_old;
  EXECUTE 'CREATE TYPE public.app_role AS ENUM (' || labels || ')';

  FOR c IN
    SELECT n.nspname, cl.relname, a.attname
    FROM pg_attribute a JOIN pg_class cl ON cl.oid = a.attrelid JOIN pg_namespace n ON n.oid = cl.relnamespace
    WHERE a.atttypid = 'public.app_role_old'::regtype AND a.attnum > 0 AND NOT a.attisdropped AND cl.relkind = 'r'
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ALTER COLUMN %I TYPE public.app_role USING %I::text::public.app_role', c.nspname, c.relname, c.attname, c.attname);
  END LOOP;
  DROP TYPE public.app_role_old;
  CREATE UNIQUE INDEX one_primary_role ON public.user_roles (user_id) WHERE role IN ('admin','manager','veteran','recruit','caller');

  FOREACH d IN ARRAY fn_defs LOOP EXECUTE d; END LOOP;
  REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
  REVOKE ALL ON FUNCTION public.set_user_role(uuid, public.app_role) FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.set_user_role(uuid, public.app_role) TO authenticated;
  FOREACH d IN ARRAY pol_defs LOOP EXECUTE d; END LOOP;
END $rebuild$;
