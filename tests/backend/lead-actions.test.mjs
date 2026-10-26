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
let open, leads;

before(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 GRANT USAGE ON SCHEMA auth TO authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;`);
  for (const file of (await readdir(new URL("../../drizzle/migrations/", import.meta.url)))
    .filter((x) => x.endsWith(".sql"))
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
    "insert into auth.users values ($1,'admin@example.test','{\"display_name\":\"Admin\"}'),($2,'anna@example.test','{\"display_name\":\"Anna\"}'),($3,'ben@example.test','{\"display_name\":\"Ben\"}'),($4,'chris@example.test','{\"display_name\":\"Chris\"}')",
    [admin, anna, ben, chris],
  );
  await db.query("update public.user_roles set role='admin' where user_id=$1", [admin]);
  await db.query(
    "insert into public.user_countries(user_id,country) values ($1,'DE'),($2,'DE'),($3,'DE') on conflict do nothing",
    [admin, anna, ben],
  );
  open = (
    await db.query(
      "insert into public.lead_batches(name,created_by,import_state,country) values ('Test DE',$1,'confirmed','DE') returning id",
      [admin],
    )
  ).rows[0].id;
  await db.query(
    "insert into public.leads(batch_id,company,phone,email) select $1,'Firma '||g,'+49 30 555000'||g,'f'||g||'@example.test' from generate_series(1,7) g",
    [open],
  );
  leads = (
    await db.query("select id from public.leads where batch_id=$1 order by phone", [open])
  ).rows.map((r) => r.id);
  await db.query("update public.lead_batches set assigned_to=$1,assigned_at=now() where id=$2", [
    anna,
    open,
  ]);
});
after(() => db.close());

const action = (lead, version, name, extra = {}) =>
  rpc("record_lead_action", [
    extra.id ?? randomUUID(),
    lead,
    version,
    name,
    extra.note ?? null,
    extra.at ?? null,
    extra.logo ?? null,
    extra.details ? JSON.stringify(extra.details) : null,
  ]);
const row = async (id) => (await db.query("select * from public.leads where id=$1", [id])).rows[0];
const future = (hours = 1) => new Date(Date.now() + hours * 3600e3).toISOString();

test("3D-R-LowQ needs a note and a logo from the caller's own folder", async () => {
  await as(anna);
  const [lead] = leads;
  await assert.rejects(
    () => action(lead, 0, "low_q", { logo: `${anna}/${lead}/logo.png` }),
    /note_required/,
  );
  await assert.rejects(() => action(lead, 0, "low_q", { note: "Gespräch" }), /logo_required/);
  await assert.rejects(
    () => action(lead, 0, "low_q", { note: "Gespräch", logo: `${ben}/${lead}/logo.png` }),
    /logo_required/,
  );
  await assert.rejects(
    () => action(lead, 0, "low_q", { note: "Gespräch", logo: `${anna}/${lead}/logo.png` }),
    /appointment_required/,
    "the appointment is mandatory",
  );
  const id = randomUUID();
  const args = {
    id,
    note: "Will ein einfaches Logo",
    logo: `${anna}/${lead}/logo.png`,
    at: future(48),
  };
  const done = await action(lead, 0, "low_q", args);
  assert.equal(done.status, "low_q");
  assert.equal(done.stage_key, "low_q");
  assert.equal(done.crm_sync_state, "queued", "queued is not synced");
  assert.equal(done.attempts, 1);
  assert.deepEqual(
    await action(lead, 0, "low_q", args),
    done,
    "same request is replayed, not repeated",
  );
  const l = await row(lead);
  assert.equal(l.status, "low_q");
  assert.equal(l.attempts, 1);
  const notes = (
    await db.query("select user_id,body,created_at from public.lead_notes where lead_id=$1", [lead])
  ).rows;
  assert.equal(notes.length, 1);
  assert.equal(notes[0].user_id, anna);
  assert.equal(
    (await db.query("select * from public.lead_actions where lead_id=$1", [lead])).rows.length,
    1,
  );
});

test("only the owner of the batch, earlier editors and admins can act on a lead", async () => {
  const lead = leads[1];
  await as(ben);
  await assert.rejects(() => action(lead, 0, "no_interest"), /not_your_lead/);
  await as(anna);
  await assert.rejects(() => action(lead, 5, "no_interest"), /stale_lead/);
  await assert.rejects(() => action(lead, 0, "gibt_es_nicht"), /validation_failed/);
  const done = await action(lead, 0, "no_interest");
  assert.equal(done.status, "no_interest");
  assert.equal(done.stage_key, null, "Kein Interesse never creates a CRM deal");
  assert.equal(done.crm_sync_state, null);
  await as(admin);
  assert.equal((await action(leads[2], 0, "not_reached")).status, "open");
});

test("Logo ausstehend: note required, callback optional. Zukunftsprojekt: note and month, no CRM deal yet", async () => {
  await as(anna);
  await assert.rejects(() => action(leads[3], 0, "waiting_3d"), /note_required/);
  const waiting = await action(leads[3], 0, "waiting_3d", { note: "Logo kommt per Mail" });
  assert.equal(waiting.status, "waiting_3d");
  assert.equal(waiting.stage_key, "waiting_3d");
  assert.equal(waiting.callback_id, null, "the callback is optional");
  const withCb = await action(leads[6], 0, "waiting_3d", { note: "Logo kommt", at: future(30) });
  assert.ok(withCb.callback_id);
  await assert.rejects(() => action(leads[4], 0, "on_hold"), /note_required/);
  await assert.rejects(
    () => action(leads[4], 0, "on_hold", { note: "Später" }),
    /invalid_month/,
    "a month is required",
  );
  await assert.rejects(
    () => action(leads[4], 0, "on_hold", { note: "Später", details: { month: "2000-01" } }),
    /invalid_month/,
  );
  const month = new Date(Date.now() + 95 * 86400e3).toISOString().slice(0, 7);
  const held = await action(leads[4], 0, "on_hold", { note: "Projekt später", details: { month } });
  assert.equal(held.status, "on_hold");
  assert.equal(held.stage_key, null, "no deal until the month has started");
  assert.equal(held.crm_sync_state, null);
  assert.equal(held.callback_id, null);
});

test("callback needs a future time, is not a CRM stage and replaces older callbacks", async () => {
  await as(anna);
  const lead = leads[5];
  await assert.rejects(() => action(lead, 0, "callback"), /invalid_schedule/);
  await assert.rejects(
    () => action(lead, 0, "callback", { at: "2000-01-01T00:00:00Z" }),
    /invalid_schedule/,
  );
  const first = await action(lead, 0, "callback", { at: future(5) });
  assert.equal(first.status, "callback");
  assert.equal(first.stage_key, null);
  assert.equal(first.crm_sync_state, null);
  const cbs = (await db.query("select done,country from public.callbacks where lead_id=$1", [lead]))
    .rows;
  assert.deepEqual(cbs, [{ done: false, country: "DE" }]);
  const second = await action(lead, first.version, "no_interest", { note: "doch nicht" });
  assert.equal(second.status, "no_interest");
  assert.equal(
    (
      await db.query("select count(*)::int n from public.callbacks where lead_id=$1 and not done", [
        lead,
      ])
    ).rows[0].n,
    0,
  );
});

// A confirmed e-mail is a precondition for the two e-mail actions. Written the way the server writes it.
const mailFor = async (user, lead, kind, status = "simulated") => {
  await db.exec("RESET ROLE");
  const id = randomUUID();
  await db.query(
    "insert into public.lead_emails(id,lead_id,created_by,kind,to_email,subject,body,status,request_id) values ($1,$2,$3,$4,'kunde@example.test','Betreff','Text',$5,$6)",
    [id, lead, user, kind, status, randomUUID()],
  );
  await as(user);
  return id;
};

test("Kontaktdaten is no longer a conversation outcome", async () => {
  await as(anna);
  const lead = leads[6];
  const before = await row(lead);
  const mail = await mailFor(anna, lead, "contact_details", "sent");
  await assert.rejects(
    () => action(lead, before.version, "contact_details", { details: { email_id: mail } }),
    /validation_failed/,
  );
  assert.equal((await row(lead)).status, before.status, "nothing changed");
});

test("Referenzmail moves the lead on without a CRM deal", async () => {
  await as(anna);
  const lead = leads[0];
  const l = await row(lead);
  await assert.rejects(
    () =>
      action(lead, l.version, "reference_mail", {
        details: { template: "t1" },
      }),
    /email_not_sent/,
  );
  await as(ben);
  const foreign = await mailFor(ben, lead, "reference_mail", "sent");
  await as(anna);
  await assert.rejects(
    () => action(lead, l.version, "reference_mail", { details: { email_id: foreign } }),
    /email_not_sent/,
    "someone else's e-mail does not count",
  );
  const mail = await mailFor(anna, lead, "reference_mail", "simulated");
  const done = await action(lead, l.version, "reference_mail", {
    details: { email_id: mail, template: "t1" },
  });
  assert.equal(done.status, "reference_mail");
  assert.equal(done.stage_key, null);
  assert.equal(done.crm_sync_state, null);
  assert.equal((await row(lead)).status, "reference_mail");
});

test("a caller never gets two open callbacks in the same minute", async () => {
  await as(anna);
  const base = new Date(Date.now() + 2 * 3600e3);
  base.setSeconds(10, 0);
  const lead = (
    await db.query(
      "select id,version from public.leads where status='open' and batch_id=$1 limit 2",
      [open],
    )
  ).rows;
  assert.ok(lead.length >= 1);
  const first = await action(lead[0].id, lead[0].version, "callback", { at: base.toISOString() });
  assert.equal(first.status, "callback");
  // Same minute, other lead and other second: rejected.
  const other = new Date(base.getTime() + 20000).toISOString();
  if (lead[1])
    await assert.rejects(
      () => action(lead[1].id, lead[1].version, "callback", { at: other }),
      /callback_slot_taken/,
    );
  // The same lead again replaces its own callback, so it is not a clash.
  const again = await action(lead[0].id, first.version, "callback", { at: other });
  assert.equal(again.status, "callback");
  if (lead[1]) {
    const later = new Date(base.getTime() + 60000).toISOString();
    assert.equal(
      (await action(lead[1].id, lead[1].version, "callback", { at: later })).status,
      "callback",
    );
    // Another caller is not affected.
    await as(admin);
    assert.equal(
      (
        await action(leads[2], (await row(leads[2])).version, "callback", {
          at: base.toISOString(),
        })
      ).status,
      "callback",
    );
  }
});

test("actions are written only through the function", async () => {
  await as(anna);
  await assert.rejects(
    () =>
      db.query("insert into public.lead_actions(lead_id,user_id,action) values ($1,$2,'low_q')", [
        leads[0],
        anna,
      ]),
    /permission denied/,
  );
  const mine = (await db.query("select count(*)::int n from public.lead_actions")).rows[0].n;
  assert.ok(mine > 0);
  await as(ben);
  assert.equal(
    (await db.query("select count(*)::int n from public.lead_actions")).rows[0].n,
    0,
    "others' actions stay private",
  );
});
