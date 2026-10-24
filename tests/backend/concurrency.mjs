// Dedicated disposable local database only. Never point this at a Lovable project.
import postgres from "postgres";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const url = process.env.BACKEND_TEST_DATABASE_URL;
if (!url || !["localhost", "127.0.0.1"].includes(new URL(url).hostname))
  throw new Error("Requires a disposable localhost BACKEND_TEST_DATABASE_URL");
const db = postgres(url, { max: 24, onnotice: () => {} });
try {
  if ((await db`select to_regclass('public.profiles') existing`)[0].existing)
    throw new Error("Database not empty; create a fresh test database.");
  await db.unsafe(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; END IF; END $$;
 CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 GRANT USAGE ON SCHEMA auth TO authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;`);
  const setup = await db.reserve();
  try {
    await setup.unsafe(
      await readFile(new URL("../../backend/bootstrap.sql", import.meta.url), "utf8"),
    );
  } finally {
    setup.release();
  }
  const users = Array.from({ length: 20 }, () => randomUUID()),
    lead = randomUUID();
  for (const id of users) await db`insert into auth.users values(${id},'test@example.test','{}')`;
  await db`insert into leads(id,company,contact_name,email) values(${lead},'Concurrency','Caller','test@example.test')`;
  const as = (id, fn) =>
    db.begin(async (tx) => {
      await tx`select set_config('request.jwt.claim.sub',${id},true)`;
      await tx`set local role authenticated`;
      return fn(tx);
    });
  const claims = await Promise.all(
    users.map((id) => as(id, (tx) => tx`select claim_next_lead() result`)),
  );
  const winners = claims.map((r, i) => (r[0].result ? i : -1)).filter((i) => i >= 0);
  assert.equal(winners.length, 1, "only one caller can reserve the same lead");
  const user = users[winners[0]],
    request = randomUUID();
  const calls = await Promise.all(
    Array.from({ length: 10 }, () =>
      as(
        user,
        (tx) =>
          tx`select record_call_outcome(${request},${lead},0,'appointment','same request','2099-01-01') result`,
      ),
    ),
  );
  for (const r of calls) assert.deepEqual(r[0].result, calls[0][0].result);
  assert.equal(Number((await db`select count(*) n from appointments`)[0].n), 1);
  assert.equal(Number((await db`select count(*) n from integration_jobs`)[0].n), 1);
  assert.equal((await db`select attempts from leads where id=${lead}`)[0].attempts, 1);
  const admin = users[0];
  await db`update user_roles set role='admin' where user_id=${admin}`;
  await db`update integration_config set enabled=true,pipeline_id=1,appointment_stage_id=2,production_stage_id=3`;
  const jobs = await Promise.all(
    Array.from({ length: 10 }, () =>
      db.begin(async (tx) => {
        await tx`set local role service_role`;
        return tx`select claim_integration_jobs() result`;
      }),
    ),
  );
  assert.equal(
    jobs.reduce((n, r) => n + r[0].result.length, 0),
    1,
    "only one worker leases the job",
  );
  // Invalid requests roll back any writes, including integration enqueue.
  await db`update leads set status='open' where id=${lead}`;
  await as(user, (tx) => tx`select claim_next_lead()`);
  await db.unsafe(`CREATE FUNCTION public.fail_note() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced_failure'; END $$;
 CREATE TRIGGER fail_note BEFORE INSERT ON lead_notes FOR EACH ROW EXECUTE FUNCTION fail_note();`);
  await assert.rejects(
    () =>
      as(
        user,
        (tx) => tx`select record_call_outcome(${randomUUID()},${lead},1,'production','fail')`,
      ),
    /forced_failure/,
  );
  assert.equal((await db`select attempts from leads where id=${lead}`)[0].attempts, 1);
  assert.equal(Number((await db`select count(*) n from integration_jobs`)[0].n), 1);
  console.log(
    "PASS PostgreSQL 16: bootstrap, 20 concurrent callers, 10 duplicate requests, 10 workers, transactional rollback.",
  );
} finally {
  await db.end();
}
