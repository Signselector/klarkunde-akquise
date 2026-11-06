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
let open, draft, abroad;

before(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE PUBLICATION supabase_realtime; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 GRANT USAGE ON SCHEMA auth TO authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;`);
  for (const file of (await readdir(new URL("../../drizzle/migrations/", import.meta.url)))
    .filter(
      (x) => x.endsWith(".sql") && !/^(0045_|0050_backend_maintenance_cron|0061_|0062_|0069_)/.test(x),
    )
    .sort()) {
    // PGlite has no pg_cron: skip only the nightly schedule, the functions are still created.
    const sql = (
      await readFile(new URL("../../drizzle/migrations/" + file, import.meta.url), "utf8")
    )
      .replace(/^CREATE EXTENSION IF NOT EXISTS pg_cron;$/m, "")
      .replace(/^SELECT cron\.schedule\(.*$/m, "");
    await db.exec(sql);
  }
  await db.query(
    "insert into auth.users values ($1,'office@signselector.com','{\"display_name\":\"Admin\"}'),($2,'anna@example.test','{\"display_name\":\"Anna\"}'),($3,'ben@example.test','{\"display_name\":\"Ben\"}'),($4,'chris@example.test','{\"display_name\":\"Chris\"}')",
    [admin, anna, ben, chris],
  );
  await db.query("update public.user_roles set role='admin' where user_id=$1", [admin]);
  await db.query(
    "insert into public.user_countries(user_id,country) values ($1,'DE'),($2,'DE'),($3,'DE'),($1,'AT') on conflict do nothing",
    [admin, anna, ben],
  );
  open = (
    await db.query(
      "insert into public.lead_batches(name,created_by,import_state,country) values ('Test DE',$1,'confirmed','DE') returning id",
      [admin],
    )
  ).rows[0].id;
  draft = (
    await db.query(
      "insert into public.lead_batches(name,created_by,import_state,country) values ('Entwurf',$1,'draft','DE') returning id",
      [admin],
    )
  ).rows[0].id;
  abroad = (
    await db.query(
      "insert into public.lead_batches(name,created_by,import_state,country) values ('Test AT',$1,'confirmed','AT') returning id",
      [admin],
    )
  ).rows[0].id;
  await db.query(
    "insert into public.leads(batch_id,company,phone) select $1,'Firma '||g,'+43 1 '||g from generate_series(1,3) g",
    [open],
  );
  await db.query("insert into public.leads(batch_id,company,phone) values ($1,'Ausland','+43 9')", [
    abroad,
  ]);
});
after(() => db.close());

test("a new batch is free and listed with its open leads", async () => {
  await as(anna);
  const b = await batchRow(open);
  assert.equal(b.assigned_to, null);
  assert.equal(b.total, 3);
  assert.equal(b.open, 3);
  assert.equal(
    await rpc("claim_next_lead", ["DE"]),
    null,
    "nothing is handed out before a batch is taken",
  );
});

test("callers cannot take a batch; a manager or admin takes or assigns it", async () => {
  await as(anna);
  await assert.rejects(() => rpc("claim_batch", [open]), /forbidden/);
  await as(admin);
  const first = await rpc("reassign_batch", [open, anna]);
  assert.equal(first.assigned_to, anna);
  await as(ben);
  await assert.rejects(() => rpc("claim_batch", [open]), /forbidden/);
  const b = await batchRow(open);
  assert.equal(b.assigned_to, anna);
  assert.equal(b.assigned_name, "Anna");
});

test("a batch can only be assigned to accounts of its country, global admins included", async () => {
  await db.exec("RESET ROLE");
  const dora = randomUUID();
  await db.query(
    "insert into auth.users values ($1,'dora@example.test','{\"display_name\":\"Dora\"}')",
    [dora],
  );
  await db.query("update public.user_roles set role='admin' where user_id=$1", [dora]);
  await db.query("delete from public.user_countries where user_id=$1", [dora]);
  await db.query("insert into public.user_countries(user_id,country) values ($1,'AT')", [dora]);
  await as(admin);
  await assert.rejects(() => rpc("reassign_batch", [open, dora]), /invalid_assignee/);
  assert.equal((await rpc("reassign_batch", [abroad, dora])).assigned_to, dora);
});

test("batch progress only covers the asked country and confirmed batches", async () => {
  await as(admin);
  const de = await rpc("get_batch_progress", ["DE"]);
  assert.ok(de.some((b) => b.id === open));
  assert.ok(!de.some((b) => b.id === abroad), "AT batch is not part of the DE figures");
  assert.ok(!de.some((b) => b.id === draft), "drafts are not listed");
  await as(ben);
  await assert.rejects(() => rpc("get_batch_progress", ["AT"]), /forbidden/);
  const own = await rpc("get_batch_progress");
  assert.ok(!own.some((b) => b.id === abroad), "without a country only the user's countries");
});

test("only confirmed batches in an allowed country can be taken", async () => {
  await as(admin);
  await assert.rejects(() => rpc("claim_batch", [draft]), /batch_not_found/);
  await assert.rejects(() => rpc("claim_batch", [randomUUID()]), /batch_not_found/);
  await as(chris);
  await assert.rejects(() => rpc("claim_batch", [open]), /forbidden/);
});

test("leads are only handed to the owner of the batch", async () => {
  await as(ben);
  assert.equal(await rpc("claim_next_lead", ["DE"]), null);
  await as(anna);
  const mine = await rpc("claim_next_lead", ["DE"]);
  assert.ok(mine.lead.company.startsWith("Firma"));
  await rpc("renew_lead_claim", [mine.claim_id, true]);
});

test("only a manager or admin can release a batch, then it can be assigned again", async () => {
  await as(ben);
  await assert.rejects(() => rpc("release_batch", [open]), /forbidden/);
  await as(anna);
  await assert.rejects(() => rpc("release_batch", [open]), /forbidden/);
  await as(admin);
  await assert.rejects(() => rpc("release_batch", [randomUUID()]), /batch_not_found/);
  assert.equal((await rpc("release_batch", [open])).assigned_to, null);
  assert.equal(
    (await rpc("release_batch", [open])).assigned_to,
    null,
    "releasing twice is harmless",
  );
  await as(anna);
  assert.equal(await rpc("claim_next_lead", ["DE"]), null, "the former owner gets nothing more");
  await as(admin);
  assert.equal((await rpc("reassign_batch", [open, ben])).assigned_to, ben);
  await as(ben);
  assert.ok(await rpc("claim_next_lead", ["DE"]));
});

test("taking and releasing leave an audit trail; callers cannot write batches directly", async () => {
  await as(admin);
  const actions = (
    await db.query(
      "select action from public.audit_events where action like '%\_batch' order by created_at,id",
    )
  ).rows.map((r) => r.action);
  assert.deepEqual(actions, [
    "reassign_batch",
    "reassign_batch",
    "release_batch",
    "reassign_batch",
  ]);
  await as(ben);
  await assert.rejects(
    () => db.query("update public.lead_batches set assigned_to=null"),
    /permission denied/,
  );
});
