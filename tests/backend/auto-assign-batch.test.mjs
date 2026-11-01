import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";

const db = new PGlite();
const admin = randomUUID(),
  anna = randomUUID(),
  ben = randomUUID(),
  chris = randomUUID();
const rpc = async (name, args = []) =>
  (
    await db.query(
      `select public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) as result`,
      args,
    )
  ).rows[0].result;
const as = async (id, role = "authenticated") => {
  await db.exec("RESET ROLE");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id ?? ""]);
  await db.exec("SET ROLE " + role);
};
const batchRow = async (id) => (await rpc("get_batch_progress")).find((b) => b.id === id);
let A, B, C, M;
const mk = async (name, country, state = "confirmed") =>
  (
    await db.query(
      "insert into public.lead_batches(name,created_by,import_state,country) values ($1,$2,$3,$4) returning id",
      [name, admin, state, country],
    )
  ).rows[0].id;
const addLeads = (batch, n) =>
  db.query(
    "insert into public.leads(batch_id,company,phone) select $1::uuid,'Firma '||g,'+49 30 '||g||$1::text from generate_series(1,$2::int) g",
    [batch, n],
  );
const owner = async (id) =>
  (await db.query("select assigned_to from public.lead_batches where id=$1", [id])).rows[0]
    .assigned_to;

before(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 GRANT USAGE ON SCHEMA auth TO authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;`);
  for (const file of (await readdir(new URL("../../drizzle/migrations/", import.meta.url)))
    .filter((x) => x.endsWith(".sql") && !/^(0045_|0050_backend_maintenance_cron)/.test(x))
    .sort()) {
    const sql = (
      await readFile(new URL("../../drizzle/migrations/" + file, import.meta.url), "utf8")
    )
      .replace(/^CREATE EXTENSION IF NOT EXISTS pg_cron;$/m, "")
      .replace(/^SELECT cron\.schedule\(.*$/m, "");
    await db.exec(sql);
  }
  await db.query(
    "insert into auth.users values ($1,'office@signselector.com','{\"display_name\":\"Admin\"}'),($2,'anna@example.test','{\"display_name\":\"Anna\"}'),($3,'ben@example.test','{\"display_name\":\"Ben\"}')",
    [admin, anna, ben],
  );
  await db.query("update public.user_roles set role='admin' where user_id=$1", [admin]);
  await db.query(
    "insert into public.user_countries(user_id,country) values ($1,'DE'),($2,'DE'),($3,'DE'),($1,'AT') on conflict do nothing",
    [admin, anna, ben],
  );
  A = await mk("A", "DE");
  B = await mk("B", "DE");
  C = await mk("C", "DE");
  M = await mk("M", "DE");
  for (const b of [A, B, C, M]) await addLeads(b, 2);
  await db.query("update public.lead_batches set assigned_to=$2 where id=$1", [A, anna]);
  await db.query("update public.lead_batches set assigned_to=$2 where id=$1", [M, admin]);
});
after(() => db.close());

test("a batch that is only partly processed assigns nothing", async () => {
  await db.query(
    "update public.leads set status='no_interest' where id=(select id from public.leads where batch_id=$1 limit 1)",
    [A],
  );
  assert.equal(await owner(B), null);
});

test("finishing the batch gives its owner the oldest free batch, without a manager", async () => {
  await db.query("update public.leads set attempts=1 where batch_id=$1 and status='open'", [A]);
  assert.equal(await owner(B), anna);
  assert.equal(await owner(C), null, "only one batch at a time");
  const a = (await db.query("select auto_next_batch_id from public.lead_batches where id=$1", [A]))
    .rows[0];
  assert.equal(a.auto_next_batch_id, B);
  const audit = await db.query(
    "select actor from public.audit_events where action='auto_assign_batch' and target_id=$1",
    [B],
  );
  assert.equal(audit.rows[0].actor, anna);
});

test("later changes of the finished batch do not hand out another batch", async () => {
  await db.query("update public.leads set attempts=2 where batch_id=$1", [A]);
  assert.equal(await owner(C), null);
});

test("a batch owned by a manager or admin never triggers an automatic assignment", async () => {
  await db.query("update public.leads set status='no_interest' where batch_id=$1", [M]);
  assert.equal(await owner(C), null);
});

test("if no free batch exists, the maintenance job assigns one as soon as it appears", async () => {
  await db.query("update public.lead_batches set assigned_to=$2 where id=$1", [C, admin]);
  const X = await mk("X", "DE");
  await addLeads(X, 1);
  await db.query("update public.lead_batches set assigned_to=$2 where id=$1", [X, ben]);
  await db.query("update public.leads set status='no_interest' where batch_id=$1", [X]);
  const x = (await db.query("select auto_next_at from public.lead_batches where id=$1", [X]))
    .rows[0];
  assert.equal(x.auto_next_at, null, "nothing free: it stays open for a later run");
  const F = await mk("F", "DE");
  await addLeads(F, 2);
  assert.equal((await db.query("select public.auto_assign_finished_batches() n")).rows[0].n, 1);
  assert.equal(await owner(F), ben);
  assert.equal((await db.query("select public.auto_assign_finished_batches() n")).rows[0].n, 0);
});

test("not reached leads are handed out for 20 days, then they only show up in the admin list", async () => {
  const U = await mk("U", "DE");
  await addLeads(U, 2);
  await db.query("update public.lead_batches set assigned_to=$2 where id=$1", [U, anna]);
  // Isolate the scenario: every other lead is done.
  await db.query("update public.leads set status='no_interest' where batch_id<>$1", [U]);
  const ids = (
    await db.query("select id from public.leads where batch_id=$1 order by id", [U])
  ).rows.map((r) => r.id);
  // Both tried once: one 5 days ago, one 25 days ago.
  await db.query(
    "update public.leads set status='open',attempts=1,last_called_at=now()-interval '5 days',last_called_by=$2 where id=$1",
    [ids[0], anna],
  );
  await db.query(
    "update public.leads set status='open',attempts=1,last_called_at=now()-interval '25 days',last_called_by=$2 where id=$1",
    [ids[1], anna],
  );
  await as(anna);
  const next = await rpc("claim_next_lead", ["DE"]);
  assert.equal(next.lead.id, ids[0], "the recent one is still handed out");
  await db.exec("RESET ROLE");
  await db.query("delete from public.lead_claims");
  await db.query("update public.leads set last_called_at=now()-interval '30 days' where id=$1", [
    ids[0],
  ]);
  await as(anna);
  assert.equal(await rpc("claim_next_lead", ["DE"]), null, "after 20 days nothing is handed out");
  await assert.rejects(() => rpc("get_unreached_leads", ["DE"]), /forbidden/);
  await as(admin);
  const list = await rpc("get_unreached_leads", ["DE"]);
  assert.deepEqual(list.map((r) => r.lead_id).sort(), [...ids].sort());
  assert.equal(list[0].caller, "Anna");
  await db.exec("RESET ROLE");
  const p = (
    await db.query(
      "select count(*) filter(where attempts>0)::int processed from public.leads where batch_id=$1",
      [U],
    )
  ).rows[0];
  assert.equal(p.processed, 2, "they still count as processed for the batch");
});
