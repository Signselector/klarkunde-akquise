import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";

const db = new PGlite();
const [master, admin, mgrDE, mgrAT, vet, rec, recAT, fresh] = Array.from({ length: 8 }, randomUUID);
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const as = async (id, role = "authenticated") => {
  await db.exec("RESET ROLE");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id ?? ""]);
  await db.exec("SET ROLE " + role);
};
const roleOf = async (id) => {
  await db.exec("RESET ROLE");
  return (await q("select public.user_role($1) r", [id]))[0].r;
};
const setRole = (target, role) => q("select public.set_user_role($1,$2)", [target, role]);

before(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 GRANT USAGE ON SCHEMA auth TO authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;`);
  for (const file of (await readdir(new URL("../../drizzle/migrations/", import.meta.url)))
    .filter((x) => x.endsWith(".sql"))
    .sort()) {
    const sql = (await readFile(new URL("../../drizzle/migrations/" + file, import.meta.url), "utf8"))
      .replace(/^CREATE EXTENSION IF NOT EXISTS pg_cron;$/m, "")
      .replace(/^SELECT cron\.schedule\(.*$/m, "");
    await db.exec(sql);
  }
  // The first account of an empty system becomes admin, everybody after that a recruit.
  const names = { [master]: "office@signselector.com", [admin]: "admin@example.test", [mgrDE]: "mgr-de@example.test", [mgrAT]: "mgr-at@example.test", [vet]: "vet@example.test", [rec]: "rec@example.test", [recAT]: "rec-at@example.test", [fresh]: "fresh@example.test" };
  for (const id of [master, admin, mgrDE, mgrAT, vet, rec, recAT, fresh])
    await q("insert into auth.users values ($1,$2,'{}')", [id, names[id]]);
  await q("update public.user_roles set role='admin' where user_id=$1", [admin]);
  await q("update public.user_roles set role='manager' where user_id in ($1,$2)", [mgrDE, mgrAT]);
  await q("update public.user_roles set role='veteran' where user_id=$1", [vet]);
  await q("delete from public.user_countries");
  await q("insert into public.user_countries values ($1,'DE'),($2,'AT'),($3,'DE'),($4,'DE'),($5,'AT')", [mgrDE, mgrAT, vet, rec, recAT]);
});
after(() => db.close());

test("new accounts are recruits, the first account is admin", async () => {
  assert.equal(await roleOf(master), "admin", "master counts as admin");
  assert.equal(await roleOf(rec), "recruit");
  assert.equal(await roleOf(fresh), "recruit");
  assert.equal(await roleOf(vet), "veteran");
});

test("admin sets any role and sees every country; callers only their own", async () => {
  await as(admin);
  assert.deepEqual((await q("select public.my_countries() c"))[0].c, ["DE", "AT", "NL"]);
  assert.equal((await q("select public.can_access_country('NL') ok"))[0].ok, true);
  await setRole(rec, "veteran");
  assert.equal(await roleOf(rec), "veteran");
  await as(admin);
  await setRole(rec, "recruit");
  await as(rec);
  assert.equal((await q("select public.can_access_country('AT') ok"))[0].ok, false);
  assert.equal((await q("select public.can_access_country('DE') ok"))[0].ok, true);
});

test("a manager promotes recruits to veterans in the own country only", async () => {
  await as(mgrDE);
  await setRole(rec, "veteran");
  assert.equal(await roleOf(rec), "veteran");
  await as(mgrDE);
  await setRole(rec, "recruit");
  await as(mgrDE);
  await assert.rejects(() => setRole(recAT, "veteran"), /forbidden/, "other country");
  await assert.rejects(() => setRole(rec, "manager"), /forbidden/, "no manager promotion");
  await assert.rejects(() => setRole(rec, "admin"), /forbidden/);
  await assert.rejects(() => setRole(admin, "recruit"), /forbidden/, "cannot touch admins");
  await assert.rejects(() => setRole(mgrAT, "recruit"), /forbidden/, "cannot touch managers");
});

test("recruits and veterans cannot change roles", async () => {
  await as(vet);
  await assert.rejects(() => setRole(rec, "veteran"), /forbidden/);
  await as(rec);
  await assert.rejects(() => setRole(rec, "admin"), /forbidden/);
});

test("the last admin and the master cannot be demoted", async () => {
  await as(admin);
  await assert.rejects(() => setRole(master, "recruit"), /not_allowed/);
  // The master also holds the admin role, so the admin is not the last one until that row is gone.
  await db.exec("RESET ROLE");
  await q("delete from public.user_roles where user_id=$1", [master]);
  await as(admin);
  await assert.rejects(() => setRole(admin, "recruit"), /last_admin/);
  await db.exec("RESET ROLE");
  await q("insert into public.user_roles(user_id,role) values ($1,'admin')", [master]);
});

test("only the admin decides countries; a manager cannot grant or remove any", async () => {
  await as(mgrDE);
  await assert.rejects(() => q("insert into public.user_countries values ($1,'DE')", [fresh]), /row-level security/);
  await assert.rejects(() => q("insert into public.user_countries values ($1,'AT')", [fresh]), /row-level security/);
  const del = await q("delete from public.user_countries where user_id=$1 and country='DE' returning 1", [rec]);
  assert.equal(del.length, 0, "manager cannot remove a country");
  await as(rec);
  await assert.rejects(() => q("insert into public.user_countries values ($1,'AT')", [rec]), /row-level security/);
  await as(admin);
  await q("insert into public.user_countries values ($1,'NL')", [fresh]);
  await q("delete from public.user_countries where user_id=$1", [fresh]);
});

test("manager may deactivate callers of the own country but not other countries or admins", async () => {
  await as(mgrDE);
  await q("select public.set_user_active($1,false)", [rec]);
  await q("select public.set_user_active($1,true)", [rec]);
  await assert.rejects(() => q("select public.set_user_active($1,false)", [recAT]), /forbidden/);
  await assert.rejects(() => q("select public.set_user_active($1,false)", [admin]), /forbidden/);
  await as(rec);
  await assert.rejects(() => q("select public.set_user_active($1,false)", [recAT]), /forbidden/);
});

test("appointments: recruits cannot book, veterans and managers can", async () => {
  let n = 0;
  const book = (u) =>
    as(u).then(() => q("select public.save_calendar_appointment(now()+interval '1 day'+make_interval(hours=>$1::int),'other','Demo',null,'DE') id", [++n]));
  await assert.rejects(() => book(rec), /appointment_forbidden/);
  assert.ok((await book(vet))[0].id);
  assert.ok((await book(mgrDE))[0].id);
  assert.ok((await book(admin))[0].id);
  await as(mgrDE);
  await assert.rejects(() => q("select public.save_calendar_appointment(now()+interval '1 day','other','x',null,'AT')"), /country_forbidden/);
});

test("backend stays with the admin: configuration, audit trail, stage mapping", async () => {
  await as(mgrDE);
  assert.equal((await q("select public.has_role($1,'admin') s",[mgrDE]))[0].s, true, "manager counts as staff");
  assert.equal((await q("select public.is_global_admin($1) g",[mgrDE]))[0].g, false);
  const upd = await q("update public.integration_config set test_mode=false returning 1");
  assert.equal(upd.length, 0, "manager cannot change the test mode");
  assert.equal((await q("select 1 from public.audit_events limit 1")).length, 0);
  await assert.rejects(() => q("insert into public.pipedrive_stage_mapping(country,mapping) values ('NL','{}')"), /row-level security/);
  await assert.rejects(() => q("select public.archive_open_leads()"), /forbidden/);
  await as(admin);
  assert.equal((await q("update public.integration_config set test_mode=true returning 1")).length, 1);
});

test("a manager manages batches only in the own country", async () => {
  await db.exec("RESET ROLE");
  const mk = async (country) => (await q("insert into public.lead_batches(name,created_by,import_state,country,assigned_to) values ($1,$2,'confirmed',$3,$4) returning id", ["B" + country, admin, country, country === "DE" ? rec : recAT]))[0].id;
  const de = await mk("DE");
  const at = await mk("AT");
  await as(mgrDE);
  await q("select public.release_batch($1)", [de]);
  await assert.rejects(() => q("select public.release_batch($1)", [at]), /forbidden/);
  await q("select public.reassign_batch($1,$2)", [de, rec]);
  await assert.rejects(() => q("select public.reassign_batch($1,$2)", [de, recAT]), /invalid_assignee/);
  await assert.rejects(() => q("select public.reassign_batch($1,$2)", [at, recAT]), /forbidden/);
});

test("calls this month count only outcomes of the caller", async () => {
  await db.exec("RESET ROLE");
  const b = (await q("insert into public.lead_batches(name,created_by,import_state,country,assigned_to) values ('M',$1,'confirmed','DE',$2) returning id", [admin, rec]))[0].id;
  const ls = await q("insert into public.leads(batch_id,company) select $1,'F'||g from generate_series(1,3) g returning id", [b]);
  await q("insert into public.status_changes(lead_id,user_id,old_status,new_status) values ($1,$2,'open','not_reached'),($3,$2,'open','no_interest'),($4,$5,'open','not_reached')", [ls[0].id, rec, ls[1].id, ls[2].id, vet]);
  await as(rec);
  const r = (await q("select public.get_caller_month() r"))[0].r;
  assert.equal(r.attempts, 2);
  await as(vet);
  assert.equal((await q("select public.get_caller_month() r"))[0].r.attempts, 1);
});
