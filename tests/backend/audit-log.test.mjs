import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";

const db = new PGlite();
const [admin, mgr, vet, rec, other] = Array.from({ length: 5 }, randomUUID);
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const as = async (id, role = "authenticated") => {
  await db.exec("RESET ROLE");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id ?? ""]);
  await db.exec("SET ROLE " + role);
};
let leads;
const future = (h) => new Date(Date.now() + h * 3600e3).toISOString();
const act = async (user, lead, name, x = {}) => {
  await as(user);
  const v = (await q("select version from public.leads where id=$1", [lead]))[0].version;
  return (
    await q("select public.record_lead_action($1,$2,$3,$4,$5,$6,$7,$8) r", [
      randomUUID(), lead, v, name, x.note ?? null, x.at ?? null, x.logo ?? null,
      x.details ? JSON.stringify(x.details) : null,
    ])
  )[0].r;
};
const lead = async (i) => {
  await db.exec("RESET ROLE");
  return (await q("select * from public.leads where id=$1", [leads[i]]))[0];
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
  const ids = { [admin]: "admin", [mgr]: "mgr", [vet]: "vet", [rec]: "rec", [other]: "other" };
  for (const [id, n] of Object.entries(ids)) await q("insert into auth.users values ($1,$2,$3)", [id, n + "@example.test", JSON.stringify({ display_name: n })]);
  await q("update public.user_roles set role='admin' where user_id=$1", [admin]);
  await q("update public.user_roles set role='manager' where user_id=$1", [mgr]);
  await q("update public.user_roles set role='veteran' where user_id=$1", [vet]);
  await q("delete from public.user_countries");
  await q("insert into public.user_countries select u,'DE' from unnest($1::uuid[]) u", [[mgr, vet, rec, other]]);
  const mk = async (owner) => (await q("insert into public.lead_batches(name,created_by,import_state,country,assigned_to) values ('B',$1,'confirmed','DE',$2) returning id", [admin, owner]))[0].id;
  const b1 = await mk(rec), b2 = await mk(vet);
  await q("insert into public.leads(batch_id,company,phone,email) select $1,'Rec '||g,'+49 1'||g,'r'||g||'@x.test' from generate_series(1,8) g", [b1]);
  await q("insert into public.leads(batch_id,company,phone) select $1,'Vet '||g,'+49 2'||g from generate_series(1,2) g", [b2]);
  leads = (await q("select id from public.leads order by company")).map((r) => r.id);
});
after(() => db.close());


const logs = async (user) => { await as(user); return (await q("select * from public.activity_audit_logs order by created_at,id")); };

test("presence: heartbeat, visible to the user and to staff of the same country only", async () => {
  await as(rec); await q("select public.heartbeat()");
  await as(other); await q("select public.heartbeat()");
  await as(rec);
  assert.equal((await q("select 1 from public.user_presence")).length, 1, "a caller only sees the own row");
  await as(mgr);
  const seen = (await q("select user_id,is_online from public.user_presence")).map((r) => r.user_id);
  assert.ok(seen.includes(rec) && seen.includes(other));
  await as(rec); await q("select public.set_offline()");
  await as(admin);
  assert.equal((await q("select is_online from public.user_presence where user_id=$1", [rec]))[0].is_online, false);
  await as(rec);
  await assert.rejects(() => q("update public.user_presence set last_seen_at=now()"), /permission denied/);
});

test("audit log: automatic entries for batches and roles, own entries for sessions and lists, append only", async () => {
  await db.exec("RESET ROLE");
  await q("update public.lead_batches set assigned_to=null where assigned_to is not null");
  await as(rec);
  await q("select public.log_activity('user_login','DE','session',null,null)");
  await assert.rejects(() => q("select public.log_activity('batch_deleted','DE')"), /forbidden/);
  await assert.rejects(() => q("select public.log_activity('list_viewed','DE','list',null,'Kein Interesse')"), /forbidden/);
  await as(mgr);
  await q("select public.log_activity('list_exported','DE','list',null,'Kein Interesse','{\"rows\":3}')");
  await assert.rejects(() => q("select public.log_activity('list_viewed','ALL')"), /forbidden/);
  await as(admin);
  await q("select public.set_user_role($1,'veteran')", [rec]);
  await db.exec("RESET ROLE");
  const b = (await q("select id from public.lead_batches where country='DE' limit 1"))[0].id;
  await as(rec);
  await q("update public.lead_batches set assigned_to=$1 where id=$2", [rec, b]).catch(() => null);
  await db.exec("RESET ROLE");
  await q("update public.lead_batches set assigned_to=$1 where id=$2", [rec, b]);
  const all = await logs(admin);
  const kinds = all.map((l) => l.action);
  for (const k of ["user_login", "list_exported", "user_role_changed", "batch_claimed"]) assert.ok(kinds.includes(k), k);
  const role = all.find((l) => l.action === "user_role_changed");
  assert.equal(role.actor_role, "admin");
  assert.equal(role.metadata.new_role, "veteran");
  assert.equal(all.find((l) => l.action === "list_exported").metadata.rows, 3);
  // managers see their country (and people of it), a caller sees nothing
  const m = await logs(mgr);
  assert.ok(m.length >= 1 && m.every((l) => l.country === "DE" || l.actor_id !== admin || l.country === "DE"));
  assert.equal((await logs(rec)).length, 0);
  // append only, for everybody
  for (const u of [rec, mgr, admin]) {
    await as(u);
    await assert.rejects(() => q("update public.activity_audit_logs set actor_name='x'"), /permission denied/);
    await assert.rejects(() => q("delete from public.activity_audit_logs"), /permission denied/);
    await assert.rejects(() => q("insert into public.activity_audit_logs(actor_name,actor_email,actor_role,action) values ('x','x','x','user_login')"), /permission denied/);
  }
  await db.exec("RESET ROLE");
  await assert.rejects(() => q("update public.activity_audit_logs set actor_name='x'"), /append_only/);
  await assert.rejects(() => q("delete from public.activity_audit_logs"), /append_only/);
});
