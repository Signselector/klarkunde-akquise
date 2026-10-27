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


const at = (days, h, m = 0) => {
  const d = new Date(Date.now() + days * 86400e3);
  d.setUTCHours(h, m, 0, 0);
  return d.toISOString();
};
const slotsFor = async (kind, from, to, lead = null) => (await q("select public.get_slot_availability('DE',$1,$2,$3,$4) r", [from, to, kind, lead]))[0].r;
const logo = (u, l) => `${u}/${l}/logo.png`;

test("at most 2 appointments at the same time; a third is refused", async () => {
  const t = at(10, 9);
  await act(rec, leads[0], "low_q", { note: "n", logo: logo(rec, leads[0]), at: t });
  await act(vet, leads[8], "low_q", { note: "n", logo: logo(vet, leads[8]), at: t });
  await assert.rejects(() => act(rec, leads[1], "low_q", { note: "n", logo: logo(rec, leads[1]), at: t }), /slot_full/);
  // an overlapping start (10 minutes later) counts as the same time, the next free slot works
  await assert.rejects(() => act(rec, leads[1], "low_q", { note: "n", logo: logo(rec, leads[1]), at: at(10, 9, 20) }), /slot_full/);
  const ok = await act(rec, leads[1], "low_q", { note: "n", logo: logo(rec, leads[1]), at: at(10, 10) });
  assert.ok(ok.appointment_id);
});

test("availability shows only counts, never who or what", async () => {
  await as(other);
  const r = await slotsFor("appointment", at(10, 8), at(10, 12));
  const full = r.find((x) => new Date(x.slot).getUTCHours() === 9 && new Date(x.slot).getUTCMinutes() === 0);
  assert.deepEqual(Object.keys(full).sort(), ["capacity", "slot", "used"]);
  assert.equal(full.used, 2);
  assert.equal(full.capacity, 2);
  await as(other);
  await assert.rejects(() => q("select public.get_slot_availability('AT',$1,$2,'appointment')", [at(10, 8), at(10, 12)]), /forbidden/);
  await assert.rejects(() => q("select 1 from public.pipedrive_busy"), /permission denied/, "no direct access to the mirror");
});

test("meetings from Pipedrive count, and a meeting created by the tool counts once", async () => {
  await db.exec("RESET ROLE");
  await db.exec("SET ROLE service_role");
  const start = at(12, 9), end = at(12, 9, 30);
  await q("select public.cal_replace_busy('DE',$1,$2,$3::jsonb)", [at(12, 0), at(13, 0), JSON.stringify([{ id: 901, starts_at: start, ends_at: end }, { id: 902, starts_at: start, ends_at: end }])]);
  await as(other);
  const r = await slotsFor("appointment", at(12, 8), at(12, 12));
  assert.equal(r.find((x) => new Date(x.slot).getUTCHours() === 9 && new Date(x.slot).getUTCMinutes() === 0).used, 2);
  await assert.rejects(() => act(rec, leads[2], "low_q", { note: "n", logo: logo(rec, leads[2]), at: start }), /slot_full/);
  // the tool's own appointment is also in Pipedrive: after the sync it must not be counted twice
  const free = at(12, 14);
  const r1 = await act(rec, leads[2], "low_q", { note: "n", logo: logo(rec, leads[2]), at: free });
  await db.exec("RESET ROLE");
  await q("update public.appointments set pd_activity_id=777 where id=$1", [r1.appointment_id]);
  await db.exec("SET ROLE service_role");
  await q("select public.cal_replace_busy('DE',$1,$2,$3::jsonb)", [at(12, 0), at(13, 0), JSON.stringify([
    { id: 901, starts_at: start, ends_at: end }, { id: 902, starts_at: start, ends_at: end },
    { id: 777, starts_at: free, ends_at: at(12, 14, 30) }])]);
  await as(other);
  const after = await slotsFor("appointment", at(12, 13), at(12, 16));
  assert.equal(after.find((x) => new Date(x.slot).getUTCHours() === 14 && new Date(x.slot).getUTCMinutes() === 0).used, 1);
});

