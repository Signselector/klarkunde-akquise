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



const rpc = async (user, ...a) => { await as(user); return (await q("select public.get_country_period_stats($1,$2,$3,$4,$5) r", a))[0].r; };
const span = () => { const f = new Date(Date.now() - 3600e3).toISOString(), t = new Date(Date.now() + 3600e3).toISOString(); return [f, t]; };

test("country stats: totals, outcomes, team, one employee, only for staff of the country", async () => {
  await act(rec, leads[0], "not_reached");
  await act(rec, leads[1], "no_interest", { note: "n" });
  await act(rec, leads[2], "callback", { at: new Date(Date.now() + 5 * 86400e3).toISOString() });
  await act(vet, leads[8], "on_hold", { note: "später", details: { month: new Date(Date.now() + 60 * 86400e3).toISOString().slice(0, 7) } });
  await act(vet, leads[9], "not_reached");
  const [f, t] = span();
  const all = await rpc(mgr, "DE", f, t, null, "day");
  assert.equal(all.totals.calls, 5);
  assert.equal(all.totals.reached, 3);
  assert.equal(all.totals.reach_rate, 60);
  assert.equal(all.totals.deals, 1);
  assert.equal(all.by_outcome.not_reached, 2);
  assert.equal(all.by_outcome.on_hold, 1);
  assert.equal(all.timeline.reduce((s, x) => s + x.calls, 0), 5);
  const byName = Object.fromEntries(all.team.map((m) => [m.name, m]));
  assert.equal(byName.rec.calls, 3);
  assert.equal(byName.vet.calls, 2);
  assert.equal(byName.vet.deals, 1);
  assert.equal(byName.rec.role, "recruit");
  const one = await rpc(mgr, "DE", f, t, vet, "hour");
  assert.equal(one.totals.calls, 2);
  assert.equal(one.team, null);
  assert.equal(one.timeline.length, 24);
  // another country has none of these numbers
  await as(admin);
  const at = await rpc(admin, "AT", f, t, null, "day");
  assert.equal(at.totals.calls, 0);
  // callers and managers of other countries are refused
  await assert.rejects(() => rpc(rec, "DE", f, t, null, "day"), /forbidden/);
  await assert.rejects(() => rpc(mgr, "AT", f, t, null, "day"), /forbidden/);
  await assert.rejects(() => rpc(mgr, "DE", t, f, null, "day"), /validation_failed/);
});
