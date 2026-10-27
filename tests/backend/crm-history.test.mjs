import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";

const db = new PGlite();
const admin = randomUUID(),
  anna = randomUUID(),
  ben = randomUUID();
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
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
let batch, leads;

before(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 GRANT USAGE ON SCHEMA auth TO authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;`);
  for (const file of (await readdir(new URL("../../drizzle/migrations/", import.meta.url)))
    .filter((x) => x.endsWith(".sql"))
    .sort()) {
    const sql = (
      await readFile(new URL("../../drizzle/migrations/" + file, import.meta.url), "utf8")
    )
      .replace(/^CREATE EXTENSION IF NOT EXISTS pg_cron;$/m, "")
      .replace(/^SELECT cron\.schedule\(.*$/m, "");
    await db.exec(sql);
  }
  await db.query(
    "insert into auth.users values ($1,'admin@example.test','{\"display_name\":\"Admin\"}'),($2,'anna@example.test','{\"display_name\":\"Anna\"}'),($3,'ben@example.test','{\"display_name\":\"Ben\"}')",
    [admin, anna, ben],
  );
  await db.query("update public.user_roles set role='admin' where user_id=$1", [admin]);
  await db.query(
    "insert into public.user_countries(user_id,country) values ($1,'DE'),($2,'DE'),($3,'DE') on conflict do nothing",
    [admin, anna, ben],
  );
  batch = (
    await q(
      "insert into public.lead_batches(name,created_by,import_state,country,assigned_to) values ('Test DE',$1,'confirmed','DE',$2) returning id",
      [admin, anna],
    )
  )[0].id;
  await q(
    "insert into public.leads(batch_id,company,phone,email) select $1,'Firma '||g,'+49 30 55500'||g,'f'||g||'@example.test' from generate_series(1,8) g",
    [batch],
  );
  leads = (await q("select id from public.leads where batch_id=$1 order by phone", [batch])).map(
    (r) => r.id,
  );
});
after(() => db.close());

const act = (user, lead, name, extra = {}) =>
  as(user).then(async () => {
    const v = (await q("select version from public.leads where id=$1", [lead]))[0].version;
    return rpc("record_lead_action", [
      randomUUID(),
      lead,
      v,
      name,
      extra.note ?? null,
      extra.at ?? null,
      extra.logo ?? null,
      extra.details ? JSON.stringify(extra.details) : null,
    ]);
  });
const mail = async (user, lead, kind) => {
  await db.exec("RESET ROLE");
  const id = randomUUID();
  await q(
    "insert into public.lead_emails(id,lead_id,created_by,kind,to_email,subject,body,status,request_id) values ($1,$2,$3,$4,'k@example.test','S','B','simulated',$5)",
    [id, lead, user, kind, randomUUID()],
  );
  return id;
};
const service = () => as(null, "service_role");
const link = async (lead) => {
  await db.exec("RESET ROLE");
  return (await q("select * from public.lead_crm_links where lead_id=$1", [lead]))[0];
};
const history = async (lead) => {
  await db.exec("RESET ROLE");
  return q(
    "select action_type,previous_stage,new_stage,source,acting_user_id,origin_caller_id,deal_id from public.lead_activity where lead_id=$1 order by occurred_at,seq",
    [lead],
  );
};
const stage = (deal, id, event, extra = {}) =>
  rpc("crm_apply_stage", [
    "DE",
    deal,
    id,
    event,
    extra.at ?? new Date().toISOString(),
    extra.source ?? "pipedrive",
    extra.actor ?? null,
    extra.name ?? "Fulfillment",
    extra.status ?? null,
    null,
  ]);
const future = (h = 1) => new Date(Date.now() + h * 3600e3).toISOString();

test("Referenzmail: no deal, original caller is fixed, no customer", async () => {
  const lead = leads[0];
  const m = await mail(anna, lead, "reference_mail");
  const done = await act(anna, lead, "reference_mail", { details: { email_id: m } });
  assert.equal(done.stage_key, null);
  let l = await link(lead);
  assert.equal(l.origin_caller_id, anna);
  assert.equal(l.origin_lead_id, lead);
  assert.equal(l.deal_id, null);
  assert.equal(l.is_customer, false, "Referenzmail does not make a customer");
  await as(anna);
  assert.deepEqual(await rpc("get_my_customers", ["DE"]), []);
  await service();
  // a deal created later (after a reply) keeps the original caller
  const saved = await rpc("crm_save_links", [lead, "DE", 11, 12, 5001, anna, "contact_saved", anna]);
  assert.equal(saved.deal_created, true);
  l = await link(lead);
  assert.equal(l.origin_caller_id, anna);
  assert.equal(Number(l.deal_id), 5001);
});

test("original caller and deal can never be overwritten", async () => {
  const lead = leads[0];
  await db.exec("RESET ROLE");
  await assert.rejects(
    () => q("update public.lead_crm_links set origin_caller_id=$1 where lead_id=$2", [ben, lead]),
    /origin_caller_immutable/,
  );
  await assert.rejects(
    () => q("update public.lead_crm_links set deal_id=77 where lead_id=$1", [lead]),
    /deal_immutable/,
  );
  // An admin acting later does not change the attribution.
  await act(admin, lead, "not_reached");
  assert.equal((await link(lead)).origin_caller_id, anna);
  // Saving links again never creates a second deal or replaces the first.
  await service();
  const again = await rpc("crm_save_links", [lead, "DE", 11, 12, 5999, ben, "contact_saved", ben]);
  assert.equal(again.deal_created, false);
  assert.equal(Number((await link(lead)).deal_id), 5001);
  assert.equal((await link(lead)).origin_caller_id, anna);
});

test("the same CRM deal cannot be linked to two leads", async () => {
  await service();
  await db.exec("RESET ROLE");
  await q("insert into public.lead_crm_links(lead_id,country) values ($1,'DE')", [leads[7]]);
  await assert.rejects(
    () => q("update public.lead_crm_links set deal_id=5001 where lead_id=$1", [leads[7]]),
    /lead_crm_links_deal_unique/,
  );
  await q("delete from public.lead_crm_links where lead_id=$1", [leads[7]]);
});

test("a later Pipedrive stage change makes the deal a customer of the original caller", async () => {
  const lead = leads[0];
  await service();
  const r = await stage(5001, 8, "evt-1", { name: "Fulfillment" });
  assert.equal(r.applied, true);
  assert.equal(r.stage_key, "low_q");
  assert.equal(r.customer_assigned, true);
  const l = await link(lead);
  assert.equal(l.current_stage_key, "low_q");
  assert.equal(l.is_customer, true);
  assert.equal(l.origin_caller_id, anna, "still the original caller");
  await as(anna);
  const mine = await rpc("get_my_customers", ["DE"]);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].stage_key, "low_q");
  await as(ben);
  assert.deepEqual(await rpc("get_my_customers", ["DE"]), [], "other callers see nothing");
  // And later changes keep working, the deal stays a customer.
  await service();
  await stage(5001, 11, "evt-2");
  await stage(5001, 23, "evt-3");
  assert.equal((await link(lead)).is_customer, true);
  const h = await history(lead);
  const changes = h.filter((e) => e.action_type === "stage_change");
  assert.deepEqual(
    changes.map((e) => [e.previous_stage, e.new_stage, e.source]),
    [
      ["contact_saved", "low_q", "pipedrive"],
      ["low_q", "rd_done", "pipedrive"],
      ["rd_done", "offer", "pipedrive"],
    ],
  );
  assert.ok(h.some((e) => e.action_type === "customer_assigned"));
  assert.ok(h.some((e) => e.action_type === "offer_created"));
  assert.ok(h.every((e) => e.deal_id === null || Number(e.deal_id) === 5001));
  assert.equal(h.filter((e) => e.action_type === "customer_assigned").length, 1);
});

test("webhook deliveries are idempotent and late events cannot undo newer ones", async () => {
  const lead = leads[0];
  await service();
  const before = (await history(lead)).length;
  const dup = await stage(5001, 23, "evt-3");
  assert.equal(dup.applied, false);
  assert.equal(dup.reason, "duplicate");
  await service();
  const same = await stage(5001, 23, "evt-3b");
  assert.equal(same.applied, false, "no change, no entry");
  assert.equal((await history(lead)).length, before);
  const old = await stage(5001, 8, "evt-old", { at: "2020-01-01T00:00:00Z" });
  assert.equal(old.reason, "stale");
  assert.equal((await link(lead)).current_stage_key, "offer");
  const unknown = await stage(424242, 8, "evt-x");
  assert.equal(unknown.reason, "unknown_deal");
});

test("won and lost deals are recorded once", async () => {
  const lead = leads[0];
  await service();
  const w = await stage(5001, 23, "evt-won", { status: "won" });
  assert.equal(w.applied, true);
  await stage(5001, 23, "evt-won-2", { status: "won" });
  const h = await history(lead);
  assert.equal(h.filter((e) => e.action_type === "deal_won").length, 1);
  assert.equal((await link(lead)).deal_status, "won");
});

test("history is append only and readable only by involved users", async () => {
  const lead = leads[0];
  await db.exec("RESET ROLE");
  await assert.rejects(() => q("update public.lead_activity set action_type='x'"), /append_only/);
  await assert.rejects(() => q("delete from public.lead_activity"), /append_only/);
  await as(anna);
  assert.ok(
    (await q("select 1 from public.lead_activity where lead_id=$1", [lead])).length > 3,
    "origin caller reads the timeline",
  );
  await as(ben);
  assert.equal((await q("select 1 from public.lead_activity where lead_id=$1", [lead])).length, 0);
  // Removing a lead for good may still cascade.
  await db.exec("RESET ROLE");
  const tmp = (
    await q("insert into public.leads(batch_id,company) values ($1,'Weg') returning id", [batch])
  )[0].id;
  await q("delete from public.leads where id=$1", [tmp]);
});

test("every action lands in the history with who did it", async () => {
  const lead = leads[1];
  await act(anna, lead, "not_reached");
  await act(anna, lead, "callback", { at: future(2), note: "später" });
  await act(anna, lead, "no_interest");
  const h = await history(lead);
  assert.deepEqual(
    h.map((e) => e.action_type),
    ["lead_created", "first_contact", "not_reached", "callback", "no_interest"],
  );
  assert.ok(h.slice(1).every((e) => e.acting_user_id === anna));
  // a replayed request does not write the history twice
  await as(anna);
  const id = randomUUID();
  const v = (await q("select version from public.leads where id=$1", [leads[2]]))[0].version;
  await rpc("record_lead_action", [id, leads[2], v, "not_reached", null, null, null, null]);
  await rpc("record_lead_action", [id, leads[2], v, "not_reached", null, null, null, null]);
  assert.equal((await history(leads[2])).filter((e) => e.action_type === "not_reached").length, 1);
});

test("Rückruf and Nicht erreicht stay in Offene Leads; the rest is completed", async () => {
  await act(anna, leads[3], "callback", { at: future(3) });
  await act(anna, leads[4], "not_reached");
  await act(anna, leads[5], "no_interest");
  await act(anna, leads[6], "waiting_3d", { note: "Logo kommt" });
  await as(anna);
  const done = await rpc("get_completed_overview", ["DE", 100]);
  const ids = done.map((d) => d.lead_id);
  assert.ok(!ids.includes(leads[3]), "Rückruf stays open");
  assert.ok(!ids.includes(leads[4]), "Nicht erreicht stays open");
  assert.ok(ids.includes(leads[5]));
  assert.ok(ids.includes(leads[6]));
  const w = done.find((d) => d.lead_id === leads[6]);
  assert.equal(w.origin_caller_name, "Anna");
  assert.equal(w.action, "waiting_3d");
  assert.ok(w.completed_at && w.last_activity_at);
  await as(ben);
  assert.deepEqual(await rpc("get_completed_overview", ["DE", 100]), []);
});

test("a confirmed e-mail is logged once; failures complete nothing", async () => {
  const lead = leads[7];
  await db.exec("RESET ROLE");
  const id = randomUUID();
  await q(
    "insert into public.lead_emails(id,lead_id,created_by,kind,to_email,subject,body,status,request_id) values ($1,$2,$3,'contact_details','k@example.test','S','B','failed',$4)",
    [id, lead, anna, randomUUID()],
  );
  assert.equal((await history(lead)).filter((e) => e.action_type === "email_sent").length, 0);
  await q("update public.lead_emails set status='sent',sent_at=now() where id=$1", [id]);
  await q("update public.lead_emails set provider_message_id='m1' where id=$1", [id]);
  assert.equal((await history(lead)).filter((e) => e.action_type === "email_sent").length, 1);
  await assert.rejects(
    () =>
      q(
        "insert into public.lead_emails(lead_id,created_by,kind,to_email,subject,body,request_id) values ($1,$2,'contact_details','kaputt','S','B',$3)",
        [lead, anna, randomUUID()],
      ),
    /to_email/,
  );
});

test("performance: qualified leads count once per lead, deals and wins per original caller", async () => {
  // Ben qualifies one lead twice (Low Q, later High Q) and Anna's customer deal was won above.
  const bl = (
    await q("insert into public.lead_batches(name,created_by,import_state,country,assigned_to) values ('B',$1,'confirmed','DE',$2) returning id", [admin, ben])
  )[0].id;
  await q("insert into public.leads(batch_id,company) select $1,'B'||g from generate_series(1,3) g", [bl]);
  const bleads = (await q("select id from public.leads where batch_id=$1 order by company", [bl])).map((r) => r.id);
  await act(ben, bleads[0], "low_q", { note: "n", logo: `${ben}/${bleads[0]}/a.png`, at: future(24) });
  await act(ben, bleads[0], "high_q", {
    note: "n",
    logo: `${ben}/${bleads[0]}/b.png`,
    at: future(30),
    details: { photo_path: `${ben}/${bleads[0]}/haus.jpg` },
  });
  await act(ben, bleads[1], "not_reached");
  await act(ben, bleads[2], "no_interest");
  await service();
  await rpc("crm_save_links", [bleads[0], "DE", 1, 2, 6001, ben, "low_q", ben]);
  await as(ben);
  const own = await rpc("get_caller_performance", [
    new Date(Date.now() - 86400e3).toISOString().slice(0, 10),
    new Date(Date.now() + 86400e3).toISOString().slice(0, 10),
    "month",
    null,
  ]);
  assert.equal(own.length, 1);
  assert.equal(own[0].user_id, ben);
  assert.equal(own[0].qualified, 1, "Low Q then High Q is one qualified lead");
  assert.equal(own[0].processed, 3);
  assert.equal(own[0].per_100, 33.33);
  assert.equal(own[0].deals, 1);
  assert.equal(own[0].won, 0);
  await as(admin);
  const all = await rpc("get_caller_performance", [
    new Date(Date.now() - 86400e3).toISOString().slice(0, 10),
    new Date(Date.now() + 86400e3).toISOString().slice(0, 10),
    "day",
    null,
  ]);
  const anna1 = all.find((r) => r.user_id === anna);
  assert.equal(anna1.won, 1);
  assert.equal(anna1.conversion, 100);
  await as(ben);
  await assert.rejects(
    () => rpc("get_caller_performance", ["2026-01-01", "2026-01-02", "year", null]),
    /validation_failed/,
  );
});