test("callbacks are private; two own callbacks cannot overlap", async () => {
  const t = at(15, 9);
  await act(rec, leads[3], "callback", { at: t });
  // someone else is not affected and sees nothing of it
  await as(vet);
  assert.deepEqual(await slotsFor("callback", at(15, 8), at(15, 12)), []);
  await act(vet, leads[9], "callback", { at: t });
  // the same caller cannot book another callback in an overlapping window
  await assert.rejects(() => act(rec, leads[4], "callback", { at: at(15, 9, 10) }), /slot_conflict/);
  // the next quarter hour is free: a callback occupies 15 minutes only
  assert.ok((await act(rec, leads[4], "callback", { at: at(15, 9, 15) })).callback_id);
  const mine = await (async () => { await as(rec); return slotsFor("callback", at(15, 8), at(15, 12)); })();
  assert.ok(mine.some((x) => new Date(x.slot).getUTCHours() === 9 && x.used === 1 && x.capacity === 1));
  // rescheduling the same lead is not a collision with itself
  await as(rec);
  assert.ok((await slotsFor("callback", at(15, 8), at(15, 12), leads[3])).every((x) => !(new Date(x.slot).getUTCHours() === 9 && new Date(x.slot).getUTCMinutes() === 0)));
  // an own appointment blocks callbacks, a Pipedrive entry of the caller too
  await db.exec("RESET ROLE");
  await q("insert into public.pipedrive_activities(country,activity_id,user_id,due_at,duration_min) values ('DE',55,$1,$2,30)", [rec, at(15, 13)]);
  // an open Pipedrive entry blocks the callback slots it covers (13:00-13:30), 12:45 and 13:30 stay free
  await assert.rejects(() => act(rec, leads[5], "callback", { at: at(15, 13) }), /slot_conflict/);
  await assert.rejects(() => act(rec, leads[5], "callback", { at: at(15, 13, 15) }), /slot_conflict/);
  assert.ok((await act(rec, leads[5], "callback", { at: at(15, 12, 45) })).callback_id);
  assert.ok((await act(rec, leads[6], "callback", { at: at(15, 13, 30) })).callback_id);
});

test("callbacks do not use up appointment capacity", async () => {
  await as(rec);
  const r = await slotsFor("appointment", at(15, 8), at(15, 12));
  assert.ok(!r.some((x) => new Date(x.slot).getUTCHours() === 9));
});

test("callbacks grid: 15 minutes, an own appointment (30 min) blocks two callback slots; others' appointments do not matter", async () => {
  // others' appointments (the earlier tests booked 2 at day 10, 09:00): a callback of a third user there is fine
  assert.ok((await act(rec, leads[5], "callback", { at: at(10, 9) })).callback_id);
  // an own appointment 15:30-16:00 blocks the callback slots 15:30 and 15:45; 15:15 and 16:00 stay free
  await db.exec("RESET ROLE");
  await q("insert into public.appointments(user_id,lead_id,starts_at,country,booked_by) values ($1,$2,$3,'DE',$1)", [vet, leads[8], at(20, 15, 30)]);
  await as(vet);
  const blocked = (await slotsFor("callback", at(20, 15), at(20, 17))).map((x) => new Date(x.slot).toISOString());
  assert.deepEqual(blocked, [at(20, 15, 30), at(20, 15, 45)]);
  await assert.rejects(() => act(vet, leads[9], "callback", { at: at(20, 15, 30) }), /slot_conflict/);
  await assert.rejects(() => act(vet, leads[9], "callback", { at: at(20, 15, 45) }), /slot_conflict/);
  assert.ok((await act(vet, leads[9], "callback", { at: at(20, 15, 15) })).callback_id);
  assert.ok((await act(vet, leads[8], "callback", { at: at(20, 16) })).callback_id);
  // appointments stay on the 30-minute grid: the availability steps are 30 minutes apart
  await as(other);
  const steps = (await slotsFor("appointment", at(10, 8), at(10, 12))).map((x) => new Date(x.slot).getUTCMinutes());
  assert.ok(steps.every((m) => m === 0 || m === 30));
});

