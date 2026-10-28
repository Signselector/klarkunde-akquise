import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";

const db = new PGlite();
const [admin, mgrAT, mgrDE, rec, vetDE, mgr2] = Array.from({ length: 6 }, randomUUID);
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const as = async (id, viewAs = null) => {
  await db.exec("RESET ROLE");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id ?? ""]);
  await db.query("select set_config('request.headers',$1,false)", [viewAs ? JSON.stringify({ "x-view-as": viewAs }) : "{}"]);
  await db.exec("SET ROLE authenticated");
};

before(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 GRANT USAGE ON SCHEMA auth TO authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;`);
  for (const file of (await readdir(new URL("../../drizzle/migrations/", import.meta.url))).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = (await readFile(new URL("../../drizzle/migrations/" + file, import.meta.url), "utf8"))
      .replace(/^CREATE EXTENSION IF NOT EXISTS pg_cron;$/m, "")
      .replace(/^SELECT cron\.schedule\(.*$/m, "");
    await db.exec(sql);
  }
  for (const [id, mail] of [[admin, "office@signselector.com"], [mgrAT, "m-at@x.at"], [mgrDE, "m-de@x.de"], [rec, "rec@x.at"], [vetDE, "vet@x.de"], [mgr2, "m2@x.at"]])
    await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,'{}')", [id, mail]);
  await db.exec("RESET ROLE");
  await db.query("select public.set_user_role($1,'manager')", [mgrAT]).catch(() => {});
});

test("view_as: header is only honoured for permitted viewers and targets", async () => {
  await db.exec("RESET ROLE");
  // Roles/countries set directly so the test does not depend on the role-management RPCs.
  await db.query("delete from public.user_roles where user_id = any($1)", [[mgrAT, mgrDE, mgr2]]);
  await db.query("insert into public.user_roles(user_id,role) select x,'manager' from unnest($1::uuid[]) x", [[mgrAT, mgrDE, mgr2]]);
  await db.query("insert into public.user_countries(user_id,country) values($1,'AT'),($2,'DE'),($3,'DE'),($4,'AT'),($5,'AT') on conflict do nothing", [mgrAT, mgrDE, vetDE, rec, mgr2]);
  await db.query("update public.user_roles set role='veteran' where user_id=$1", [vetDE]);
  await as(mgrAT, rec);
  assert.equal((await q("select public.view_as_target() t"))[0].t, rec);
  await as(mgrAT, vetDE);
  assert.equal((await q("select public.view_as_target() t"))[0].t, null, "other country");
  await as(mgrAT, mgr2);
  assert.equal((await q("select public.view_as_target() t"))[0].t, null, "managers only view callers");
  await as(rec, mgrAT);
  assert.equal((await q("select public.view_as_target() t"))[0].t, null, "callers cannot view");
  await as(mgrAT, "not-a-uuid");
  assert.equal((await q("select public.view_as_target() t"))[0].t, null);
  await as(mgrAT, mgrAT);
  assert.equal((await q("select public.view_as_target() t"))[0].t, null, "self");
  await as(admin, vetDE);
  assert.equal((await q("select public.view_as_target() t"))[0].t, vetDE);
});

test("view_as: callbacks of the viewed employee are readable only with a valid header", async () => {
  await db.exec("RESET ROLE");
  const lead = (await q("select id from public.leads limit 1"))[0];
  if (!lead) {
    await db.query("insert into public.lead_batches(id,name,country,created_by) values($1,'b','AT',$2)", [randomUUID(), admin]).catch(() => {});
  }
  const batch = (await q("select id from public.lead_batches limit 1"))[0]?.id ?? (await q("insert into public.lead_batches(name,country,created_by) values('b','AT',$1) returning id", [admin]))[0].id;
  const l = (await q("insert into public.leads(batch_id,company) values($1,'F') returning id", [batch]))[0].id;
  await db.query("insert into public.callbacks(lead_id,user_id,country,due_at) values($1,$2,'AT',now()+interval '1 day')", [l, rec]);
  await as(mgrAT);
  assert.equal((await q("select count(*)::int n from public.callbacks where user_id=$1", [rec]))[0].n, 0);
  await as(mgrAT, rec);
  assert.equal((await q("select count(*)::int n from public.callbacks where user_id=$1", [rec]))[0].n, 1);
  await as(mgrDE, rec);
  assert.equal((await q("select count(*)::int n from public.callbacks where user_id=$1", [rec]))[0].n, 0);
});

test("view_as: personal stats answer for the viewed employee", async () => {
  await as(mgrAT, rec);
  const viewed = (await q("select public.get_caller_month() r"))[0].r;
  await as(rec);
  const own = (await q("select public.get_caller_month() r"))[0].r;
  assert.deepEqual(viewed, own);
});
