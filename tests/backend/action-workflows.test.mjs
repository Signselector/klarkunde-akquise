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

test("Logo Render: appointment + logo, recruit's appointment goes to the manager, lead is completed", async () => {
  const l = leads[0];
  const r = await act(rec, l, "low_q", { note: "n", logo: `${rec}/${l}/logo.png`, at: future(48) });
  assert.equal(r.stage_key, "low_q");
  assert.equal(r.status, "low_q");
  assert.equal(r.appointment_owner, mgr);
  await db.exec("RESET ROLE");
  const ap = (await q("select * from public.appointments where id=$1", [r.appointment_id]))[0];
  assert.equal(ap.user_id, mgr);
  assert.equal(ap.booked_by, rec);
  assert.equal(ap.lead_id, l);
  assert.equal(ap.country, "DE");
  assert.equal(ap.pd_sync_state, "pending", "waits for the Pipedrive calendar sync");
  await as(rec);
  assert.equal((await q("select 1 from public.appointments")).length, 1, "the recruit sees what was booked through the tool");
  await as(other);
  assert.equal((await q("select 1 from public.appointments")).length, 1, "every role sees all appointments of its country");
  await as(mgr);
  assert.equal((await q("select 1 from public.appointments")).length, 1);
});

test("a veteran's appointment stays with the veteran", async () => {
  const l = leads[8];
  const r = await act(vet, l, "low_q", { note: "n", logo: `${vet}/${l}/l.png`, at: future(24) });
  assert.equal(r.appointment_owner, vet);
});

test("Realismus Render additionally needs the building photo", async () => {
  const l = leads[1];
  const base = { note: "n", logo: `${rec}/${l}/logo.png`, at: future(24) };
  await assert.rejects(() => act(rec, l, "high_q", base), /photo_required/);
  await assert.rejects(() => act(rec, l, "high_q", { ...base, details: { photo_path: `${other}/${l}/x.jpg` } }), /photo_required/);
  const r = await act(rec, l, "high_q", { ...base, details: { photo_path: `${rec}/${l}/haus.jpg` } });
  assert.equal(r.stage_key, "high_q");
  assert.ok(r.appointment_id);
  await db.exec("RESET ROLE");
  const a = (await q("select details from public.lead_actions where lead_id=$1", [l]))[0];
  assert.equal(a.details.photo_path, `${rec}/${l}/haus.jpg`);
});

test("Rückruf creates only a callback and the lead stays open; Nicht erreicht too", async () => {
  const r = await act(rec, leads[2], "callback", { at: future(5) });
  assert.equal(r.status, "callback");
  assert.equal(r.appointment_id, null);
  assert.ok(r.callback_id);
  assert.equal(r.stage_key, null);
  const n = await act(rec, leads[3], "not_reached");
  assert.equal(n.status, "open");
  assert.equal(n.crm_sync_state, null);
  await db.exec("RESET ROLE");
  assert.equal((await q("select count(*)::int n from public.appointments where lead_id=any($1)", [[leads[2], leads[3]]]))[0].n, 0);
});

test("Kein Interesse without the tick is kept for the admin list; with it the lead is erased", async () => {
  const keep = leads[4], erase = leads[5];
  const k = await act(rec, keep, "no_interest", { note: "zu teuer" });
  assert.equal(k.erased, false);
  assert.equal(k.stage_key, null);
  const e = await act(rec, erase, "no_interest", { note: "bitte nie wieder", details: { do_not_call: true } });
  assert.equal(e.erased, true);
  const erased = await lead(5);
  assert.equal(erased.company, null);
  assert.equal(erased.phone, null);
  assert.equal(erased.email, null);
  assert.deepEqual(erased.extra, {});
  assert.ok(erased.erased_at && erased.archived_at);
  await db.exec("RESET ROLE");
  assert.equal((await q("select 1 from public.lead_notes where lead_id=$1", [erase])).length, 0);
  assert.equal((await q("select count(*)::int n from public.status_changes where lead_id=$1", [erase]))[0].n, 1, "statistics keep the attempt");
  assert.ok((await q("select 1 from public.audit_events where action='lead_erased' and target_id=$1", [erase])).length === 1);
  // admin list: only the kept lead, only for people with admin rights in the country
  await as(mgr);
  const list = (await q("select public.get_no_interest_leads('DE') r"))[0].r;
  assert.deepEqual(list.map((x) => x.lead_id), [keep]);
  assert.equal(list[0].caller, "rec");
  assert.equal(list[0].note, "zu teuer");
  await as(rec);
  await assert.rejects(() => q("select public.get_no_interest_leads('DE')"), /forbidden/);
  await as(vet);
  await assert.rejects(() => q("select public.get_no_interest_leads('DE')"), /forbidden/);
});

test("Zukunftsprojekt: the deal is queued only when the chosen month has started, once", async () => {
  const soon = leads[6], later = leads[7];
  const now = new Date();
  const thisMonth = now.toISOString().slice(0, 7);
  const nextYear = `${now.getUTCFullYear() + 1}-01`;
  const a = await act(rec, soon, "on_hold", { note: "Budget kommt", details: { month: thisMonth } });
  const b = await act(rec, later, "on_hold", { note: "nächstes Jahr", details: { month: nextYear } });
  assert.equal(a.crm_sync_state, null);
  assert.equal(b.crm_sync_state, null);
  await as(null, "service_role");
  const ids = (await q("select public.activate_future_projects() r"))[0].r;
  assert.equal(ids.length, 1, "only the lead whose month has started");
  await db.exec("RESET ROLE");
  const due = (await q("select * from public.lead_actions where id=$1", [ids[0]]))[0];
  assert.equal(due.lead_id, soon);
  assert.equal(due.user_id, rec, "original caller");
  assert.equal(due.stage_key, "on_hold");
  assert.equal(due.crm_sync_state, "queued");
  await as(null, "service_role");
  assert.deepEqual((await q("select public.activate_future_projects() r"))[0].r, [], "never twice");
  await db.exec("RESET ROLE");
  assert.equal((await q("select origin_caller_id from public.lead_crm_links where lead_id=$1", [soon]))[0].origin_caller_id, rec);
});