test("assigning an appointment moves it to the new person, re-queues it for Pipedrive and notifies", async () => {
  const l = leads[6];
  const r = await act(rec, l, "low_q", { note: "n", logo: logo(rec, l), at: at(30, 9) });
  await db.exec("RESET ROLE");
  await q("update public.appointments set pd_sync_state='synced',pd_activity_id=4711 where id=$1", [r.appointment_id]);
  await as(mgr);
  await q("select public.assign_appointment($1,$2)", [r.appointment_id, vet]);
  await db.exec("RESET ROLE");
  const ap = (await q("select user_id,pd_sync_state,pd_activity_id from public.appointments where id=$1", [r.appointment_id]))[0];
  assert.equal(ap.user_id, vet);
  assert.equal(ap.pd_sync_state, "pending");
  assert.equal(Number(ap.pd_activity_id), 4711, "the Pipedrive activity is moved, not duplicated");
  await as(vet);
  assert.equal((await q("select 1 from public.appointment_notifications where appointment_id=$1", [r.appointment_id])).length, 1);
  assert.equal((await q("select 1 from public.appointments where id=$1", [r.appointment_id])).length, 1);
  await as(rec);
  await assert.rejects(() => q("select public.assign_appointment($1,$2)", [r.appointment_id, rec]), /forbidden/);
});

test("appointments: callers need 3 days of lead time, managers 2; callbacks are not affected", async () => {
  const l = leads[7];
  await assert.rejects(() => act(rec, l, "low_q", { note: "n", logo: logo(rec, l), at: at(1, 9) }), /appointment_too_soon/);
  // the day after tomorrow is too early for a caller ...
  await assert.rejects(() => act(rec, l, "low_q", { note: "n", logo: logo(rec, l), at: at(2, 9) }), /appointment_too_soon/);
  // ... three days ahead is fine
  assert.ok((await act(rec, l, "low_q", { note: "n", logo: logo(rec, l), at: at(4, 9) })).appointment_id);
  // a manager booking for himself may start the day after tomorrow
  await as(mgr);
  const id = (await q("select public.save_calendar_appointment($1,'other','Intern',null,'DE',null,false) id", [at(2, 14)]))[0].id;
  assert.ok(id);
  await assert.rejects(() => q("select public.save_calendar_appointment($1,'other','Intern',null,'DE',null,false)", [at(1, 14)]), /appointment_too_soon/);
});

const contact = async (user, lead, patch) => {
  await as(user);
  const v = (await q("select version from public.leads where id=$1", [lead]))[0].version;
  return (await q("select public.update_lead_contact($1,$2,$3::jsonb) r", [lead, v, JSON.stringify(patch)]))[0].r;
};

test("callers edit the customer data of their own leads, website and address land in the imported columns", async () => {
  const l = leads[2];
  await db.exec("RESET ROLE");
  await q("update public.leads set extra=$2::jsonb where id=$1", [l, JSON.stringify({ Website: "alt.example", Adresse: "Alte Str. 1", Branche: "Bau" })]);
  const r = await contact(rec, l, { contact_name: " Eva Neu ", phone: "+49 30 1", email: "Eva@Neu.Example", website: "neu.example", address: "Neue Str. 2", city: "Berlin" });
  assert.equal(r.contact_name, "Eva Neu");
  assert.equal(r.email, "eva@neu.example");
  assert.deepEqual(r.extra, { Website: "neu.example", Adresse: "Neue Str. 2", Branche: "Bau" }, "existing keys are reused, others stay");
  const cleared = await contact(rec, l, { website: "" });
  assert.equal("Website" in cleared.extra, false);
  await assert.rejects(() => contact(rec, l, { email: "kaputt" }), /invalid_email/);
  await assert.rejects(() => contact(rec, l, { status: "open" }), /invalid_contact/);
  await assert.rejects(() => contact(other, l, { phone: "1" }), /not_your_lead/);
  assert.ok((await contact(mgr, l, { city: "Köln" })).city === "Köln", "admins of the country may edit");
});
