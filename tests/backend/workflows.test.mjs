import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
const db = new PGlite();
const admin = randomUUID(),
  caller = randomUUID(),
  other = randomUUID();
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
let batch, lead, claim, job;
before(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 GRANT USAGE ON SCHEMA auth TO authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;`);
  for (const file of (await readdir(new URL("../../drizzle/migrations/", import.meta.url)))
    .filter((x) => x.endsWith(".sql"))
    .sort())
    await db.exec(
      await readFile(new URL("../../drizzle/migrations/" + file, import.meta.url), "utf8"),
    );
  await db.query(
    "insert into auth.users values ($1,'admin@example.test','{}'),($2,'caller@example.test','{}'),($3,'other@example.test','{}')",
    [admin, caller, other],
  );
  await db.query("update public.user_roles set role='admin' where user_id=$1", [admin]);
  await as(caller);
});
after(() => db.close());
test("anonymous and caller cannot invoke private or worker functions", async () => {
  await assert.rejects(() => rpc("claim_integration_jobs"), /permission denied/);
  await assert.rejects(() => db.query("select app_private.actor()"), /permission denied/);
  await as(null, "anon");
  await assert.rejects(() => rpc("claim_next_lead"), /permission denied/);
  await as(caller);
  assert.equal((await rpc("get_capabilities")).role, "caller");
  await assert.rejects(
    () => rpc("get_dashboard", ["2026-10-01", "2026-10-31", "team"]),
    /forbidden/,
  );
});
test("staged import validates, isolates and confirms exactly once", async () => {
  const id = randomUUID();
  const rows = [
    { company: "A", phone: "+43 1234567", email: " FIRST@example.test " },
    { company: "B", email: "invalid" },
  ];
  const preview = await rpc("preview_import", [id, "Import", JSON.stringify(rows)]);
  batch = preview.batch_id;
  assert.equal(preview.invalid, 1);
  assert.deepEqual(await rpc("preview_import", [id, "Import", JSON.stringify(rows)]), preview);
  await assert.rejects(() => rpc("confirm_import", [randomUUID(), batch]), /invalid_rows/);
  await as(other);
  assert.equal((await db.query("select * from import_rows")).rows.length, 0);
  await assert.rejects(() => rpc("confirm_import", [randomUUID(), batch, [2]]), /import_not_ready/);
  await as(caller);
  const confirmId = randomUUID();
  const result = await rpc("confirm_import", [confirmId, batch, [2]]);
  assert.equal(result.inserted, 1);
  assert.deepEqual(await rpc("confirm_import", [confirmId, batch, [2]]), result);
  lead = (await db.query("select id,email from leads")).rows[0];
  assert.equal(lead.email, "first@example.test");
  lead = lead.id;
  await assert.rejects(() => db.query("update leads set attempts=999"), /permission denied/);
});
test("duplicate detection requires an explicit import decision", async () => {
  const p = await rpc("preview_import", [
    randomUUID(),
    "Duplicate",
    JSON.stringify([{ company: "A2", phone: "431234567" }]),
  ]);
  assert.deepEqual(await rpc("import_duplicates", [p.batch_id]), [1]);
  await assert.rejects(
    () => rpc("confirm_import", [randomUUID(), p.batch_id]),
    /duplicate_decision_required/,
  );
  assert.equal((await rpc("confirm_import", [randomUUID(), p.batch_id, [1]])).inserted, 0);
});
test("claims isolate callers and expired claims can be reassigned", async () => {
  claim = await rpc("claim_next_lead");
  assert.equal(claim.lead.id, lead);
  assert.equal((await rpc("claim_next_lead")).claim_id, claim.claim_id);
  await as(other);
  assert.equal(await rpc("claim_next_lead"), null);
  await assert.rejects(
    () => rpc("record_call_outcome", [randomUUID(), lead, 0, "not_reached"]),
    /claim_expired/,
  );
  await as(caller);
  await rpc("renew_lead_claim", [claim.claim_id, true]);
  await as(other);
  const theirs = await rpc("claim_next_lead");
  assert.equal(theirs.lead.id, lead);
  await rpc("renew_lead_claim", [theirs.claim_id, true]);
  await as(caller);
  claim = await rpc("claim_next_lead");
});
test("call transaction writes one event and outbox job; replay needs no lease", async () => {
  const id = randomUUID(),
    args = [id, lead, 0, "appointment", "Note", "2099-01-01T12:00:00Z"];
  const result = await rpc("record_call_outcome", args);
  assert.equal(result.attempts, 1);
  assert.deepEqual(await rpc("record_call_outcome", args), result);
  await assert.rejects(
    () => rpc("record_call_outcome", [id, lead, 0, "production"]),
    /idempotency_conflict/,
  );
  assert.equal((await db.query("select * from appointments")).rows.length, 1);
  const jobs = (await db.query("select * from integration_jobs")).rows;
  assert.equal(jobs.length, 1);
  job = jobs[0].id;
  assert.equal((await db.query("select * from lead_claims")).rows.length, 0);
});
test("offer is atomic, numbered, private, immutable after sending and replayable", async () => {
  const id = randomUUID(),
    items = JSON.stringify([{ description: "Service", quantity: 2, unit_price: 12.5 }]);
  const o = await rpc("save_offer", [id, null, items]);
  assert.equal(o.total, 25);
  assert.deepEqual(await rpc("save_offer", [id, null, items]), o);
  await assert.rejects(
    () =>
      rpc("save_offer", [
        randomUUID(),
        null,
        JSON.stringify([{ description: "Bad", quantity: 0, unit_price: 10 }]),
      ]),
    /item_values_valid/,
  );
  assert.equal((await db.query("select * from offers")).rows.length, 1);
  await as(other);
  assert.equal((await db.query("select * from offers")).rows.length, 0);
  assert.equal((await db.query("select * from offer_items")).rows.length, 0);
  await assert.rejects(() => rpc("set_offer_status", [o.offer_id, 0, "sent"]), /stale_offer/);
  await as(caller);
  await rpc("set_offer_status", [o.offer_id, 0, "sent"]);
  await assert.rejects(
    () => rpc("save_offer", [randomUUID(), null, items, null, o.offer_id, 1]),
    /stale_offer/,
  );
});
test("quality pagination and Vienna day boundaries use event time", async () => {
  await as(admin);
  const q = await rpc("get_quality_issues");
  assert.ok(q.some((x) => x.kind === "missing_sync_contact"));
  await rpc("acknowledge_quality", [lead, "missing_sync_contact", "Call contact later"]);
  assert.ok(
    (await rpc("get_quality_issues")).some((x) => x.acknowledged_reason === "Call contact later"),
  );
  await db.exec("RESET ROLE");
  await db.query("update status_changes set created_at='2026-10-24T22:30:00Z' where lead_id=$1", [
    lead,
  ]);
  await as(caller);
  const day = await rpc("get_dashboard", ["2026-10-25", "2026-10-25"]);
  assert.equal(day.attempts, 1);
  assert.equal(day.appointments, 1);
  const before = await rpc("get_dashboard", ["2026-10-24", "2026-10-24"]);
  assert.equal(before.attempts, 0);
});
test("worker leases, checkpoints, expiry and review restrict blind retries", async () => {
  await as(admin);
  await assert.rejects(() => db.exec("update integration_config set enabled=true"), /check constraint/);
  await db.exec("update integration_config set enabled=true,pipeline_id=1,appointment_stage_id=2,production_stage_id=3");
  await as(null, "service_role");
  const claimed = await rpc("claim_integration_jobs");
  assert.equal(claimed.length, 1);
  const token = claimed[0].job.lease_token;
  assert.deepEqual(await rpc("claim_integration_jobs"), []);
  await assert.rejects(
    () => rpc("checkpoint_integration", [job, randomUUID(), "deal", 12]),
    /lease_expired/,
  );
  await rpc("checkpoint_integration", [job, token, "organization", 10]);
  await db.exec("RESET ROLE");
  await db.query("update integration_jobs set lease_until=now()-interval '1 minute' where id=$1", [
    job,
  ]);
  await as(null, "service_role");
  assert.equal((await rpc("backend_maintenance")).expired_jobs, 1);
  await as(admin);
  await assert.rejects(() => rpc("retry_integration", [job]), /not_retryable/);
  await rpc("resolve_integration_review", [job, 10, null, null, false]);
  await as(null, "service_role");
  const retry = await rpc("claim_integration_jobs");
  assert.equal(retry[0].links.organization_id, 10);
  await rpc("checkpoint_integration", [job, retry[0].job.lease_token, "deal", 12]);
  await rpc("finish_integration_job", [job, retry[0].job.lease_token, "succeeded"]);
  await as(admin);
  assert.equal(
    (await db.query("select status from integration_jobs where id=$1", [job])).rows[0].status,
    "succeeded",
  );
});
test("role management prevents direct escalation and last admin removal", async () => {
  await as(caller);
  await assert.rejects(() => rpc("set_user_role", [caller, "admin"]), /forbidden/);
  await assert.rejects(() => db.query("update user_roles set role='admin'"), /permission denied/);
  await as(admin);
  await assert.rejects(() => rpc("set_user_role", [admin, "caller"]), /last_admin/);
  await rpc("set_user_role", [other, "admin"]);
  await rpc("set_user_role", [other, "caller"]);
});
test("contact corrections reject protected fields; caller cannot archive leads or read team history", async () => {
  await as(caller);
  await assert.rejects(
    () => rpc("update_lead_contact", [lead, 1, JSON.stringify({ status: "production" })]),
    /invalid_contact/,
  );
  const current = (await db.query("select version from leads where id=$1", [lead])).rows[0].version;
  await rpc("update_lead_contact", [
    lead,
    current,
    JSON.stringify({ contact_name: "Verified contact" }),
  ]);
  await assert.rejects(
    () => rpc("update_lead_contact", [lead, current, JSON.stringify({ company: "stale" })]),
    /stale_lead/,
  );
  await assert.rejects(() => rpc("archive_leads", [[lead]]), /forbidden/);
  await as(other);
  assert.equal((await db.query("select * from status_changes")).rows.length, 0);
  await as(admin);
  assert.equal(
    (await rpc("get_quality_issues")).some((x) => x.kind === "missing_sync_contact"),
    false,
  );
});
test("retry budgets stop at eight and reject expired worker tokens", async () => {
  await as(admin);
  const jobRow = (await db.query("select * from integration_jobs where id=$1", [job])).rows[0];
  await db.exec("RESET ROLE");
  await db.query(
    "update integration_jobs set status='pending',attempts=7,next_attempt_at=now() where id=$1",
    [job],
  );
  await as(null, "service_role");
  const claimed = await rpc("claim_integration_jobs");
  await rpc("finish_integration_job", [
    job,
    claimed[0].job.lease_token,
    "pending",
    "rate_limited",
    3600,
  ]);
  await assert.rejects(
    () => rpc("finish_integration_job", [job, claimed[0].job.lease_token, "succeeded"]),
    /lease_expired/,
  );
  await as(admin);
  const row = (await db.query("select * from integration_jobs where id=$1", [job])).rows[0];
  assert.equal(row.status, "failed");
  assert.equal(row.attempts, 8);
  assert.ok(new Date(row.next_attempt_at) > new Date(Date.now() + 3500_000));
  await rpc("retry_integration", [job]);
  assert.equal(
    (await db.query("select attempts from integration_jobs where id=$1", [job])).rows[0].attempts,
    0,
  );
});
test('temporary tables cannot spoof role checks inside security-definer functions',async()=>{
 await as(caller);
 await db.exec("CREATE TEMP TABLE user_roles(user_id uuid,role text)");
 await db.query("INSERT INTO pg_temp.user_roles VALUES($1,'admin')",[caller]);
 assert.equal(await rpc('has_role',[caller,'admin']),false);
 await assert.rejects(()=>rpc('set_user_role',[caller,'admin']),/forbidden/);
 await db.exec('DROP TABLE pg_temp.user_roles');
});
