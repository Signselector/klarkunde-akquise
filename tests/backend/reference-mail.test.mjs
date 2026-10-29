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


const mail = async (user, lead, to, status = "sent", msg = null) => {
  await db.exec("RESET ROLE");
  return (
    await q(
      "insert into public.lead_emails(lead_id,created_by,kind,to_email,subject,body,status,request_id,provider_message_id,sent_at) values ($1,$2,'reference_mail',$3,'Referenzen','Text',$4,gen_random_uuid(),$5,now()) returning id",
      [lead, user, to, status, msg],
    )
  )[0].id;
};
const service = async () => {
  await db.exec("RESET ROLE");
  await db.exec("SET ROLE service_role");
};

test("Referenzmail: lead completed, no CRM stage, original caller stored", async () => {
  const l = leads[0];
  const m = await mail(rec, l, "r1@x.test");
  const r = await act(rec, l, "reference_mail", { details: { email_id: m } });
  assert.equal(r.stage_key, null);
  assert.equal(r.crm_sync_state, null);
  assert.equal((await lead(0)).status, "reference_mail");
  await db.exec("RESET ROLE");
  const k = (await q("select * from public.lead_crm_links where lead_id=$1", [l]))[0];
  assert.equal(k.origin_caller_id, rec);
  assert.equal(k.deal_id, null);
  const a = (await q("select crm_sync_state,stage_key from public.lead_actions where lead_id=$1", [l]))[0];
  assert.equal(a.stage_key, null);
});

test("a reply sends the lead back to the original caller as a due callback", async () => {
  const l = leads[1];
  const m = await mail(rec, l, "r2@x.test", "sent", "msg-2");
  await act(rec, l, "reference_mail", { details: { email_id: m } });
  // somebody else works on the lead later; the original caller must still get it back
  await db.exec("RESET ROLE");
  await q("update public.leads set last_called_by=$1 where id=$2", [vet, l]);
  await service();
  const miss = (await q("select public.register_reference_reply('nobody@x.test','{}') r"))[0].r;
  assert.equal(miss.matched, false);
  const hit = (await q("select public.register_reference_reply('R2@X.test','{}') r"))[0].r;
  assert.equal(hit.matched, true);
  assert.equal(hit.assigned_to, rec);
  const again = (await q("select public.register_reference_reply('r2@x.test','{}') r"))[0].r;
  assert.equal(again.matched, false, "a second delivery changes nothing");
  const row = await lead(1);
  assert.equal(row.status, "callback");
  assert.equal(row.last_called_by, rec);
  const cb = await q("select user_id,done from public.callbacks where lead_id=$1 and not done", [l]);
  assert.equal(cb.length, 1);
  assert.equal(cb[0].user_id, rec);
  await as(rec);
  const next = (await q("select public.claim_next_lead('DE') r"))[0].r;
  assert.equal(next.lead.id, l, "the original caller is offered the lead");
});

test("matching by message id wins over the address", async () => {
  const l = leads[2];
  const m = await mail(rec, l, "r3@x.test", "sent", "msg-3");
  await act(rec, l, "reference_mail", { details: { email_id: m } });
  await service();
  const hit = (await q("select public.register_reference_reply('other@x.test','{msg-3}') r"))[0].r;
  assert.equal(hit.matched, true);
  assert.equal(hit.lead_id, l);
});

test("no reply after 3 months: admin list with the original caller id", async () => {
  const [young, old, answered] = [leads[3], leads[4], leads[5]];
  for (const l of [young, old, answered]) {
    const m = await mail(rec, l, `x${l.slice(0, 4)}@x.test`);
    await act(rec, l, "reference_mail", { details: { email_id: m } });
  }
  await db.exec("RESET ROLE");
  await q("update public.lead_emails set sent_at=now()-interval '100 days' where lead_id=any($1)", [[old, answered]]);
  await q("update public.lead_emails set replied_at=now() where lead_id=$1", [answered]);
  // the last caller differs from the original one; the list still names the original
  await q("update public.leads set last_called_by=$1 where id=$2", [vet, old]);
  await as(mgr);
  const list = (await q("select public.get_unanswered_reference_leads('DE') r"))[0].r;
  const ids = list.map((x) => x.lead_id);
  assert.ok(ids.includes(old));
  assert.ok(!ids.includes(young));
  assert.ok(!ids.includes(answered));
  const row = list.find((x) => x.lead_id === old);
  assert.equal(row.caller_id, rec);
  await as(rec);
  await assert.rejects(() => q("select public.get_unanswered_reference_leads('DE')"), /forbidden/);
  await as(other);
  await assert.rejects(() => q("select public.get_unanswered_reference_leads('DE')"), /forbidden/);
});

test("Referenzmail: a callback can be planned right away", async () => {
  const l = leads[2];
  const m = await mail(rec, l, "r3@x.test");
  const at = new Date(Date.now() + 3 * 864e5).toISOString();
  const r = await act(rec, l, "reference_mail", { details: { email_id: m }, at });
  assert.ok(r.callback_id, "callback created");
  assert.equal((await lead(2)).status, "reference_mail");
  await db.exec("RESET ROLE");
  const cb = await q("select user_id from public.callbacks where lead_id=$1 and not done", [l]);
  assert.deepEqual(cb.map((c) => c.user_id), [rec]);
  const m2 = await mail(rec, leads[3], "r4@x.test");
  await assert.rejects(act(rec, leads[3], "reference_mail", { details: { email_id: m2 }, at: new Date(Date.now() - 1000).toISOString() }), /invalid_schedule/);
});

test("Kein Interesse: the unhappy flag is stored; reopen is for managers of the country only", async () => {
  const l = leads[4];
  await act(rec, l, "no_interest", { details: { unhappy: true }, note: "Kunde unzufrieden" });
  await db.exec("RESET ROLE");
  const a = (await q("select details from public.lead_actions where lead_id=$1", [l]))[0];
  assert.equal(a.details.unhappy, true);
  assert.equal((await lead(4)).status, "no_interest");
  const reopen = async (user) => {
    await as(user);
    const v = (await q("select version from public.leads where id=$1", [l]))[0].version;
    return q("select public.reopen_lead($1,$2,$3,'Zweiter Versuch') r", [randomUUID(), l, v]);
  };
  await assert.rejects(reopen(rec), /forbidden/);
  await reopen(mgr);
  assert.equal((await lead(4)).status, "open");
});
