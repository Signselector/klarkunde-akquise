// Run with: node tests/backend/atomic-call.mjs /path/to/@electric-sql/pglite/dist/index.js
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const db = new PGlite();
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;`);
  for (const name of ['0000_phase1_schema','0001_phase2_schema','0002_atomic_call','0003_role_management']) {
    await db.exec(await readFile(new URL(`../../drizzle/migrations/${name}.sql`,import.meta.url),'utf8'));
  }
  const actor='10000000-0000-0000-0000-000000000001';
  const other='10000000-0000-0000-0000-000000000002';
  const lead='20000000-0000-0000-0000-000000000001';
  const req='30000000-0000-0000-0000-000000000001';
  await db.exec(`INSERT INTO auth.users VALUES ('${actor}','admin@example.test','{}'),('${other}','caller@example.test','{}');
    UPDATE public.user_roles SET role='admin' WHERE user_id='${actor}';
    INSERT INTO public.leads(id,company) VALUES('${lead}','Test');
    SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${other}',false);`);
  const call=(id,outcome='appointment',attempts=0)=>db.query('SELECT public.record_call_outcome($1,$2,$3,$4,$5,$6) AS result',
    [id,lead,attempts,outcome,'Test note','2099-01-01T12:00:00Z']);
  await assert.rejects(()=>db.query('SELECT public.set_user_role($1,$2)',[actor,'caller']),/forbidden/);
  await db.exec(`SELECT set_config('request.jwt.claim.sub','${actor}',false)`);
  await assert.rejects(()=>db.query('SELECT public.set_user_role($1,$2)',[actor,'caller']),/last_admin/);
  await db.query('SELECT public.set_user_role($1,$2)',[other,'admin']);
  await db.query('SELECT public.set_user_role($1,$2)',[other,'caller']);
  await db.exec(`SELECT set_config('request.jwt.claim.sub','${other}',false)`);
  await assert.rejects(()=>db.query("UPDATE user_roles SET role='admin'"),/permission denied/);
  const first=await call(req);
  assert.deepEqual((await call(req)).rows,first.rows);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM appointments')).rows[0].n,1);
  await assert.rejects(()=>call(req,'production'),/idempotency_conflict/);
  await assert.rejects(()=>call('30000000-0000-0000-0000-000000000002'),/stale_lead/);
  await assert.rejects(()=>db.query('SELECT * FROM call_requests'),/permission denied/);
  await db.exec("SELECT set_config('request.jwt.claim.sub','',false)");
  await assert.rejects(()=>call(req),/unauthenticated/);
  await db.exec(`SELECT set_config('request.jwt.claim.sub','${other}',false); RESET ROLE;
    CREATE FUNCTION public.reject_note() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced_note_failure'; END $$;
    CREATE TRIGGER reject_note BEFORE INSERT ON public.lead_notes FOR EACH ROW EXECUTE FUNCTION public.reject_note(); SET ROLE authenticated;`);
  await assert.rejects(()=>call('30000000-0000-0000-0000-000000000003','production',1),/forced_note_failure/);
  assert.equal((await db.query('SELECT attempts FROM leads')).rows[0].attempts,1);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM status_changes')).rows[0].n,1);
  console.log('PASS: fresh migrations, atomic outcome, idempotency, conflict, unauthenticated access, private ledger, rollback, role authorization, final-admin protection');
} finally { await db.close(); }
