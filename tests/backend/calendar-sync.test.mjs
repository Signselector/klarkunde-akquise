import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";

const db = new PGlite();
const [admin, anna, ben] = [randomUUID(), randomUUID(), randomUUID()];
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const as = async (id, role = "authenticated") => {
  await db.exec("RESET ROLE");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id ?? ""]);
  await db.exec("SET ROLE " + role);
};
const apply = async (user, a) => {
  await as(null, "service_role");
  return (await q("select public.cal_apply_activity('DE',$1,$2) r", [user, JSON.stringify(a)]))[0].r;
};
let cbId, apId;

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
  await q("insert into auth.users values ($1,'admin@example.test','{}'),($2,'anna@example.test','{}'),($3,'ben@example.test','{}')", [admin, anna, ben]);
  await q("update public.user_roles set role='admin' where user_id=$1", [admin]);
  await q("insert into public.user_countries values ($1,'DE'),($2,'DE'),($3,'DE') on conflict do nothing", [admin, anna, ben]);
  const b = (await q("insert into public.lead_batches(name,created_by,import_state,country,assigned_to) values ('B',$1,'confirmed','DE',$2) returning id", [admin, anna]))[0].id;
  const lead = (await q("insert into public.leads(batch_id,company) values ($1,'Firma') returning id", [b]))[0].id;
  cbId = (await q("insert into public.callbacks(lead_id,user_id,due_at,country,pd_sync_state) values ($1,$2,now()+interval '1 day','DE','synced') returning id", [lead, anna]))[0].id;
  await q("insert into public.callbacks(lead_id,user_id,due_at,country) values ($1,$2,now()+interval '2 day','DE')", [lead, ben]);
  apId = (await q("insert into public.appointments(user_id,starts_at,title,country,pd_sync_state) values ($1,now()+interval '3 day','Demo','DE','synced') returning id", [anna]))[0].id;
  await q("insert into public.appointments(user_id,starts_at,title,country) values ($1,now()+interval '4 day','Ben-Demo','DE')", [ben]);
});
after(() => db.close());

test("callbacks are private; appointments only for the owner and for managers and up", async () => {
  for (const [user, own] of [[anna, 1], [ben, 1], [admin, 0]]) {
    await as(user);
    assert.equal((await q("select 1 from public.callbacks")).length, own);
    assert.equal((await q("select 1 from public.appointments")).length, user === admin ? 2 : 1);
  }
});

test("new items wait for the sync; a pulled change moves our own item, foreign ones are mirrored", async () => {
  await db.exec("RESET ROLE");
  await q("update public.callbacks set pd_activity_id=900 where id=$1", [cbId]);
  await q("update public.appointments set pd_activity_id=901 where id=$1", [apId]);
  const moved = new Date(Date.now() + 5 * 86400e3).toISOString();
  assert.equal(await apply(anna, { id: 900, subject: "Rückruf", type: "call", due_at: moved, done: false }), "callback");
  assert.equal(await apply(anna, { id: 901, subject: "Demo", type: "meeting", due_at: moved }), "appointment");
  await db.exec("RESET ROLE");
  assert.equal(new Date((await q("select due_at from public.callbacks where id=$1", [cbId]))[0].due_at).toISOString(), moved);
  assert.equal(new Date((await q("select starts_at from public.appointments where id=$1", [apId]))[0].starts_at).toISOString(), moved);
  assert.equal(await apply(anna, { id: 777, subject: "Von Hand", type: "task", due_at: moved, deal_id: 5, person_name: "P" }), "external");
  assert.equal(await apply(anna, { id: 777, subject: "Von Hand 2", type: "task", due_at: moved }), "external", "again: updated, not duplicated");
  await db.exec("RESET ROLE");
  assert.equal((await q("select 1 from public.pipedrive_activities")).length, 1);
  await as(anna);
  assert.equal((await q("select subject from public.pipedrive_activities"))[0].subject, "Von Hand 2");
  await as(ben);
  assert.equal((await q("select 1 from public.pipedrive_activities")).length, 0, "not visible to others");
});

test("a callback closed in Pipedrive is not sent back; callbacks are never queued for Pipedrive", async () => {
  await apply(anna, { id: 900, subject: "Rückruf", type: "call", due_at: new Date(Date.now() + 86400e3).toISOString(), done: true });
  await db.exec("RESET ROLE");
  assert.equal((await q("select done from public.callbacks where id=$1", [cbId]))[0].done, true);
  assert.equal((await q("select 1 from public.pd_calendar_queue")).length, 0);
  const lead = (await q("select id from public.leads limit 1"))[0].id;
  const cb2 = (await q("insert into public.callbacks(lead_id,user_id,due_at,country,pd_activity_id,pd_sync_state) values ($1,$2,now()+interval '9 day','DE',950,'synced') returning id", [lead, anna]))[0].id;
  await q("update public.callbacks set done=true where id=$1", [cb2]);
  const queue = await q("select activity_id,action from public.pd_calendar_queue");
  assert.deepEqual(queue, []);
});

test("a deleted appointment is queued for deletion in Pipedrive", async () => {
  await db.exec("RESET ROLE");
  await q("delete from public.appointments where id=$1", [apId]);
  assert.ok((await q("select 1 from public.pd_calendar_queue where action='delete' and activity_id=901")).length === 1);
});

test("pruning removes only vanished mirrored activities inside the window", async () => {
  await as(null, "service_role");
  const far = new Date(Date.now() + 200 * 86400e3).toISOString();
  await apply(anna, { id: 778, subject: "weit weg", type: "task", due_at: far });
  await as(null, "service_role");
  const from = new Date(Date.now() - 86400e3).toISOString();
  const to = new Date(Date.now() + 60 * 86400e3).toISOString();
  const n = (await q("select public.cal_prune('DE',$1,$2,$3,$4::bigint[]) n", [anna, from, to, []]))[0].n;
  assert.equal(n, 1, "777 is gone, 778 is outside the window");
  await db.exec("RESET ROLE");
  assert.equal((await q("select activity_id from public.pipedrive_activities")).map((r) => Number(r.activity_id)).join(), "778");
});
